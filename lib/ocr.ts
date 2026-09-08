// Types only — the ~1 MB tesseract.js bundle is loaded lazily inside
// `processImage`, so visiting a non-scan page never downloads it.
import type Tesseract from "tesseract.js";

/**
 * OCR module for HealthRepo.
 *
 * Runs entirely client-side (Tesseract.js in a Web Worker). Given a product
 * photo — from a file picker or a camera capture — it returns the raw text
 * printed on the packaging so the rest of the app can run Legal Metrology and
 * ingredient checks against it.
 */

/** Reasons `processImage` can fail, in a form the UI can branch on. */
export type OcrErrorCode =
  | "INVALID_FILE" // not an image, or an unreadable / empty file
  | "FILE_TOO_LARGE" // image is larger than `maxFileSizeBytes`
  | "DECODE_FAILED" // the browser could not decode the image data
  | "NO_TEXT_FOUND" // OCR ran but found nothing usable
  | "LOW_CONFIDENCE" // text was found but it is almost certainly garbage (blurry photo)
  | "ABORTED" // caller cancelled via an AbortSignal
  | "OCR_FAILED"; // Tesseract threw for some other reason

export class OcrError extends Error {
  readonly code: OcrErrorCode;

  constructor(code: OcrErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OcrError";
    this.code = code;
  }
}

/** A single recognised word, useful for highlighting or spatial parsing later. */
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  /** Full extracted text, trimmed and lightly cleaned up. */
  text: string;
  /** Mean confidence reported by Tesseract, 0–100. */
  confidence: number;
  /** Number of whitespace-separated words in {@link OcrResult.text}. */
  wordCount: number;
  /** Individual words with positions and confidences (may be empty). */
  words: OcrWord[];
  /**
   * True when confidence is low enough that the caller should warn the user
   * and suggest a clearer photo, even though some text was returned.
   */
  lowConfidence: boolean;
}

export type OcrStatus =
  | "loading" // downloading / warming up the OCR engine
  | "recognizing" // reading text from the image
  | "done";

export interface ProcessImageOptions {
  /**
   * Tesseract language code(s), e.g. "eng" or "eng+hin" for bilingual Indian
   * packaging. Language data is fetched from the CDN on first use.
   */
  language?: string;
  /** Called with progress 0–1 and a coarse status, for a loading indicator. */
  onProgress?: (progress: number, status: OcrStatus) => void;
  /**
   * Below this mean confidence (0–100) the result is flagged `lowConfidence`.
   * If there is also very little text, `processImage` throws `LOW_CONFIDENCE`
   * instead. Set to 0 to disable the check. Default 45.
   */
  minConfidence?: number;
  /** Reject files larger than this. Default 20 MB. */
  maxFileSizeBytes?: number;
  /** Cancel a long-running scan. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const DEFAULT_MIN_CONFIDENCE = 45;
const MIN_USABLE_TEXT_LENGTH = 12; // chars, after trimming — below this a low-confidence read is treated as a failure

/**
 * Extract text from a product image.
 *
 * Works with any `File` the browser hands back, so the same call covers both
 * `<input type="file">` uploads and `<input capture>` camera photos.
 *
 * @throws {OcrError} with a `code` from {@link OcrErrorCode} for every failure,
 * including blurry images (`LOW_CONFIDENCE`) and blank results (`NO_TEXT_FOUND`).
 */
export async function processImage(
  imageFile: File,
  options: ProcessImageOptions = {},
): Promise<OcrResult> {
  const {
    language = "eng",
    onProgress,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE,
    signal,
  } = options;

  assertNotAborted(signal);
  validateImageFile(imageFile, maxFileSizeBytes);

  onProgress?.(0, "loading");

  const TesseractRT = (await import("tesseract.js")).default;

  let worker: Tesseract.Worker | undefined;
  try {
    worker = await TesseractRT.createWorker(language, 1, {
      logger: (m: Tesseract.LoggerMessage) => {
        if (signal?.aborted) return;
        if (m.status === "recognizing text") {
          onProgress?.(m.progress, "recognizing");
        } else if (onProgress) {
          // model download / init phases — keep the bar moving but capped low
          onProgress(Math.min(Math.max(m.progress, 0), 1) * 0.15, "loading");
        }
      },
    });
  } catch (cause) {
    throw new OcrError(
      "OCR_FAILED",
      "Could not start the text reader. Check your connection and try again.",
      { cause },
    );
  }

  try {
    assertNotAborted(signal, worker);

    let page: Tesseract.Page;
    try {
      const { data } = await worker.recognize(
        imageFile,
        undefined,
        { text: true, blocks: true },
      );
      page = data;
    } catch (cause) {
      // Tesseract surfaces undecodable input as a generic error here.
      throw new OcrError(
        "DECODE_FAILED",
        "That image could not be read. Try a different photo, or a JPG / PNG file.",
        { cause },
      );
    }

    assertNotAborted(signal, worker);
    onProgress?.(1, "done");

    const text = normalizeText(page.text ?? "");
    const confidence = Math.round(page.confidence ?? 0);
    const words = flattenWords(page);
    const wordCount = countWords(text);

    if (!text) {
      throw new OcrError(
        "NO_TEXT_FOUND",
        "No text was found on this image. Make sure the label fills the frame and is in focus.",
      );
    }

    const lowConfidence = minConfidence > 0 && confidence < minConfidence;
    if (lowConfidence && text.length < MIN_USABLE_TEXT_LENGTH) {
      throw new OcrError(
        "LOW_CONFIDENCE",
        "The image looks too blurry to read. Hold steady, move closer, and retake the photo in good light.",
      );
    }

    return { text, confidence, wordCount, words, lowConfidence };
  } catch (err) {
    if (err instanceof OcrError) throw err;
    throw new OcrError("OCR_FAILED", "OCR failed unexpectedly. Please try again.", {
      cause: err,
    });
  } finally {
    // Always release the worker; ignore teardown errors.
    await worker?.terminate().catch(() => {});
  }
}

/** Count whitespace-separated tokens in a string. */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------
// Text validation — the "is this really a product label?" gate
// ---------------------------------------------------------------------------

export interface TextValidation {
  /** true when at least {@link MIN_VALID_SCORE} structural markers were found. */
  isValid: boolean;
  /** Number of markers found, 0–7. */
  score: number;
  /** Names of the markers that were NOT found. */
  missingMarkers: string[];
}

/** Below this many markers the Tesseract text is treated as unreliable. */
const MIN_VALID_SCORE = 3;

/**
 * Structural markers that appear on essentially every Indian packaged product.
 * One hit = one point; max 7. This is a cheap sanity check on Tesseract output
 * before we decide whether to spend a Vision-model call.
 */
const TEXT_MARKERS: { name: string; test: RegExp }[] = [
  {
    name: "MRP / price",
    test: /\bMRP\b|M\.?\s?R\.?\s?P\.?|maximum retail price|₹|\bRs\.?\b/i,
  },
  {
    name: "Ingredients",
    test: /\bingredients?\b|\bcontains\b|\bcomposition\b/i,
  },
  {
    name: "Manufacturing / packing",
    test: /\bmfg\b|\bmfd\b|manufactured|\bpacked\b|\bpacking\b|\bpkd\b/i,
  },
  {
    name: "Expiry / best before",
    test: /best before|use by|\bexpiry\b|\bexp\.?\b/i,
  },
  {
    name: "Net weight / quantity",
    test: /net\s?weight|net\s?wt\.?|net\s?qty\.?|net\s?quantity|\bml\b|\sg\s|\skg\s|\bgm\b/i,
  },
  {
    name: "Date",
    test: /\b\d{1,2}\s?[/.\-]\s?\d{1,2}\s?[/.\-]\s?\d{2,4}\b|\b\d{1,2}\s?[/.\-]\s?\d{4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/i,
  },
  {
    name: "FSSAI licence",
    test: /\bFSSAI\b|lic\.?\s?no\b|licen[cs]e\s?no\b|\blicen[cs]e\b|\b\d{14}\b/i,
  },
];

/**
 * Score OCR text against the structural markers a genuine Indian product label
 * should carry. `isValid` is true when 3 or more of the 7 markers are present.
 */
export function validateExtractedText(text: string): TextValidation {
  const missingMarkers: string[] = [];
  let score = 0;

  for (const marker of TEXT_MARKERS) {
    if (marker.test.test(text)) score += 1;
    else missingMarkers.push(marker.name);
  }

  return { isValid: score >= MIN_VALID_SCORE, score, missingMarkers };
}

// ---------------------------------------------------------------------------
// Vision fallback payload
// ---------------------------------------------------------------------------

/** Long-edge cap for the Vision fallback image (Anthropic downsizes anyway). */
const VISION_MAX_EDGE = 1600;
const VISION_JPEG_QUALITY = 0.8;

export interface VisionImagePayload {
  /** Bare base64 (no `data:` prefix). */
  base64: string;
  /** e.g. "image/jpeg" — one of the types Anthropic vision accepts. */
  mediaType: string;
}

/**
 * Convert a picked File into a base64 payload for the Haiku Vision fallback.
 * Downscales + re-encodes as JPEG where the browser supports it; otherwise
 * sends the original bytes unchanged.
 */
export async function imageToVisionPayload(
  file: File,
): Promise<VisionImagePayload> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      const scale = Math.min(
        1,
        VISION_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
      );
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable.");
      ctx.drawImage(bitmap, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", VISION_JPEG_QUALITY);
      return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg" };
    } finally {
      bitmap.close?.();
    }
  } catch {
    return readFileAsBase64(file);
  }
}

function readFileAsBase64(file: File): Promise<VisionImagePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the image file."));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      const base64 = comma >= 0 ? result.slice(comma + 1) : result;
      const m = /^data:([^;,]+)[;,]/.exec(result);
      const mediaType =
        m?.[1] ||
        (file.type && file.type.startsWith("image/")
          ? file.type
          : "image/jpeg");
      resolve({ base64, mediaType });
    };
    reader.readAsDataURL(file);
  });
}

/** Human-readable message for an error, whether or not it is an `OcrError`. */
export function ocrErrorMessage(err: unknown): string {
  if (err instanceof OcrError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong while reading the image.";
}

function validateImageFile(file: File, maxBytes: number): void {
  if (!(file instanceof File) || file.size === 0) {
    throw new OcrError("INVALID_FILE", "No readable image file was provided.");
  }

  const looksLikeImage =
    file.type.startsWith("image/") ||
    // Some Android cameras report an empty MIME type; fall back to the extension.
    (file.type === "" && /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(file.name));

  if (!looksLikeImage) {
    throw new OcrError(
      "INVALID_FILE",
      "That file is not an image. Upload a JPG, PNG, or WebP photo of the product.",
    );
  }

  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new OcrError(
      "FILE_TOO_LARGE",
      `That image is too large (limit ${mb} MB). Try a smaller photo.`,
    );
  }
}

/** Walk the Tesseract page tree and collect words with their boxes. */
function flattenWords(page: Tesseract.Page): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const t = word.text?.trim();
          if (!t) continue;
          words.push({
            text: t,
            confidence: word.confidence,
            bbox: word.bbox,
          });
        }
      }
    }
  }
  return words;
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n") // trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // collapse big vertical gaps
    .trim();
}

function assertNotAborted(signal?: AbortSignal, worker?: Tesseract.Worker): void {
  if (signal?.aborted) {
    void worker?.terminate().catch(() => {});
    throw new OcrError("ABORTED", "Scan cancelled.");
  }
}
