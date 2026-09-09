import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";

// Sonnet on a single image is heavier than Haiku; give it room but stay under
// the Hobby cap.
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tier 3 OCR fallback — the final, most accurate attempt.
 *
 * The scan page reaches here only after BOTH Tesseract.js (tier 1, free) and
 * the Haiku Vision route (tier 2, cheap) have failed the structural-marker
 * validation. This uses the full Sonnet model with a detailed prompt, so it is
 * the most expensive leg of the chain — it should fire rarely.
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

const SYSTEM_PROMPT = `You are an expert at reading text from product packaging images, including blurry, curved, small, and low-contrast text. This image has already been attempted by OCR and a smaller model, both of which failed to extract sufficient text. The text in this image may be rotated, curved around a cylindrical package, printed on crinkled foil, or partially obscured. Read it in whatever orientation it appears. If part of the label is cut off or unreadable, extract everything you can and note which sections were unreadable. Try your absolute best to read every piece of text on this package including:
- Product name and brand
- Complete ingredients list (this is the MOST important part)
- MRP and price information
- Manufacturing and expiry dates
- Manufacturer name and address
- FSSAI license number
- Nutritional information table
- Allergen declarations
- Net weight/volume
- Any warnings or claims

If certain areas are genuinely unreadable, note which fields you could not read and why (too blurry, obscured, etc). Return ALL text you can extract, organized by section.

After the extracted text, output one final line, exactly in this form and with nothing after it:
UNREADABLE_FIELDS: <comma-separated list of the fields you could not read, or the single word none>`;

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Pull the trailing `UNREADABLE_FIELDS:` line out of the model reply. */
function splitUnreadable(raw: string): {
  extractedText: string;
  unreadableFields: string[];
} {
  const m = raw.match(/^[ \t]*UNREADABLE_FIELDS[ \t]*:[ \t]*(.*)$/im);
  if (!m || m.index === undefined) {
    return { extractedText: raw.trim(), unreadableFields: [] };
  }
  const extractedText = raw.slice(0, m.index).trimEnd();
  const listed = m[1].trim();
  const unreadableFields =
    !listed || /^none\.?$/i.test(listed)
      ? []
      : listed
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean);
  return { extractedText, unreadableFields };
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

  let rawText: string;
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      // Extended thinking is on by default for claude-sonnet-5 and its tokens
      // come out of max_tokens, so a thinking block can swallow the whole
      // budget and leave no transcription behind. This tier only has to READ
      // the label — turn thinking off so the entire budget is text.
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
              text: "Read every piece of text on this product package, section by section, then finish with the UNREADABLE_FIELDS line.",
            },
          ],
        },
      ],
    });

    rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return jsonError("Advanced reading is not configured correctly.", 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError("Advanced reading is busy. Try again in a moment.", 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      return jsonError(
        "That image could not be read. Retake the photo in good light.",
        422,
      );
    }
    if (err instanceof Anthropic.APIError) {
      return jsonError("The advanced reading service failed to respond.", 502, {
        detail: err.message,
      });
    }
    return jsonError("Unexpected error during advanced reading.", 500);
  }

  if (!rawText) {
    return jsonError("No text could be read from this image.", 422);
  }

  const { extractedText, unreadableFields } = splitUnreadable(rawText);

  if (!extractedText) {
    return jsonError("No text could be read from this image.", 422, {
      unreadableFields,
    });
  }

  return NextResponse.json({ extractedText, unreadableFields });
}
