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

  // Preprocess: EXIF-orient, keep the long edge >= 1600px (small print needs
  // resolution), greyscale + contrast-stretch. Packet photos are very often
  // rotated, so when `base` is a canvas we also OCR at 90/180/270 and keep the
  // strongest read. Falls back to the raw file if canvas is unavailable.
  const base = await preprocessForOcr(imageFile);
  const angles: RotationAngle[] = base ? [0, 90, 180, 270] : [0];

  let passIndex = 0;
  const passCount = angles.length;

  let worker: Tesseract.Worker | undefined;
  try {
    worker = await TesseractRT.createWorker(language, 1, {
      logger: (m: Tesseract.LoggerMessage) => {
        if (signal?.aborted) return;
        if (m.status === "recognizing text") {
          onProgress?.((passIndex + m.progress) / passCount, "recognizing");
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

    let best:
      | {
          page: Tesseract.Page;
          text: string;
          confidence: number;
          wordCount: number;
          strength: number;
          angle: RotationAngle;
        }
      | null = null;

    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      passIndex = i;
      assertNotAborted(signal, worker);

      const input: Tesseract.ImageLike =
        angle === 0
          ? ((base ?? imageFile) as Tesseract.ImageLike)
          : (rotateCanvas(base as HTMLCanvasElement, angle) as Tesseract.ImageLike);

      let page: Tesseract.Page;
      try {
        const { data } = await worker.recognize(input, undefined, {
          text: true,
          blocks: true,
        });
        page = data;
      } catch (cause) {
        // A decode failure on the very first pass means the image itself is bad.
        if (i === 0 && !best) {
          throw new OcrError(
            "DECODE_FAILED",
            "That image could not be read. Try a different photo, or a JPG / PNG file.",
            { cause },
          );
        }
        continue;
      }

      const text = normalizeText(page.text ?? "");
      const confidence = Math.round(page.confidence ?? 0);
      const wordCount = countWords(text);
      const strength = passStrength(confidence, wordCount, text);

      if (!best || strength > best.strength) {
        best = { page, text, confidence, wordCount, strength, angle };
      }

      // A confident, label-shaped upright read — no need to spin the image.
      if (
        angle === 0 &&
        confidence >= 65 &&
        wordCount >= 15 &&
        validateExtractedText(text).score >= 3
      ) {
        break;
      }
    }

    assertNotAborted(signal, worker);
    onProgress?.(1, "done");

    if (!best || !best.text) {
      throw new OcrError(
        "NO_TEXT_FOUND",
        "No text was found on this image. Make sure the label fills the frame and is in focus.",
      );
    }

    const { page, text, confidence, wordCount, angle } = best;
    const words = flattenWords(page);
    const lowConfidence = minConfidence > 0 && confidence < minConfidence;
    if (lowConfidence && text.length < MIN_USABLE_TEXT_LENGTH) {
      throw new OcrError(
        "LOW_CONFIDENCE",
        "The image looks too blurry to read. Hold steady, move closer, and retake the photo in good light.",
      );
    }

    if (typeof console !== "undefined") {
      console.info("[ocr] tesseract:", {
        angle,
        confidence,
        wordCount,
        validationScore: validateExtractedText(text).score,
        chars: text.length,
      });
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

type RotationAngle = 0 | 90 | 180 | 270;

/** Longest edge OCR is allowed to shrink a photo to. Never goes below ~1600. */
const OCR_MAX_LONG_EDGE = 2400;

/**
 * Decode, EXIF-orient, keep resolution, greyscale + contrast-stretch. Returns a
 * canvas ready for OCR (and for rotation trials), or null when the browser
 * cannot give us one — the caller then OCRs the raw file at 0° only.
 */
async function preprocessForOcr(file: File): Promise<HTMLCanvasElement | null> {
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      const longEdge = Math.max(bitmap.width, bitmap.height);
      // Only cap the very large photos — never shrink below the source or 1600.
      const scale =
        longEdge > OCR_MAX_LONG_EDGE ? OCR_MAX_LONG_EDGE / longEdge : 1;
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);

      try {
        const img = ctx.getImageData(0, 0, w, h);
        greyscaleContrast(img.data);
        ctx.putImageData(img, 0, 0);
      } catch {
        // getImageData can fail on huge canvases / tight memory — the correctly
        // oriented, un-enhanced canvas is still worth using.
      }
      return canvas;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null;
  }
}

/** In-place greyscale then a 2nd–98th percentile contrast stretch. */
function greyscaleContrast(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const y = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.min(255, d[i] | 0)]++;
  const total = d.length / 4;
  const lo = histPercentile(hist, total, 0.02);
  const hi = histPercentile(hist, total, 0.98);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

function histPercentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= target) return v;
  }
  return 255;
}

/** Rotate a canvas by a quarter turn into a fresh canvas. */
function rotateCanvas(
  src: HTMLCanvasElement,
  angle: 90 | 180 | 270,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const quarter = angle === 90 || angle === 270;
  c.width = quarter ? src.height : src.width;
  c.height = quarter ? src.width : src.height;
  const ctx = c.getContext("2d");
  if (!ctx) return src;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/**
 * How "good" one OCR pass looks: raw confidence, plus word count (capped) and
 * how label-shaped the text is. Rotated-wrong reads score low on all three, so
 * this reliably picks the upright orientation.
 */
function passStrength(
  confidence: number,
  wordCount: number,
  text: string,
): number {
  return (
    confidence +
    Math.min(wordCount, 80) * 0.6 +
    validateExtractedText(text).score * 6
  );
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

/** Anthropic's optimal long edge — larger costs tokens with no accuracy gain. */
const VISION_TARGET_EDGE = 1568;
const VISION_JPEG_QUALITY = 0.85;
/** Anthropic rejects a single image over ~5 MB; keep the base64 comfortably under. */
const VISION_MAX_BYTES = 5 * 1024 * 1024;

export interface VisionImagePayload {
  /** Bare base64 (no `data:` prefix). */
  base64: string;
  /** e.g. "image/jpeg" — one of the types Anthropic vision accepts. */
  mediaType: string;
}

/** Decoded byte length of a base64 string / data URL. */
function base64Bytes(s: string): number {
  const b64 = s.includes(",") ? s.slice(s.indexOf(",") + 1) : s;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Convert a picked File into a base64 payload for the Vision fallbacks:
 * EXIF-orient, resize the long edge to 1568px, re-encode JPEG q0.85, and step
 * quality down if the payload would exceed the 5 MB image cap. Falls back to the
 * raw bytes only when canvas is unavailable.
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
        VISION_TARGET_EDGE / Math.max(bitmap.width, bitmap.height),
      );
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable.");
      ctx.drawImage(bitmap, 0, 0, w, h);

      let quality = VISION_JPEG_QUALITY;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (base64Bytes(dataUrl) > VISION_MAX_BYTES && quality > 0.4) {
        quality = Math.round((quality - 0.15) * 100) / 100;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }

      const base64 = dataUrl.split(",")[1] ?? "";
      if (typeof console !== "undefined") {
        console.info("[ocr] vision payload:", {
          size: `${w}x${h}`,
          quality,
          kb: Math.round(base64Bytes(dataUrl) / 1024),
        });
      }
      return { base64, mediaType: "image/jpeg" };
    } finally {
      bitmap.close?.();
    }
  } catch {
    const raw = await readFileAsBase64(file);
    if (typeof console !== "undefined") {
      console.warn("[ocr] vision payload: canvas unavailable, sending raw file", {
        type: raw.mediaType,
        kb: Math.round(base64Bytes(raw.base64) / 1024),
      });
    }
    return raw;
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
