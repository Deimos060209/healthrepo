import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, HAIKU_MODEL } from "@/lib/claude";

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

const SYSTEM_PROMPT =
  "Extract ALL text visible on this product package. Return the raw text exactly as printed, preserving layout. Include ingredients, MRP, dates, manufacturer info, FSSAI number, nutritional info, everything. The text in this image may be rotated, curved around a cylindrical package, printed on crinkled foil, or partially obscured. Read it in whatever orientation it appears. If part of the label is cut off or unreadable, extract everything you can and note which sections were unreadable. Return ONLY the extracted text, nothing else.";

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

  let extractedText: string;
  try {
    const message = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2000,
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
    if (err instanceof Anthropic.AuthenticationError) {
      return jsonError("Enhanced reading is not configured correctly.", 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError("Enhanced reading is busy. Try again in a moment.", 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      // Almost always an unreadable or unsupported image.
      return jsonError(
        "That image could not be read. Retake the photo in good light.",
        422,
      );
    }
    if (err instanceof Anthropic.APIError) {
      return jsonError("The enhanced reading service failed to respond.", 502, {
        detail: err.message,
      });
    }
    return jsonError("Unexpected error during enhanced reading.", 500);
  }

  if (!extractedText) {
    return jsonError("No text could be read from this image.", 422);
  }

  return NextResponse.json({ extractedText });
}
