import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL, HAIKU_MODEL } from "@/lib/claude";
import {
  PRODUCT_CATEGORY_RULES,
  buildCompactReference,
  normalizeCompactCategory,
} from "@/lib/reference-data";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import { enrichAnalysis } from "@/lib/enrich-analysis";
import type {
  AnalyzeRequestBody,
  DetectedCategoryId,
  ProductAnalysis,
} from "@/types/analysis";

// The Sonnet analysis can take 20-40s for a busy label; give Vercel room.
// 60 is the Vercel Hobby-plan cap for `maxDuration` — raise it only on Pro.
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Output ceiling. The response contract is tight — flagged ingredients return
 * only { name, safety_status, source, reason } (the long explanations are
 * re-attached locally by lib/enrich-analysis.ts), banned_ingredients_check
 * returns only the ingredients actually detected, and the summary is capped at
 * 3 sentences.
 *
 * Measured with THINKING_OFF below: a personal-care label lands ~2,500 output
 * tokens and a heavily-additive food label ~3,400. 3,000 truncated the food
 * case mid-JSON (stop_reason "max_tokens" -> unparseable), so this is 4,000:
 * ~1.2x headroom over the worst case measured, still well inside `maxDuration`.
 */
const MAX_OUTPUT_TOKENS = 4000;

/**
 * Extended thinking is ON BY DEFAULT for claude-sonnet-5, and its thinking
 * tokens are drawn from the SAME max_tokens budget as the answer. With it on,
 * every analysis burned the whole budget on a thinking block and returned
 * either truncated JSON or no text block at all — a hard 502 on every scan.
 *
 * This task is schema-constrained extraction against a reference table supplied
 * in the prompt, not open-ended reasoning, so thinking buys nothing here while
 * costing ~2,500 extra output tokens and ~10s of latency per scan. Turn it off
 * explicitly rather than relying on the model default.
 */
const THINKING_OFF = { type: "disabled" } as const;

/**
 * STEP A router prompt. Haiku is cheap and fast — it only names the product
 * category so STEP B can be handed a category-scoped compact reference instead
 * of the entire knowledge base.
 */
const CATEGORY_ROUTER_SYSTEM = `Identify the product category from this text extracted from a photo. Return ONLY minified JSON:
{"category":"food_and_beverages"|"personal_care"|"household_cleaning"|"baby_product_food"|"baby_product_care"|"not_a_packaged_product"|"unknown","confidence":"high"|"medium"|"low","signals":string[],"detected":string}

Use category "not_a_packaged_product" when ANY of these hold:
- there is no printed label text at all, or fewer than 15 meaningful words
- the text describes loose produce, fresh fruit or vegetables, an unwrapped or home-made item, a person, a scene, a handwritten note, or anything that is not a manufactured labelled package
- there is no MRP, no ingredients list, no manufacturer, no dates and no barcode anywhere in the text
"detected" = a short plain-language guess at what the photo actually shows (e.g. "a fresh apple", "loose vegetables", "an unpackaged item", "a person", "a printed page"). For a real package set "detected" to "".
signals = up to 6 short words or phrases from the text that decided it. No prose, no code fences.`;

/**
 * STEP B system prompt — block 1 of 2. Fully static, so it caches once for
 * every scan regardless of category. The category-scoped compact reference is
 * block 2 (built per request in the handler) and caches per category.
 */
const STATIC_SYSTEM = `You are an expert product-safety analyst for Indian consumers, with deep knowledge of FSSAI regulations, the Legal Metrology (Packaged Commodities) Rules 2011, the Drugs and Cosmetics Act 1940, BIS standards, and international safety databases (EU/EFSA, US FDA, WHO/IARC, Codex). Use the COMPACT REFERENCE DATA in the second system block for identification and classification.

Before analysing, verify the text looks like real product packaging. If it is garbled or nonsensical (random characters, OCR noise with no structure), respond with ONLY this JSON and nothing else:
{ "error": "garbled_text", "message": "The extracted text appears corrupted", "recommendation": "Please retake the photo" }

The product category has ALREADY been identified — see "ACTIVE CATEGORY" and the COMPACT REFERENCE DATA in the second system block. Do NOT re-derive it. Analyse the product strictly under that category's rules and set detected_category.category to the ACTIVE CATEGORY value.

ANTI-HALLUCINATION — DO NOT INVENT WHAT YOU CANNOT SEE:
NEVER produce a compliance verdict, safety score, or violation list for information that is not actually present in the extracted text.
- A mandatory declaration that is not in the text because the text is incomplete or only part of the pack was photographed => status: "not_visible", NOT "missing". "missing" means the label is legible and the declaration is genuinely absent; "not_visible" means you cannot tell.
- If MORE THAN 3 declarations are "not_visible", do NOT return a compliance score: set overall_assessment.compliance_score to null and overall_assessment.compliance_status to "insufficient_data".
- If NO ingredients were found in the text, do NOT return a safety score: set overall_assessment.safety_score to null and overall_assessment.safety_status to "insufficient_data", and return ingredient_analysis as [].
- Never infer a product's identity from packaging colours or style. If the brand or product name is not legible in the text, set product_info.name (and brand) to null. NEVER return a guessed name, and NEVER put a hedge or disclaimer inside the name field (no "inferred from…", no "(not confirmed)").
- When you can see enough to score normally, set safety_status and compliance_status to "ok".

CATEGORY-SPECIFIC RULES:
- food_and_beverages / baby_product_food: check ingredients against banned_ingredients, harmful_additives and fssai_limits; check Legal Metrology + the FSSAI food labels; verify the 14-digit FSSAI licence format; flag allergens. Complaint portal: FSSAI Food Safety Connect.
- personal_care / baby_product_care: check against the (cosmetic) banned_ingredients and harmful_additives lists. Do NOT flag ordinary cosmetic ingredients as 'harmful' — SLS/SLES in a wash-off product is 'caution', not 'harmful'; reserve 'harmful' for genuine dermal-absorption dangers. FSSAI licence / veg-nonveg / nutrition table are NOT applicable — mark those declarations present:false, compliant:true, issue:"Not applicable to personal care products". Complaint portal: CDSCO consumer corner + National Consumer Helpline.
- household_cleaning: check against household_safety and surface each safety_note (ventilation, do-not-mix-with-bleach/ammonia). Treat a missing 'keep out of reach of children' warning or missing first-aid instructions as compliance issues. FSSAI / nutrition / veg-nonveg NOT applicable. Complaint portal: National Consumer Helpline + BIS.
- baby_product_*: apply stricter_thresholds_note — zero tolerance for artificial colours, artificial sweeteners and harmful preservatives; flag even 'low' concern ingredients as 'caution'.

SAME INGREDIENT, DIFFERENT RATING BY CATEGORY (deliberate): Sodium Lauryl Sulfate in a SHAMPOO => 'caution'; in FOOD => 'harmful'. Tartrazine / synthetic dye in FOOD => 'harmful' (ingested, Southampton Six); in a rinse-off SHAMPOO => 'caution'. Judge every ingredient in the context of the ACTIVE CATEGORY.

INGREDIENT OUTPUT — KEEP IT SHORT:
For an ingredient you recognise from the COMPACT REFERENCE DATA: set source to 'reference_database' and return only { name, safety_status, reason (ONE line, <= 20 words), source, personal_flags }. Leave health_effects "", who_should_avoid "", banned_in_countries [], healthier_alternative "" — the server fills those from its local database. Do NOT write long explanations for these.
For an ingredient NOT in the reference data that you know from your own training to be harmful, restricted, or of documented concern: STILL flag it, set source to 'ai_knowledge', and THEN write the full health_effects, who_should_avoid, banned_in_countries and healthier_alternative yourself.
Mapping: any match in banned_ingredients -> 'banned'. harmful_additives concern_level high -> 'harmful' (food) / 'caution' (personal care unless egregious), medium or low -> 'caution'. Uncertain -> 'unknown'.
Check explicitly for a benzoate (E210-E213) together with ascorbic acid / vitamin C (E300) -> benzene risk; emit it as its own ingredient_analysis entry.
Also return 'ingredients_not_in_database' for every ingredient you flagged from your own knowledge.

DOSAGE AND LIMIT CHECKING (food categories only — for personal_care / household_cleaning return additive_count zeroed, limit_checks [], cumulative_risk 'low', daily_intake_warning null, combination_warnings []):
For each additive in the ingredients list, match it against fssai_limits (name / also_known_as / e_code / ins_code) and use the special_limits entry for this product type where one applies, otherwise fssai_max_limit_mg_per_kg (null = permitted at GMP). If the label declares a quantity, compare and set 'within_limit' / 'exceeds_limit'; otherwise 'quantity_not_declared'. Add a combination_warnings entry when several preservatives or several colours are present, or for benzoate + ascorbic acid. Where an ADI and a declared or estimable concentration exist, compute how much of the product a 60 kg adult can safely have per day and put it in daily_intake_warning (assume a 600 ml bottle / 250 ml glass for drinks, a 50 g pack for snacks); otherwise null.

USER PERSONAL HEALTH PROFILE:
If — and only if — a "USER PERSONAL HEALTH PROFILE" section is present in the user message, flag ANY ingredient that conflicts with it, even if the ingredient is otherwise safe. Populate each ingredient's 'personal_flags' array with { reason, severity: 'critical' | 'warning' | 'info' } ([] when no conflict, [] for EVERY ingredient when no profile is present). Also return a top-level 'personal_alerts' array of { ingredient: string|null, reason, severity } for whole-product conflicts (e.g. overall high sodium vs hypertension); use ingredient: null for those and do not duplicate an ingredient-level flag. Severity: critical = allergen present or medically dangerous; warning = conflicts with a preference or concerning for a condition; info = mild relevance.

Return ONLY a single valid JSON object (no markdown, no code fences, no text outside the JSON) with EXACTLY these keys:

1. product_info: { name, brand, category, net_weight, mrp, manufacture_date, expiry_date, manufacturer_address, fssai_license, batch_number, customer_care, country_of_origin } — null for anything not found.

2. legal_metrology_compliance: an object with one key per mandatory declaration (manufacturer_info, generic_name, net_quantity, manufacture_date, best_before_use_by, mrp, unit_sale_price, consumer_care, country_of_origin, fssai_license, dimensions_if_applicable). For each: { present: boolean, value: string|null, compliant: boolean, issue: string|null, status: "present"|"missing"|"not_visible"|"not_applicable" }. Use "not_visible" per the ANTI-HALLUCINATION rules — only use "missing" when the label is legible and the declaration is truly absent. For a declaration not applicable to the ACTIVE CATEGORY set present:false, compliant:true, status:"not_applicable", issue:"Not applicable to <category> products".

3. ingredient_analysis: an array, one entry per ingredient found in the text:
   { name, safety_status: 'safe'|'caution'|'harmful'|'banned'|'unknown', reason (one line), health_effects, who_should_avoid, banned_in_countries (string[]), healthier_alternative, source: 'reference_database'|'ai_knowledge', personal_flags: array of { reason, severity } }.
   Per "KEEP IT SHORT" above, the four long fields stay empty for 'reference_database' ingredients.

4. overall_assessment: { safety_score: 0-100 or null, compliance_score: 0-100 or null, safety_status: "ok"|"insufficient_data", compliance_status: "ok"|"insufficient_data", summary: string (MAX 3 sentences — this is shown only inside a collapsed "Full assessment" section, so it does not need to lead), recommendation: string }. Per the ANTI-HALLUCINATION rules, a score is null exactly when its status is "insufficient_data".

4a. verdict: one of 'safe' | 'caution' | 'avoid' — the single top-line call the user sees first. 'safe' roughly maps to safety_score >= 75 with no harmful/banned ingredients; 'avoid' to any banned ingredient, a serious personal_alert, or safety_score < 50; 'caution' otherwise. If safety_status is "insufficient_data", still give your best-judgement verdict from what you could read.

4b. verdict_reason: ONE plain sentence backing the verdict, MAXIMUM 20 words. No lists, no semicolons.

4c. key_findings: an array of 2 to 4 short strings — the most important things the user should know, each UNDER 12 words, each a single line, no trailing punctuation. Examples: "Contains 2 harmful additives", "Missing net quantity declaration", "High sugar: 68g per 100g", "No banned ingredients found". Order most-important first.

5. banned_ingredients_check: an array containing ONLY the banned-list ingredients you ACTUALLY detected in this product — { ingredient: string, detected: true, notes: string|null }. Return [] if none are present. Do NOT emit an entry for banned items that are absent.

6. ingredients_not_in_database: array of { name, why_flagged, suggested_status } for ingredients you flagged from your own knowledge that were absent from the reference data. [] if none.

7. dosage_analysis: { additive_count: { preservatives, colors, sweeteners, antioxidants, emulsifiers, flavor_enhancers, total }, limit_checks: array of { name, fssai_limit: string|null, declared_quantity_if_available: string|null, status: 'within_limit'|'exceeds_limit'|'quantity_not_declared', note: string|null }, cumulative_risk: 'low'|'medium'|'high', daily_intake_warning: string|null, combination_warnings: string[] }.

8. personal_alerts: array of { ingredient: string|null, reason, severity: 'critical'|'warning'|'info' } — product-level profile conflicts; [] when there is no profile or no conflict.

9. detected_category: { category: the ACTIVE CATEGORY value, confidence: 'high'|'medium'|'low', signals_found: string[], regulatory_body: string, applicable_act: string, complaint_portal: string } — take regulatory_body / applicable_act / complaint_portal from the ACTIVE CATEGORY block.

If the text is too garbled or sparse to identify a product, still return the full JSON structure with best-effort nulls, empty arrays, zeroed additive_count, cumulative_risk 'low', empty personal_flags/personal_alerts, safety_score null + safety_status "insufficient_data", compliance_score null + compliance_status "insufficient_data", verdict 'caution', verdict_reason "Not enough of the label was readable to judge this product.", key_findings ["Only part of the label could be read"], detected_category with the ACTIVE CATEGORY value and confidence 'low', and a summary explaining the text could not be reliably read.`;

const VALID_CATEGORY_OVERRIDES: DetectedCategoryId[] = [
  "food_and_beverages",
  "personal_care",
  "household_cleaning",
  "baby_product_food",
  "baby_product_care",
];

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
 * so the cached system blocks never change shape between callers.
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

/**
 * STEP A — cheap category routing with Haiku. Costs almost nothing (max 200
 * output tokens, no reference data). Any failure degrades to 'unknown', which
 * STEP B treats as a food scan.
 */
async function routeCategory(text: string): Promise<{
  category: string;
  confidence: "high" | "medium" | "low";
  signals: string[];
  detected: string;
}> {
  try {
    const msg = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      system: CATEGORY_ROUTER_SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 6000) }],
    });
    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = extractJson(raw) as Record<string, unknown>;
    const conf = String(parsed?.confidence ?? "").toLowerCase();
    return {
      category: String(parsed?.category ?? "unknown"),
      confidence:
        conf === "high" || conf === "medium" || conf === "low" ? conf : "low",
      signals: Array.isArray(parsed?.signals)
        ? parsed.signals
            .filter((s): s is string => typeof s === "string")
            .slice(0, 6)
        : [],
      detected: typeof parsed?.detected === "string" ? parsed.detected.trim() : "",
    };
  } catch {
    return { category: "unknown", confidence: "low", signals: [], detected: "" };
  }
}

/** Cheap local backstop: near-empty OCR text is never a packaged product. */
function looksUnanalyzable(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const hasSignal = /(mrp|ingredient|fssai|mfg|batch|net wt|net quantity|₹|rs\.?\s*\d|manufactured|best before|use by)/i.test(
    text,
  );
  return words.length < 8 && !hasSignal;
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

  const categoryOverride =
    typeof body?.categoryOverride === "string" &&
    (VALID_CATEGORY_OVERRIDES as string[]).includes(body.categoryOverride)
      ? (body.categoryOverride as DetectedCategoryId)
      : null;

  // ---- STEP A: route the product to a category (Haiku), or trust the user ----
  // A category override means the user has explicitly asserted this IS a
  // package, so the "not a package" gate is skipped for that path.
  const routed = categoryOverride
    ? {
        category: categoryOverride as string,
        confidence: "high" as const,
        signals: ["user confirmed the category"],
        detected: "",
      }
    : await routeCategory(extractedText);

  // ---- HARD GATE: not a packaged product -> STOP. Never call Sonnet, never
  // produce a score. (FIX 1 + FIX 2) ----
  if (
    !categoryOverride &&
    (routed.category === "not_a_packaged_product" ||
      looksUnanalyzable(extractedText))
  ) {
    return NextResponse.json(
      {
        error: "not_a_packaged_product",
        detected: routed.detected || null,
        message:
          "We couldn't find any product label in this photo. HealthRepo analyses packaged products — the ingredients list, MRP, dates and manufacturer details printed on the pack.",
      },
      { status: 422 },
    );
  }

  const activeCategory = normalizeCompactCategory(
    routed.category === "not_a_packaged_product" ? "unknown" : routed.category,
  );

  const compactReference = buildCompactReference(activeCategory);
  // Every category has its own rule block; only 'unknown' borrows one.
  const rule =
    PRODUCT_CATEGORY_RULES[
      activeCategory === "unknown" ? "food_and_beverages" : activeCategory
    ] ?? PRODUCT_CATEGORY_RULES.food_and_beverages;

  const categoryBlock = [
    `ACTIVE CATEGORY: ${activeCategory}`,
    `Regulator: ${rule.regulatory_body}`,
    `Governing act: ${rule.act}`,
    `Consumer complaint portal: ${rule.complaint_portal}`,
    "",
    `Analyse the product strictly under this category. Set detected_category.category to "${activeCategory}".`,
    "",
    "===== COMPACT REFERENCE DATA (already filtered to this category — do not ask for more) =====",
    JSON.stringify(compactReference),
  ].join("\n");

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
        thinking: THINKING_OFF,
        // Block 1 is fully static (one cache entry for all scans); block 2 is
        // the category-scoped compact reference (one entry per category). The
        // variable OCR text + health profile go in `messages`, never here, so
        // the cache prefix stays stable.
        system: [
          {
            type: "text",
            text: STATIC_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: categoryBlock,
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

    // Normalised, then enriched with the local long-form explanations the model
    // was told NOT to regenerate (FIX 3). The client renders this unguarded.
    analysis = enrichAnalysis(normalizeAnalysis(parsed));

    // Additive dosage / FSSAI limit checking is a food-only concept. The prompt
    // asks for it to be zeroed outside the food categories, but the model
    // occasionally counts a cosmetic preservative anyway — enforce it here so a
    // shampoo can never be shown an "additive dosage" verdict.
    if (activeCategory === "personal_care" || activeCategory === "household_cleaning" || activeCategory === "baby_product_care") {
      analysis.dosage_analysis = {
        additive_count: {
          preservatives: 0, colors: 0, sweeteners: 0, antioxidants: 0,
          emulsifiers: 0, flavor_enhancers: 0, total: 0,
        },
        limit_checks: [],
        cumulative_risk: "low",
        daily_intake_warning: null,
        combination_warnings: [],
      };
    }

    // Our routing is authoritative for the category — the model only had to
    // classify ingredients under it, not re-derive the regulator.
    analysis.detected_category = {
      category: activeCategory,
      confidence: categoryOverride ? "high" : routed.confidence,
      signals_found:
        analysis.detected_category.signals_found.length > 0
          ? analysis.detected_category.signals_found
          : routed.signals,
      regulatory_body: rule.regulatory_body,
      applicable_act: rule.act,
      complaint_portal: rule.complaint_portal,
    };
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
    routerModel: HAIKU_MODEL,
    detectedCategory: activeCategory,
  });
}
