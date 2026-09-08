import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error(
    "Missing ANTHROPIC_API_KEY. Set it in .env.local (server-side only).",
  );
}

export const anthropic = new Anthropic({ apiKey });

/** Full analysis (structured reasoning over the reference data). */
export const CLAUDE_MODEL = "claude-sonnet-5";

/**
 * Cheap, fast vision model used only for the OCR fallback in
 * /api/extract-text — read the label, return raw text, nothing else.
 */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/**
 * Send a single prompt to Claude and return the concatenated text response.
 * Intended for use in server components, route handlers, and server actions.
 */
export async function askClaude(
  prompt: string,
  system?: string,
): Promise<string> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
