import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { anthropicPreflight, handleAnthropicError } from "@/lib/anthropic-errors";

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

// FIX 1.1 — this tier is the last, most expensive reader and had been prone to
// narrating the photo instead of transcribing it. It is an OCR engine, not a
// describer: output the literal printed text, organised by section, and
// nothing else, followed only by the UNREADABLE_FIELDS line the app parses.
const SYSTEM_PROMPT = `You are an OCR transcription engine reading a product package image that a smaller model already failed to extract enough text from. Output ONLY the text printed on the package, exactly as printed, organised by section (product name/brand, ingredients, MRP, dates, manufacturer, FSSAI licence, nutritional table, allergens, net weight, warnings).

STRICT RULES:
- Do NOT describe the image, packaging, lighting or photo quality
- Do NOT write "Based on the image", "This appears to be", "I can make out", "Here's what I can partially make out", or any similar framing
- Do NOT invent headings beyond the label's own sections, add commentary, or interpret
- Do NOT summarise. Transcribe.
- Where text is genuinely unreadable, write [unreadable] inline at that position and continue. Do not explain why inline — list it in UNREADABLE_FIELDS instead.

Text may be rotated, curved around a cylinder, on crinkled foil, or in very small type. Read it in whatever orientation it appears. Work systematically across the whole label including the smallest print.

After the transcription, output one final line, exactly in this form and with nothing after it:
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
  let body: { imageBase64?: unknown; mediaType?: unknown; retryHint?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  // FIX 1.2 — when the caller detected a narration-style response from a
  // previous call, it resends the SAME image with this hint so the retry is
  // explicitly told to stop describing and start transcribing.
  const retryHint =
    typeof body.retryHint === "string" ? body.retryHint.trim().slice(0, 400) : "";

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

  const preflight = anthropicPreflight("extract-text-advanced");
  if (preflight) return preflight;

  let rawText: string;
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      // FIX 9.1 — NOTE: `temperature` is deprecated/rejected (400) on
      // claude-sonnet-5 — verified live against the real API. Not settable
      // here; see extract-text/route.ts (Haiku) for the tier that can use it.
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
              text: retryHint
                ? `${retryHint}\n\nRead every piece of text on this product package, section by section, then finish with the UNREADABLE_FIELDS line.`
                : "Read every piece of text on this product package, section by section, then finish with the UNREADABLE_FIELDS line.",
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
    // Recognised infrastructure outages (credits, rate limit, overload, key,
    // connectivity) -> specific code + retryable flag, raw message never leaked.
    const outage = handleAnthropicError(err, "extract-text-advanced");
    if (outage) return outage;
    if (
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.UnprocessableEntityError
    ) {
      return jsonError(
        "That image could not be read. Retake the photo in good light.",
        422,
      );
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
