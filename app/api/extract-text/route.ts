import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, HAIKU_MODEL } from "@/lib/claude";
import { anthropicPreflight, handleAnthropicError } from "@/lib/anthropic-errors";

// Vision on a single image is quick; this is well under the Hobby cap.
export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Enhanced OCR fallback.
 *
 * The scan page runs Tesseract.js in the browser first (free). Only when that
 * text fails the structural-marker validation does it call here, so this route
 * is the *cost* leg of the hybrid pipeline — keep it to the cheapest capable
 * model and the smallest prompt.
 */

type VisionMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const SUPPORTED_MEDIA_TYPES: readonly VisionMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/** ~5 MB decoded is Anthropic's per-image cap; base64 inflates it by ~4/3. */
const MAX_BASE64_CHARS = 7_000_000;

// FIX 1.1 — this tier had been narrating the photo ("Based on the image, this
// appears to be an eye drop bottle...") instead of transcribing the label,
// which then passed the structural-marker check by accident while containing
// no real label data. This prompt is deliberately blunt about it.
const SYSTEM_PROMPT = `You are an OCR transcription engine. Output ONLY the text printed on the package, exactly as printed.

STRICT RULES:
- Do NOT describe the image, packaging, lighting or photo quality
- Do NOT write "Based on the image", "This appears to be", "I can make out", or any similar framing
- Do NOT invent headings, add commentary, or interpret
- Do NOT summarise. Transcribe.
- Preserve the label's own structure and line breaks
- Where text is genuinely unreadable, write [unreadable] inline at that position and continue. Do not explain why.
- If you can read nothing at all, output exactly: NO_TEXT_FOUND

Text may be rotated, curved around a cylinder, on crinkled foil, or in very small type. Read it in whatever orientation it appears. Work systematically across the whole label including the smallest print.

Output the transcription and nothing else.`;

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(request: Request) {
  let body: { imageBase64?: unknown; mediaType?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  let imageBase64 =
    typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
  let mediaType =
    typeof body.mediaType === "string"
      ? body.mediaType.trim().toLowerCase()
      : "";

  // Tolerate a full `data:` URL being passed instead of bare base64.
  const dataUrl = /^data:([^;,]+)[;,]/.exec(imageBase64);
  if (dataUrl) {
    if (!mediaType) mediaType = dataUrl[1].toLowerCase();
    const comma = imageBase64.indexOf(",");
    if (comma >= 0) imageBase64 = imageBase64.slice(comma + 1);
  }
  imageBase64 = imageBase64.replace(/\s+/g, "");
  if (mediaType === "image/jpg") mediaType = "image/jpeg";

  if (!imageBase64) {
    return jsonError("`imageBase64` is required.", 400);
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return jsonError("That image is too large. Use a smaller photo.", 413);
  }
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType as VisionMediaType)) {
    return jsonError(
      "`mediaType` must be one of image/jpeg, image/png, image/webp, image/gif.",
      400,
    );
  }

  const preflight = anthropicPreflight("extract-text");
  if (preflight) return preflight;

  let extractedText: string;
  try {
    const message = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2000,
      // FIX 9.1 — a transcription tier must read the same image the same way
      // every time; temperature 0 removes random sampling from the read.
      temperature: 0,
      // This tier only transcribes the label — no reasoning to do. Haiku 4.5
      // does not think by default, but state it explicitly so a future model
      // swap cannot start spending this 2,000-token budget on thinking.
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as VisionMediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: "Extract every piece of text printed on this product package.",
            },
          ],
        },
      ],
    });

    extractedText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    // Recognised infrastructure outages (credits, rate limit, overload, key,
    // connectivity) -> specific code + retryable flag, raw message never leaked.
    const outage = handleAnthropicError(err, "extract-text");
    if (outage) return outage;
    if (
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.UnprocessableEntityError
    ) {
      // Almost always an unreadable or unsupported image.
      return jsonError(
        "That image could not be read. Retake the photo in good light.",
        422,
      );
    }
    return jsonError("Unexpected error during enhanced reading.", 500);
  }

  if (!extractedText) {
    return jsonError("No text could be read from this image.", 422);
  }

  return NextResponse.json({ extractedText });
}
