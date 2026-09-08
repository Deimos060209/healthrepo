import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import {
  BANNED_INGREDIENTS,
  HARMFUL_ADDITIVES,
  FSSAI_ADDITIVE_LIMITS,
  LEGAL_METROLOGY_RULES,
  PRODUCT_CATEGORIES,
  HEALTHIER_ALTERNATIVES,
  REFERENCE_METADATA,
} from "@/lib/reference-data";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import type { AnalyzeRequestBody, ProductAnalysis } from "@/types/analysis";

// Analysis can take 20–40s for a busy label; give Vercel room.
// 60 is the Hobby-plan ceiling — raise it if you are on Pro and still see cutoffs.
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Output ceiling. Measured against this prompt's response contract: the fixed
 * overhead (11 compliance entries + 15 banned-list checks + product_info +
 * overall_assessment) is ~920 tokens, and each flagged ingredient echoing the
 * reference text costs ~280. A heavily-additive product (8 flagged, 20 total
 * ingredients) lands near 4,400 tokens, so anything at or below 4,096 truncates
 * the JSON on exactly the products this app exists to scrutinise. The
 * dosage_analysis block adds ~500-800 tokens on such a product (one limit_check
 * per additive plus counts and warnings), for a worst case near 5,200. 8,000
 * halves the worst-case generation time versus the previous 16,000 while
 * keeping ~1.5x headroom over that measured worst case.
 */
const MAX_OUTPUT_TOKENS = 8000;

/** The reference knowledge base, embedded verbatim in the system prompt. */
const REFERENCE_DATA_BLOCK = [
  "===== BANNED_INGREDIENTS (prohibited in India — any match MUST be marked 'banned') =====",
  JSON.stringify(BANNED_INGREDIENTS),
  "",
  "===== HARMFUL_ADDITIVES (legal in India but of concern — map concern_level: high->'harmful', medium/low->'caution') =====",
  JSON.stringify(HARMFUL_ADDITIVES),
  "",
  "===== FSSAI_ADDITIVE_LIMITS (FSSAI prescribed maximum levels — basis for dosage_analysis; fssai_max_limit_mg_per_kg null = GMP/no fixed number) =====",
  JSON.stringify(FSSAI_ADDITIVE_LIMITS),
  "",
  "===== LEGAL_METROLOGY_RULES (basis for legal_metrology_compliance) =====",
  JSON.stringify(LEGAL_METROLOGY_RULES),
  "",
  "===== HEALTHIER_ALTERNATIVES (use for the healthier_alternative field) =====",
  JSON.stringify(HEALTHIER_ALTERNATIVES),
  "",
  "===== PRODUCT_CATEGORIES =====",
  JSON.stringify(PRODUCT_CATEGORIES),
  "",
  "===== REFERENCE_METADATA =====",
  JSON.stringify(REFERENCE_METADATA),
].join("\n");

const SYSTEM_PROMPT = `You are an expert food safety analyst for Indian consumers, with deep knowledge of FSSAI regulations, the Legal Metrology (Packaged Commodities) Rules 2011, and international food-safety databases (EU/EFSA, US FDA, WHO/IARC, Codex). Use the EXACT reference data below for your analysis.

Before analyzing, verify the text looks like real product packaging. If the text appears garbled or nonsensical (random characters, no recognisable words, OCR noise with no structure), respond with ONLY this JSON object and nothing else:
{ "error": "garbled_text", "message": "The extracted text appears corrupted", "recommendation": "Please retake the photo" }
Only proceed with the full analysis described below if the text is reasonably coherent.

For every ingredient you flag:
- Include the detailed 'why_banned' or 'why_concerning' explanation from the reference data so the consumer understands the reason.
- Include the detailed 'health_effects_detailed' so the consumer knows what it does to their body.
- Include 'who_should_avoid' information.
- Include which countries have banned/restricted it.
- Include the healthier alternative.

CRITICAL RULES:
- If an ingredient matches BANNED_INGREDIENTS -> mark as 'banned', include full why_banned and health_effects_detailed.
- If an ingredient matches HARMFUL_ADDITIVES -> mark based on concern_level (high -> 'harmful', medium -> 'caution', low -> 'caution'), include full health_effects_detailed and why_concerning.
- If an ingredient is NOT in either list but you know from your training data that it is harmful, banned in other countries, or has documented health concerns -> STILL FLAG IT as 'caution' or 'harmful' with your explanation. Our lists are comprehensive but may not cover everything.
- Specifically check for COMBINATIONS — e.g. Sodium Benzoate (or any benzoate: E210-E213) together with Vitamin C / Ascorbic Acid (E300) in the same product = benzene risk. Flag the combination explicitly as its own ingredient_analysis entry.
- For ingredients you're uncertain about, mark as 'unknown' and note what is known.
- Check against EU, US FDA, WHO/IARC, and other international databases from your knowledge.
- Set 'source' to 'reference_database' when the finding comes from the provided lists, or 'ai_knowledge' when it comes from your own training.
- Also return a field 'ingredients_not_in_database' for any ingredients you flagged from your own knowledge that weren't in the provided lists — so we can update our database.

DOSAGE AND LIMIT CHECKING:
For each additive found in the ingredients list:
1. Check if it has a prescribed FSSAI limit from the FSSAI_ADDITIVE_LIMITS reference (match on name, also_known_as, e_code or ins_code). Use the special_limits entry for this product's category where one applies, otherwise fssai_max_limit_mg_per_kg. A null limit means the additive is permitted at GMP — there is no fixed number, so heavy or prominent use is the concern.
2. Look at the nutritional information and label declarations for any quantity declaration for that additive (e.g. "Contains permitted class II preservative (INS 211) 150 mg/kg", "Added colour 100 mg/kg").
3. If the product label declares the quantity of an additive, compare it to the FSSAI limit for that product category and set status to 'within_limit' or 'exceeds_limit'. Put the numbers in 'note'.
4. If the label does NOT declare the quantity (which is common), set status to 'quantity_not_declared' and note "unable to verify — quantity not declared on label".
5. If multiple preservatives or multiple colours are present, add a combination_warnings entry: "This product uses X different preservatives/colours. While each may be within individual limits, the COMBINED load increases health risk. FSSAI limits are per-additive, but cumulative exposure is a growing concern." Also flag benzoate (E210-E213) together with ascorbic acid / vitamin C (E300) as a benzene-formation risk.
6. Calculate an approximate safe daily intake where possible: for an additive with an ADI (adi_mg_per_kg_body_weight) at concentration C mg/kg or mg/l, a 60 kg adult's daily allowance is 60 x ADI mg; divide by C to get the kg or litres of product that reaches the ADI, and express it as servings (assume a 600 ml bottle / 250 ml glass for drinks, a 50 g pack for snacks) in 'daily_intake_warning'. If no ADI or no concentration is available, set daily_intake_warning to null.

USER PERSONAL HEALTH PROFILE:
If — and only if — a "USER PERSONAL HEALTH PROFILE" section is present in the user message, the user has the following dietary criteria and health conditions. Flag ANY ingredient that conflicts with their profile, even if the ingredient is otherwise safe for the general population.

The section lists, when set:
Allergies: [list]
Dietary preferences: [list]
Health conditions: [list]
Custom ingredients to avoid: [list]

For each ingredient, populate the 'personal_flags' field — an array of objects: { reason: string, severity: 'critical' | 'warning' | 'info' }. Leave it as [] when the ingredient does not conflict with the profile, and [] for EVERY ingredient when no profile section is present.

Examples:
- User is allergic to nuts -> ingredient contains 'almond extract' -> personal_flag: { reason: 'Contains tree nut derivative — you listed nut allergy', severity: 'critical' }
- User selected 'no sugar' -> ingredient is 'sugar' or 'sucrose' or 'dextrose' -> personal_flag: { reason: 'Contains sugar — conflicts with your no-sugar preference', severity: 'warning' }
- User is diabetic -> ingredient is 'high fructose corn syrup' -> personal_flag: { reason: 'High glycemic ingredient — risky for diabetic condition', severity: 'critical' }
- User selected 'no artificial colors' -> ingredient is 'Tartrazine' -> personal_flag: { reason: 'Artificial color — conflicts with your preference', severity: 'warning' }
- User is pregnant -> ingredient is 'Aspartame' -> personal_flag: { reason: 'Artificial sweetener — consult your doctor during pregnancy', severity: 'warning' }
- User has hypertension -> product has high sodium -> personal_flag: { reason: 'High sodium content — risky with hypertension', severity: 'critical' }
- User wants to avoid 'palm oil' -> ingredient contains palm oil -> personal_flag: { reason: 'Contains palm oil — you chose to avoid this', severity: 'warning' }
- User has ADHD child -> product contains Southampton Six dyes -> personal_flag: { reason: 'Contains dye linked to hyperactivity in children', severity: 'critical' }
- User has PKU -> product contains Aspartame -> personal_flag: { reason: 'Contains phenylalanine — DANGEROUS for PKU', severity: 'critical' }

Severity guide:
- critical: allergen present, or ingredient is medically dangerous for their condition
- warning: conflicts with a dietary preference or is concerning for their condition
- info: mild relevance, worth noting

Also return a top-level 'personal_alerts' array of { ingredient: string|null, reason: string, severity: 'critical' | 'warning' | 'info' } for profile conflicts that concern the WHOLE product rather than one named ingredient (e.g. overall high sodium/sugar/fat content vs a condition or preference). Use ingredient: null for those. Use [] when there is no profile or no product-level conflict. Do NOT duplicate an ingredient-level personal_flag here.

If the user has no health profile set (no profile section in the user message), skip all of the above: 'personal_flags' is [] on every ingredient and 'personal_alerts' is [].

Return ONLY a single valid JSON object (no markdown, no code fences, no text outside the JSON) with EXACTLY these keys:

1. product_info: { name, brand, category, net_weight, mrp, manufacture_date, expiry_date, manufacturer_address, fssai_license, batch_number, customer_care, country_of_origin } — use null for anything not found. 'category' should be one of the PRODUCT_CATEGORIES ids where possible.

2. legal_metrology_compliance: an object with one key per mandatory declaration in LEGAL_METROLOGY_RULES.MANDATORY_DECLARATIONS (manufacturer_info, generic_name, net_quantity, manufacture_date, best_before_use_by, mrp, unit_sale_price, consumer_care, country_of_origin, fssai_license, dimensions_if_applicable). For each: { present: boolean, value: string|null, compliant: boolean, issue: string|null }. Use each rule's 'details' text to judge 'compliant' and to write 'issue'. For country_of_origin and dimensions_if_applicable, if not applicable to this product set present=false, compliant=true, issue="Not applicable".

3. ingredient_analysis: an array; for EACH ingredient found in the text:
   {
     name: string,
     safety_status: 'safe' | 'caution' | 'harmful' | 'banned' | 'unknown',
     reason: string,                 // plain-language WHY (from reference data or your knowledge)
     health_effects: string,         // plain-language what it does to the human body
     who_should_avoid: string,       // specific higher-risk groups (children, pregnant women, asthmatics, elderly, etc.)
     banned_in_countries: string[],  // countries/regions that ban or restrict it (empty array if none)
     healthier_alternative: string,  // what to use instead
     source: 'reference_database' | 'ai_knowledge',
     personal_flags: array of { reason: string, severity: 'critical' | 'warning' | 'info' }  // conflicts with the USER PERSONAL HEALTH PROFILE; [] if none or no profile
   }

4. overall_assessment: { safety_score: 0-100, compliance_score: 0-100, summary: string, recommendation: string (should the user consume this?) }

5. banned_ingredients_check: an array; explicitly check the product against the FSSAI banned list (every entry in BANNED_INGREDIENTS — Potassium Bromate, Brominated Vegetable Oil, Metanil Yellow, Rhodamine B, Sudan dyes, Calcium Carbide, Formalin, Oxytocin, Malachite Green, Lead Chromate, Copper Sulphate, Argemone, Toluene in packaging, stapler pins in tea bags, Titanium Dioxide). For each: { ingredient: string, detected: boolean, notes: string|null }.

6. ingredients_not_in_database: an array of { name: string, why_flagged: string, suggested_status: 'safe' | 'caution' | 'harmful' | 'banned' | 'unknown' } for ingredients you flagged from your own knowledge that were absent from the provided lists. Use [] if none.

7. dosage_analysis: {
     additive_count: { preservatives: number, colors: number, sweeteners: number, antioxidants: number, emulsifiers: number, flavor_enhancers: number, total: number } — count every additive of each kind found in the ingredients list,
     limit_checks: array of { name: string, fssai_limit: string|null (the applicable FSSAI maximum as text, e.g. "200 mg/kg (beverages)"), declared_quantity_if_available: string|null, status: 'within_limit' | 'exceeds_limit' | 'quantity_not_declared', note: string|null },
     cumulative_risk: 'low' | 'medium' | 'high' — based on the total number of additives and their concern levels (few, low-concern additives = low; several or any high-concern = medium; many additives or an exceeded limit or a dangerous combination = high),
     daily_intake_warning: string|null — how much of this product a 60 kg adult can safely consume per day, per rule 6 above; null if not calculable,
     combination_warnings: string[] — one entry per dangerous combination (multiple preservatives, multiple colours, benzoate + ascorbic acid, …); [] if none
   }

8. personal_alerts: array of { ingredient: string|null, reason: string, severity: 'critical' | 'warning' | 'info' } — product-level conflicts with the USER PERSONAL HEALTH PROFILE (see the USER PERSONAL HEALTH PROFILE section above). [] when there is no profile or no product-level conflict.

If the text is too garbled or sparse to identify a product, still return the full JSON structure with best-effort nulls, empty arrays, zeroed additive_count, cumulative_risk 'low', personal_flags [] on every ingredient, personal_alerts [], and a summary explaining that the text could not be reliably read.

${REFERENCE_DATA_BLOCK}`;

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Pull a JSON object out of Claude's reply. Despite the "ONLY valid JSON"
 * instruction, models occasionally wrap the payload in ```json fences or add a
 * stray sentence, so fall back to slicing between the first `{` and last `}`.
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new SyntaxError("No JSON object found in the model response.");
}

/**
 * Render the optional user health profile as the "USER PERSONAL HEALTH PROFILE"
 * block appended to the user message. Returns "" when no profile / no criteria,
 * so the cached system prompt never changes shape between callers.
 */
function formatHealthProfile(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const p = raw as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

  const allergies = list(p.allergies);
  const diet = list(p.dietary_preferences);
  const conditions = list(p.health_conditions);
  const custom = list(p.custom_avoid_ingredients);

  if (
    allergies.length === 0 &&
    diet.length === 0 &&
    conditions.length === 0 &&
    custom.length === 0
  ) {
    return "";
  }

  return [
    "USER PERSONAL HEALTH PROFILE:",
    `Allergies: ${allergies.join(", ") || "none"}`,
    `Dietary preferences: ${diet.join(", ") || "none"}`,
    `Health conditions: ${conditions.join(", ") || "none"}`,
    `Custom ingredients to avoid: ${custom.join(", ") || "none"}`,
    "Apply the personal_flags / personal_alerts rules from the system prompt to this profile.",
  ].join("\n");
}

export async function POST(request: Request) {
  let body: AnalyzeRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const extractedText =
    typeof body?.extractedText === "string" ? body.extractedText.trim() : "";

  if (!extractedText) {
    return jsonError(
      "`extractedText` is required and must be a non-empty string.",
      400,
    );
  }

  if (extractedText.length > 20_000) {
    return jsonError(
      "`extractedText` is too long (limit 20,000 characters).",
      413,
    );
  }

  const healthProfileBlock = formatHealthProfile(body?.userHealthProfile);

  let responseText: string;
  let stoppedAtCap = false;
  try {
    // Streamed rather than a single blocking call: the connection stays active
    // for the whole generation, so a slow analysis cannot be dropped by an idle
    // timeout somewhere between here and the API.
    const message = await anthropic.messages
      .stream({
        model: CLAUDE_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // The reference-data block is large and static — cache it so repeat
        // scans only pay full price for it once every few minutes.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              "Text extracted from a packaged product via OCR follows.",
              "It may contain OCR noise, broken words, and out-of-order lines.",
              "",
              extractedText,
              ...(healthProfileBlock ? ["", healthProfileBlock] : []),
            ].join("\n"),
          },
        ],
      })
      .finalMessage();

    stoppedAtCap = message.stop_reason === "max_tokens";

    responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      // Don't leak key/config detail to the client.
      return jsonError("Analysis service is not configured correctly.", 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError("Analysis service is busy. Try again in a moment.", 429);
    }
    if (err instanceof Anthropic.APIError) {
      return jsonError("The analysis service failed to respond.", 502, {
        detail: err.message,
      });
    }
    return jsonError("Unexpected error while contacting the analysis service.", 500);
  }

  if (!responseText) {
    return jsonError("The analysis service returned an empty response.", 502);
  }

  let analysis: ProductAnalysis;
  try {
    const parsed = extractJson(responseText);

    // Claude was told to bail out on unreadable OCR text rather than
    // hallucinate an analysis — pass that decision straight through to the UI.
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { error?: unknown }).error === "garbled_text"
    ) {
      const g = parsed as { message?: unknown; recommendation?: unknown };
      return NextResponse.json(
        {
          error: "garbled_text",
          message:
            typeof g.message === "string" && g.message.trim()
              ? g.message.trim()
              : "The extracted text appears corrupted",
          recommendation:
            typeof g.recommendation === "string" && g.recommendation.trim()
              ? g.recommendation.trim()
              : "Please retake the photo",
        },
        { status: 422 },
      );
    }

    // Normalised, not cast — the client renders this without further guarding.
    analysis = normalizeAnalysis(parsed);
  } catch {
    // Distinguish "ran out of room" from "model returned malformed JSON" —
    // the first is a config problem, the second is a model problem.
    if (stoppedAtCap) {
      return jsonError(
        "This label produced more analysis than the response limit allows. Try scanning a smaller portion of the ingredients list.",
        502,
        { reason: "max_tokens", limit: MAX_OUTPUT_TOKENS },
      );
    }
    return jsonError("Could not parse the analysis response as JSON.", 502, {
      raw: responseText.slice(0, 2000),
    });
  }

  return NextResponse.json({
    analysis,
    imageUrl: body.imageUrl ?? null,
    model: CLAUDE_MODEL,
  });
}
