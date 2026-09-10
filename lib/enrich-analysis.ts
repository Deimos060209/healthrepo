/**
 * Re-attach the long-form explanations that /api/analyze deliberately stopped
 * asking the model for, then score the analysis LOCALLY.
 *
 * The route sends Claude a COMPACT reference (names + codes + severity only)
 * and tells it that, for an ingredient it recognises from that reference, it
 * should return just { name, safety_status, source: 'reference_database',
 * reason }. The rich why / health-effects / who-should-avoid / banned-in /
 * alternative text lives in lib/reference-data.ts — enrichAnalysis() looks each
 * flagged ingredient up locally (by name and also_known_as, case-insensitive)
 * and fills those fields in before the analysis reaches the UI, the PDF and
 * Supabase. Same output the user used to see, a fraction of the API cost.
 *
 * Ingredients Claude flagged from its OWN knowledge (source: 'ai_knowledge')
 * keep whatever explanation Claude wrote; local data only fills blanks for them.
 *
 * NUTRITION. The same split applies to the nutritional-quality dimension, and
 * one step further: the model IDENTIFIES nutritional concerns and reads the
 * numbers off the panel, and this file does ALL the arithmetic —
 * concern penalties, threshold bands, the double-counting rules, the sugar
 * alias rule, ultra-processing, nutrition_score and overall_score. Nothing the
 * model returns in `nutrition_score` or `score_penalty` is trusted; a model
 * that adds up wrong, or that is generous on a Tuesday, cannot move a score.
 */

import type {
  ProductAnalysis,
  IngredientAnalysis,
  NutritionalAnalysis,
  NutritionalConcern,
  NutritionalConcernLevel,
  NutritionalConcernType,
  NutrientLevel,
  NutrientDensity,
  FoodType,
  ThresholdFlag,
  PersonalFlag,
  UserHealthProfileInput,
  Verdict,
} from "@/types/analysis";
import {
  BANNED_INGREDIENTS,
  HARMFUL_ADDITIVES,
  FSSAI_ADDITIVE_LIMITS,
  HEALTHIER_ALTERNATIVES,
  PERSONAL_CARE_BANNED_INGREDIENTS,
  PERSONAL_CARE_HARMFUL_ADDITIVES,
  HOUSEHOLD_PRODUCT_SAFETY,
  NUTRITIONAL_CONCERNS,
  NUTRITIONAL_THRESHOLDS,
  NUTRITIONAL_POSITIVES,
  type NutritionalConcernEntry,
  type NutrientThreshold,
} from "@/lib/reference-data";

interface RefDetail {
  reason: string | null;
  health_effects: string | null;
  who_should_avoid: string | null;
  banned_in_countries: string[];
  healthier_alternative: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Full alternatives text for a reference entry, tolerating a case mismatch. */
function alternativesFor(name: string): string | null {
  const direct = HEALTHIER_ALTERNATIVES[name];
  if (direct) return direct.alternatives.join(", ");
  const key = Object.keys(HEALTHIER_ALTERNATIVES).find(
    (k) => norm(k) === norm(name),
  );
  return key ? HEALTHIER_ALTERNATIVES[key].alternatives.join(", ") : null;
}

/** name / alias (normalised) -> merged detail. Built once at module load. */
const INDEX: Map<string, RefDetail> = (() => {
  const m = new Map<string, RefDetail>();
  const add = (keys: (string | null | undefined)[], detail: RefDetail) => {
    for (const raw of keys) {
      if (!raw) continue;
      const key = norm(raw);
      // First writer wins: the richest sources are added first below.
      if (key && !m.has(key)) m.set(key, detail);
    }
  };

  for (const b of BANNED_INGREDIENTS) {
    add([b.name, ...b.also_known_as, b.e_code], {
      reason: b.why_banned,
      health_effects: b.health_effects_detailed,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: alternativesFor(b.name),
    });
  }
  for (const a of HARMFUL_ADDITIVES) {
    add([a.name, a.e_code, a.ins_code], {
      reason: a.why_concerning,
      health_effects: a.health_effects_detailed,
      who_should_avoid: a.who_should_avoid,
      banned_in_countries: a.banned_or_restricted_in ?? [],
      healthier_alternative: a.healthier_alternative ?? alternativesFor(a.name),
    });
  }
  for (const b of PERSONAL_CARE_BANNED_INGREDIENTS) {
    add([b.name], {
      reason: b.why_banned,
      health_effects: b.health_effects,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: null,
    });
  }
  for (const a of PERSONAL_CARE_HARMFUL_ADDITIVES) {
    add([a.name], {
      reason: a.why_concerning,
      health_effects: null,
      who_should_avoid: a.who_should_avoid,
      banned_in_countries: [],
      healthier_alternative: a.healthier_alternative,
    });
  }
  for (const h of HOUSEHOLD_PRODUCT_SAFETY) {
    add([h.name], {
      reason: `${h.why_concerning} ${h.safety_note}`.trim(),
      health_effects: null,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: h.healthier_alternative,
    });
  }
  // Widen alias coverage only (E-codes, INS codes, label spellings) — the
  // detail these point at is deliberately thin since real entries were added
  // above and won the key.
  for (const l of FSSAI_ADDITIVE_LIMITS) {
    add([l.name, ...l.also_known_as, l.e_code, l.ins_code], {
      reason: l.what_happens_above_limit,
      health_effects: null,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: alternativesFor(l.name),
    });
  }
  return m;
})();

function lookup(name: string): RefDetail | null {
  if (!name) return null;
  return INDEX.get(norm(name)) ?? null;
}

function mergeIngredient(ing: IngredientAnalysis): IngredientAnalysis {
  const d = lookup(ing.name);
  if (!d) return ing;

  const fromRef = ing.source === "reference_database";
  // For a reference-database hit the local text is authoritative; for an
  // ai_knowledge hit keep Claude's words and only fill genuine blanks.
  const pick = (local: string | null, model: string | null) =>
    fromRef ? local ?? model ?? null : model ?? local ?? null;

  return {
    ...ing,
    reason: pick(d.reason, ing.reason),
    health_effects: pick(d.health_effects, ing.health_effects),
    who_should_avoid: pick(d.who_should_avoid, ing.who_should_avoid),
    banned_in_countries:
      fromRef && d.banned_in_countries.length
        ? d.banned_in_countries
        : ing.banned_in_countries.length
          ? ing.banned_in_countries
          : d.banned_in_countries,
    healthier_alternative: pick(d.healthier_alternative, ing.healthier_alternative),
  };
}

// ===========================================================================
// NUTRITION
// ===========================================================================

/** Categories that have a nutrition dimension at all. */
const FOOD_CATEGORIES = new Set([
  "food_and_beverages",
  "baby_product_food",
  // 'unknown' is analysed under the food rules everywhere else too.
  "unknown",
]);

export function isFoodCategory(category: string | null | undefined): boolean {
  return FOOD_CATEGORIES.has(String(category ?? "unknown"));
}

/** alias (normalised) -> the concern entry it belongs to, plus the alias label. */
interface AliasHit {
  entry: NutritionalConcernEntry;
  /** The alias as spelled in the reference data — used for alias counting. */
  label: string;
}

const NUTRITION_ALIASES: { key: string; hit: AliasHit }[] = (() => {
  const rows: { key: string; hit: AliasHit }[] = [];
  for (const entry of NUTRITIONAL_CONCERNS) {
    for (const label of [entry.name, ...entry.also_known_as]) {
      const key = norm(label);
      if (key) rows.push({ key, hit: { entry, label } });
    }
  }
  // Longest alias first so "Invert Sugar" wins over "Sugar", and
  // "Refined Wheat Flour" over "White Flour".
  return rows.sort((a, b) => b.key.length - a.key.length);
})();

const NUTRITION_EXACT = new Map<string, AliasHit>(
  // Reversed so the FIRST (longest) definition wins on a duplicate key.
  NUTRITION_ALIASES.map((r) => [r.key, r.hit] as const).reverse(),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "Whole wheat", "whole grain", "wholemeal", "multigrain", "100% whole ..." —
 * the qualifier that turns a would-be refined-grain match into the healthy
 * version. "Whole Wheat Durum Semolina" must NOT resolve to refined semolina.
 */
const WHOLE_GRAIN_QUALIFIER =
  /\b(whole ?wheat|whole ?grain|whole ?meal|wholemeal|whole ?durum|multi ?grain|sprouted|100%? whole)\b/i;

/**
 * Match one ingredient name against the nutritional reference list.
 * Exact match first, then the longest whole-word substring — label text is
 * rarely clean ("Refined Wheat Flour (Maida)", "Sugar (Sucrose)").
 */
function matchNutritionalConcern(rawName: string): AliasHit | null {
  const n = norm(rawName);
  if (!n) return null;
  const exact = NUTRITION_EXACT.get(n);
  if (exact) return exact;
  for (const { key, hit } of NUTRITION_ALIASES) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(key)}([^a-z0-9]|$)`, "i").test(n)) {
      // A whole-grain product that merely contains the word "wheat" / "durum"
      // is not a refined-grain concern.
      if (hit.entry.concern_type === "refined_grain" && WHOLE_GRAIN_QUALIFIER.test(rawName)) {
        return null;
      }
      return hit;
    }
  }
  return null;
}

/** Build a fully-populated concern from a local reference entry. */
function concernFromEntry(
  ingredient: string,
  entry: NutritionalConcernEntry,
): NutritionalConcern {
  return {
    ingredient,
    concern_type: entry.concern_type,
    concern_level: entry.concern_level,
    why_flagged: entry.why_flagged,
    health_effects: entry.health_effects,
    moderation_guidance: entry.moderation_guidance,
    who_should_limit: entry.who_should_limit,
    better_alternative: entry.better_alternative,
    score_penalty: entry.score_penalty,
    source: "reference_database",
  };
}

const CONCERN_TYPES: readonly NutritionalConcernType[] = [
  "refined_grain",
  "added_sugar",
  "refined_oil",
  "high_sodium",
  "saturated_fat",
  "trans_fat",
  "processed_protein",
  "low_nutrient_density",
];

const LEVELS: readonly NutritionalConcernLevel[] = [
  "mild",
  "moderate",
  "significant",
];

/** Penalty band each concern_level is allowed to occupy (STEP 5 scale). */
const LEVEL_BAND: Record<NutritionalConcernLevel, [number, number]> = {
  mild: [3, 5],
  moderate: [6, 10],
  significant: [11, 15],
};

/**
 * Clamp an ai_knowledge penalty into its declared band, so a model that
 * invents "penalty: 40" for tapioca cannot swamp the score.
 */
function clampAiPenalty(level: NutritionalConcernLevel, raw: number): number {
  const [lo, hi] = LEVEL_BAND[level];
  if (!Number.isFinite(raw) || raw <= 0) return lo;
  return Math.max(lo, Math.min(hi, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Nutrient thresholds
// ---------------------------------------------------------------------------

type ThresholdKey =
  | "sugar"
  | "sodium"
  | "saturated_fat"
  | "total_fat"
  | "trans_fat"
  | "fibre"
  | "protein";

/** Threshold keys that never carry a penalty — they feed the positive block. */
const POSITIVE_KEYS: readonly ThresholdKey[] = ["fibre", "protein"];

/** Map the model's free-text nutrient name onto a threshold we know how to score. */
function thresholdKey(nutrient: string): ThresholdKey | null {
  const n = norm(nutrient);
  if (/fib(re|er)/.test(n)) return "fibre";
  if (/protein/.test(n)) return "protein";
  if (/trans/.test(n)) return "trans_fat";
  if (/satur/.test(n)) return "saturated_fat";
  if (/\bfat\b/.test(n)) return "total_fat";
  if (/sodium|\bsalt\b/.test(n)) return "sodium";
  if (/sugar/.test(n)) return "sugar";
  return null;
}

/**
 * Beverages are judged per 100 ml on a different sugar scale (11.25 / 2.5),
 * not a rescaled version of the solid one. Detected locally rather than asked
 * of the model, so the scale cannot drift between scans.
 */
function looksLikeBeverage(a: ProductAnalysis): boolean {
  const pi = a.product_info ?? ({} as ProductAnalysis["product_info"]);
  const netW = String(pi.net_weight ?? "");
  const first = a.ingredient_analysis?.[0]?.name ?? "";
  // Oils, ghee and vinegar are also sold by volume — a litre measure is not a
  // beverage signal for them.
  const nonDrinkLiquid =
    /\b(oil|ghee|vanaspati|vinegar|sirka|essence|extract|attar)\b/i.test(
      `${pi.name ?? ""} ; ${first}`,
    );
  if (!nonDrinkLiquid && /\d\s*(ml|millilit|l\b|ltr|litre|liter)/i.test(netW))
    return true;
  const words = [pi.name, pi.category, a.detected_category?.category]
    .filter(Boolean)
    .join(" ");
  if (
    /\b(drink|beverage|juice|soda|cola|soft drink|squash|nectar|smoothie|lassi|shake|water|tea|coffee|syrup drink)\b/i.test(
      words,
    )
  ) {
    return true;
  }
  // A first ingredient of water is a strong beverage signal.
  return /^(water|aqua|carbonated water)\b/i.test(first.trim());
}

/** Apply the baby-food multiplier to a threshold's bands. */
function scaleThreshold(t: NutrientThreshold, factor: number): NutrientThreshold {
  if (factor === 1) return t;
  return {
    ...t,
    bands: t.bands.map((b) => ({ ...b, above: b.above * factor })),
    reference: `${t.reference} (halved for baby food)`,
  };
}

interface ScoredFlag extends ThresholdFlag {
  key: ThresholdKey;
}

/**
 * Re-score one nutrient value against its band. The model supplies the VALUE;
 * the level and the penalty are decided here.
 */
function scoreThreshold(
  key: ThresholdKey,
  rawValue: number,
  rawUnit: string,
  opts: { beverage: boolean; babyFactor: number },
): ScoredFlag | null {
  const T = NUTRITIONAL_THRESHOLDS;
  let value = rawValue;
  let unit = rawUnit;

  if (key === "fibre") {
    const f = T.fibre;
    const level: NutrientLevel =
      value > f.high_above ? "high" : value >= f.medium_from ? "medium" : "low";
    // Display-only marker (negative => the UI shows "GOOD"); the real fibre
    // bonus is computed in computePositives() from NUTRITIONAL_POSITIVES.
    return {
      key,
      nutrient: f.nutrient,
      value_per_100: value,
      unit: "g",
      level,
      penalty: level === "low" ? 0 : -1,
      reference: f.reference,
    };
  }

  if (key === "protein") {
    const level: NutrientLevel =
      value > 20
        ? "high"
        : value >= 10
          ? "medium_high"
          : value >= 5
            ? "medium"
            : "low";
    return {
      key,
      nutrient: "Protein",
      value_per_100: Math.round(value * 100) / 100,
      unit: "g",
      level,
      // Positive nutrient — never a penalty; the bonus is in computePositives().
      penalty: value >= 5 ? -1 : 0,
      reference: "Good above 10 g per 100 g",
    };
  }

  let base: NutrientThreshold;
  switch (key) {
    case "sugar":
      base = opts.beverage ? T.sugar_liquid : T.sugar_solid;
      base = scaleThreshold(base, opts.babyFactor);
      unit = "g";
      break;
    case "sodium":
      // A salt figure in grams is 2.5x the sodium figure — convert so both
      // land on the same 600 mg scale.
      if (/^g$/i.test(rawUnit.trim()) || /salt/i.test(rawUnit)) {
        value = rawValue * 400; // g salt -> mg sodium
      }
      base = scaleThreshold(T.sodium, opts.babyFactor);
      unit = "mg";
      break;
    case "saturated_fat":
      base = scaleThreshold(T.saturated_fat, opts.babyFactor);
      unit = "g";
      break;
    case "total_fat":
      base = T.total_fat;
      unit = "g";
      break;
    case "trans_fat":
      base = T.trans_fat;
      unit = "g";
      break;
    default:
      return null;
  }

  // Bands run high -> low; the first one the value clears decides the level.
  let level: NutrientLevel = "low";
  let penalty = 0;
  for (const b of base.bands) {
    if (value > b.above) {
      level = b.level;
      penalty = b.penalty;
      break;
    }
  }

  return {
    key,
    nutrient: base.nutrient,
    value_per_100: Math.round(value * 100) / 100,
    unit,
    level,
    penalty,
    reference: base.reference,
  };
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** E-number / INS code in an ingredient name — the ultra-processing signal. */
const ADDITIVE_CODE = /\b(e\s?-?\d{3,4}[a-z]?|ins\s?-?\d{3,4}[a-z]?)\b/i;

// ---------------------------------------------------------------------------
// Nutrient density
// ---------------------------------------------------------------------------

const DENSITY_VALUES: readonly NutrientDensity[] = [
  "empty",
  "low",
  "moderate",
  "high",
];
const DENSITY_RANK: Record<NutrientDensity, number> = {
  empty: 0,
  low: 1,
  moderate: 2,
  high: 3,
};
/** The worse (lower) of two density classifications. */
const worseDensity = (a: NutrientDensity, b: NutrientDensity): NutrientDensity =>
  DENSITY_RANK[a] <= DENSITY_RANK[b] ? a : b;

/** Validate the model's nutrient_density; null when it sent nothing usable. */
const normalizeDensity = (v: unknown): NutrientDensity | null => {
  const s = String(v ?? "").toLowerCase().trim();
  return (DENSITY_VALUES as readonly string[]).includes(s)
    ? (s as NutrientDensity)
    : null;
};

const DENSITY_NOTE: Record<NutrientDensity, string> = {
  high: "Built on minimally processed ingredients that deliver real fibre, protein or micronutrients.",
  moderate:
    "Has some nutritional value, but is noticeably refined or processed, or has a narrow nutrient profile.",
  low: "Built mainly on refined grains, starches, oils or sugars — largely calories with little fibre or micronutrient content.",
  empty:
    "Essentially sugar, refined starch or fat with negligible nutritional contribution.",
};

/** Whole / minimally-processed foods a bare ingredient list can be trusted on. */
const WHOLE_FOOD_RE =
  /\b(milk|dahi|curd|yogh?urt|paneer|chho?ana|cheese|butter ?milk|egg|atta|whole ?wheat|whole ?grain|whole ?meal|oat|oats|rolled oats|dal|dhal|lentil|chana|chickpea|rajma|kidney bean|moong|urad|toor|masoor|soy(a|abean)?|millet|ragi|bajra|jowar|nachni|brown rice|red rice|quinoa|buckwheat|amaranth|almond|cashew|walnut|peanut|groundnut|pista|seed|fresh|vegetable|spinach|tomato|carrot|potato\b|fruit|banana|mango|apple|honey \(raw\))\b/i;

/**
 * FIX 2/3 (density recalibration) — what does this food positively provide?
 *
 * Starts from the model's classification (which has the world knowledge to call
 * plain dahi 'high' without a fibre panel), then applies LOCAL DOWNGRADES the
 * model cannot override: a product whose primary ingredients are refined grain,
 * refined oil or added sugar is 'low' at best, and a sugary beverage with no
 * redeeming fibre is 'empty'. When the model gave nothing usable, a
 * conservative local classification is derived from the same signals.
 */
function resolveNutrientDensity(
  model: NutrientDensity | null,
  ctx: {
    concerns: NutritionalConcern[];
    firstThree: string[];
    sugarLevel: NutrientLevel | null;
    fibreHigh: boolean;
    beverage: boolean;
    ultraProcessed: boolean;
  },
): NutrientDensity {
  const { concerns, firstThree, sugarLevel, fibreHigh, beverage, ultraProcessed } =
    ctx;

  const REFINED_TYPES: NutritionalConcernType[] = [
    "refined_grain",
    "added_sugar",
    "refined_oil",
  ];
  const primaryHits = firstThree
    .map((n) => matchNutritionalConcern(n))
    .filter((h): h is NonNullable<typeof h> => h != null);
  const primaryRefined = primaryHits.some((h) =>
    REFINED_TYPES.includes(h.entry.concern_type),
  );
  const primaryAllSugarOrFat =
    firstThree.length > 0 &&
    firstThree.every((n) => {
      const h = matchNutritionalConcern(n);
      return (
        h != null &&
        (h.entry.concern_type === "added_sugar" ||
          h.entry.concern_type === "refined_oil")
      );
    });
  const refinedConcern = concerns.some(
    (c) => REFINED_TYPES.includes(c.concern_type) && c.concern_level !== "mild",
  );
  const hasModeratePlusConcern = concerns.some(
    (c) => c.concern_level === "moderate" || c.concern_level === "significant",
  );
  const sugarHeavy =
    sugarLevel != null && WORSE_THAN_MEDIUM.includes(sugarLevel);
  const wholeFoodSignal =
    concerns.length === 0 && firstThree.some((n) => WHOLE_FOOD_RE.test(n));

  let d: NutrientDensity;
  if (model != null) {
    d = model;
  } else if ((fibreHigh || wholeFoodSignal) && !hasModeratePlusConcern) {
    d = "high";
  } else if (primaryRefined || refinedConcern) {
    d = "low";
  } else {
    d = "moderate";
  }

  // ---- Local downgrades — these always apply, model value cannot override ----
  if (primaryRefined || refinedConcern) d = worseDensity(d, "low");
  if (beverage && sugarHeavy && !fibreHigh) d = worseDensity(d, "empty");
  if (primaryAllSugarOrFat && !fibreHigh) d = worseDensity(d, "empty");
  if (ultraProcessed && primaryRefined && sugarLevel === "high")
    d = worseDensity(d, "empty");
  if (ultraProcessed && primaryRefined && sugarLevel === "very_high")
    d = worseDensity(d, "empty");

  return d;
}

// ---------------------------------------------------------------------------
// Food type — raw cooking input vs finished product
// ---------------------------------------------------------------------------

const FOOD_TYPE_VALUES: readonly FoodType[] = [
  "staple_ingredient",
  "minimally_processed",
  "processed_product",
];
const normalizeFoodType = (v: unknown): FoodType | null => {
  const s = String(v ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return (FOOD_TYPE_VALUES as readonly string[]).includes(s)
    ? (s as FoodType)
    : null;
};

/** Recognisable-whole-food-with-light-processing signal (dahi, roasted nuts …). */
const MINIMALLY_PROCESSED_RE =
  /\b(dahi|curd|yogh?urt|yoghourt|chaas|chhach|butter ?milk|lassi|paneer|chho?ana|tofu|hung curd|greek yogh?urt|roast(ed)?|makhana|fox ?nut|phool ?makhana|dried (fruit|apricot|fig|date|plum)|raisin|kishmish|sultana|prune|canned .*(in water|in brine)|in spring water|frozen (vegetable|veg|peas|corn|spinach)|sprouted)\b/i;

/** A plain cooking-ingredient name (used when the ingredient list is bare). */
const STAPLE_NAME_RE =
  /\b(rice|atta|flour|maida|suji|sooji|rava|semolina|dal|dhal|daal|pulse|lentil|besan|poha|dalia|rava|oats|millet|ragi|bajra|jowar|quinoa|pasta|macaroni|vermicelli|noodle cake|oil|ghee|butter|sugar|jaggery|gur|salt|namak|honey|besan|maize|corn ?meal|wheat|barley|rajma|chana|moong|urad|toor|masoor)\b/i;

/** Pure sugar / refined oil / salt sold standalone — calorically empty/extreme. */
const EXTREME_STAPLE_RE =
  /\b(sugar|refined\s+(oil|sunflower oil|soya?bean oil|palm oil|vegetable oil|rice bran oil|groundnut oil)|vanaspati|dalda|table salt|iod(is|iz)ed salt|rock salt|sea salt|common salt|sendha namak|black salt|kala namak|\bsalt\b)\b/i;

/** Any oil / fat / sugar / salt staple — the verdict is always "use sparingly". */
export const STAPLE_USE_SPARINGLY_RE =
  /\b(oil|ghee|vanaspati|dalda|shortening|margarine|tallow|lard|clarified butter|sugar|jaggery|gur|khandsari|salt|namak|honey|syrup|molasses|treacle)\b/i;

/**
 * FIX 1 — classify BEFORE scoring. The model's call is the starting point;
 * local rules override the obvious mistakes (a thing with additives is not a
 * staple; a beverage is always a product).
 */
function resolveFoodType(
  model: FoodType | null,
  ctx: {
    names: string[];
    productName: string;
    beverage: boolean;
    additiveCount: number;
    ultraProcessed: boolean;
  },
): { type: FoodType; reason: string } {
  const { names, productName, beverage, additiveCount, ultraProcessed } = ctx;
  const ingredientCount = names.length;
  const haystack = [productName, ...names].join(" ; ");
  const looksMinimally = MINIMALLY_PROCESSED_RE.test(haystack);
  const looksStaple =
    ingredientCount <= 3 &&
    additiveCount === 0 &&
    (ingredientCount <= 1 || STAPLE_NAME_RE.test(haystack));

  if (beverage) {
    return { type: "processed_product", reason: "A beverage — consumed as sold." };
  }
  if (ultraProcessed) {
    return {
      type: "processed_product",
      reason: "Many ingredients and multiple additives — a formulated product.",
    };
  }

  // Trust an explicit model call unless it is clearly wrong.
  if (model === "staple_ingredient") {
    if (additiveCount >= 1 || ingredientCount > 4) {
      return {
        type: "processed_product",
        reason: "Has additives or a long ingredient list — scored as a product.",
      };
    }
    if (looksMinimally) {
      return {
        type: "minimally_processed",
        reason: "A lightly processed whole food.",
      };
    }
    return { type: "staple_ingredient", reason: "A basic cooking ingredient." };
  }
  if (model === "minimally_processed") {
    return additiveCount >= 3
      ? { type: "processed_product", reason: "Enough additives to be a formulated product." }
      : { type: "minimally_processed", reason: "A lightly processed whole food." };
  }
  if (model === "processed_product") {
    return { type: "processed_product", reason: "A manufactured, eat-as-is item." };
  }

  // No usable model value — derive from the shape of the label.
  if (looksMinimally && additiveCount === 0) {
    return { type: "minimally_processed", reason: "A lightly processed whole food." };
  }
  if (looksStaple) {
    return {
      type: "staple_ingredient",
      reason: "A short-ingredient cooking staple with no additives.",
    };
  }
  return { type: "processed_product", reason: "A formulated, manufactured product." };
}

// ---------------------------------------------------------------------------
// Positive nutrition — what the food actively contributes (FIX 3)
// ---------------------------------------------------------------------------

const WHOLE_GRAIN_RE =
  /\b(whole ?wheat|whole ?grain|whole ?meal|wholemeal|whole ?durum|whole ?rye|brown rice|red rice|black rice|hand ?pounded rice|unpolished rice|par ?boiled rice|rolled oats|steel ?cut oats|whole oat|oat ?meal|oats\b|dalia|daliya|broken wheat|cracked wheat|bulgur|barley|jau\b|bajra|pearl millet|jowar|sorghum|ragi|finger millet|foxtail millet|kodo millet|little millet|proso millet|barnyard millet|kutki|sanwa|buckwheat|kuttu|amaranth|rajgira|chaulai|quinoa|rye\b)\b/i;

const LEGUME_RE =
  /\b(dal\b|dhal|daal|lentil|masoor|toor|tur\b|arhar|moong|mung|urad|urid|chana\b|chickpea|kabuli|bengal gram|black gram|green gram|red gram|horse gram|kulthi|rajma|kidney bean|black bean|pinto bean|navy bean|cannellini|cowpea|lobia|chawli|black ?eyed pea|soy\b|soya|soybean|soya ?bean|split pea|yellow pea|green pea\b|matar|besan|gram flour)\b/i;

const NUTS_SEEDS_RE =
  /\b(almond|badam|cashew|kaju|walnut|akhrot|pista(chio)?|hazelnut|pecan|macadamia|brazil nut|pine ?nut|chironji|charoli|peanut|groundnut|moong ?phali|makhana|fox ?nut|phool ?makhana|lotus ?seed|sunflower seed|pumpkin seed|chia|flax( ?seed)?|alsi|sesame|til\b|melon seed|magaz|hemp seed|watermelon seed|nigella|kalonji)\b/i;

const MICRONUTRIENT_RE =
  /\b(spinach|palak|methi|fenugreek leaf|amaranth leaf|moringa|drumstick leaf|sahjan|munga|kale|collard|beet greens|mustard greens|sarson ka saag|bathua|chaulai|ragi|finger millet|bajra|pearl millet|jowar|sorghum|foxtail millet|kodo millet|little millet|proso millet|barnyard millet|amaranth|rajgira|quinoa)\b/i;

const FERMENTED_DAIRY_RE =
  /\b(dahi|curd|yogh?urt|yoghourt|chaas|chhach|butter ?milk|lassi|matha|mor\b|shrikhand|hung curd|greek yogh?urt|probiotic (curd|yogh?urt))\b/i;

const bandBonus = (
  value: number | null,
  bands: readonly { above: number; bonus: number }[],
): number => {
  if (value == null) return 0;
  for (const b of bands) if (value > b.above) return b.bonus;
  return 0;
};

interface PositiveResult {
  total: number;
  notes: string[];
}

/**
 * FIX 3 — sum the positive-nutrition bonuses. Applied after penalties and
 * before the caps, capped at NUTRITIONAL_POSITIVES.max_total so genuine
 * nutrition lifts a score but never masks a real problem.
 */
function computePositives(ctx: {
  firstThree: string[];
  allNames: string[];
  productName: string;
  concerns: NutritionalConcern[];
  scored: Map<ThresholdKey, ScoredFlag>;
  additiveCount: number;
  ingredientCount: number;
  isStaple: boolean;
  primaryIsRefinedGrain: boolean;
}): PositiveResult {
  const P = NUTRITIONAL_POSITIVES;
  const {
    firstThree,
    allNames,
    concerns,
    scored,
    additiveCount,
    ingredientCount,
    isStaple,
    primaryIsRefinedGrain,
  } = ctx;
  const first3 = firstThree.join(" ; ");
  const everything = allNames.join(" ; ");
  const notes: string[] = [];
  let total = 0;
  const add = (n: number, note: string) => {
    if (n <= 0) return;
    total += n;
    notes.push(note);
  };

  // Fibre / protein off the panel. A refined grain's gluten protein is not the
  // point of flagging it, so the protein bonus is suppressed there.
  const fibre = scored.get("fibre")?.value_per_100 ?? null;
  add(bandBonus(fibre, P.fibre_g), `Good fibre content (${fibre ?? "?"} g per 100 g)`);
  if (!primaryIsRefinedGrain) {
    const protein = scored.get("protein")?.value_per_100 ?? null;
    add(bandBonus(protein, P.protein_g), `Good protein content (${protein ?? "?"} g per 100 g)`);
  }

  if (WHOLE_GRAIN_RE.test(first3)) add(P.whole_grain_primary, "Whole grain is a main ingredient");
  if (LEGUME_RE.test(first3)) add(P.legume_primary, "Pulse / legume is a main ingredient");
  if (NUTS_SEEDS_RE.test(first3)) add(P.nuts_seeds_primary, "Nuts or seeds are a main ingredient");

  const addedSugar = concerns.some((c) => c.concern_type === "added_sugar");
  const sugarFlag = scored.get("sugar");
  // "Salt" / "Sugar" listed as an ingredient blocks the corresponding
  // "no added ..." bonus even if it never rose to a scored concern.
  const nameHasSalt = /\b(salt|sodium chloride|namak)\b/i.test(everything);
  const nameHasSugar = /\b(sugar|syrup|glucose|dextrose|maltose|molasses|honey|jaggery|gur)\b/i.test(everything);
  const noAddedSugar =
    !addedSugar && !nameHasSugar && (!sugarFlag || sugarFlag.level === "low");
  if (FERMENTED_DAIRY_RE.test(everything) && noAddedSugar) {
    add(P.plain_fermented_dairy, "Plain fermented dairy — live cultures, no added sugar");
  }
  if (MICRONUTRIENT_RE.test(everything)) {
    add(P.micronutrient_dense, "Contains a micronutrient-dense ingredient");
  }

  // "Absence" bonuses — skipped for staples, where they are trivially true.
  if (!isStaple) {
    const sodiumFlag = scored.get("sodium");
    const highSodium = concerns.some((c) => c.concern_type === "high_sodium");
    if (noAddedSugar) add(P.no_added_sugar, "No added sugar");
    if (
      !highSodium &&
      !nameHasSalt &&
      (!sodiumFlag || sodiumFlag.level === "low")
    ) {
      add(P.no_added_salt, "No added salt beyond trace");
    }
    if (ingredientCount <= 2 && additiveCount === 0) {
      add(P.minimal_ingredients, "One or two ingredients, no additives");
    }
  }

  return { total: Math.min(total, P.max_total), notes };
}

// ---------------------------------------------------------------------------
// The scoring pass
// ---------------------------------------------------------------------------

/**
 * Rebuild `nutritional_analysis` from the model's identifications plus local
 * reference data, and score it. Returns null for non-food categories.
 */
function buildNutritionalAnalysis(
  a: ProductAnalysis,
  category: string,
): NutritionalAnalysis | null {
  if (!isFoodCategory(category)) return null;

  const T = NUTRITIONAL_THRESHOLDS;
  // Deliberately loose: this is the model's raw reply, and every field of it
  // is re-derived or re-validated below.
  const raw = (a.nutritional_analysis ?? null) as unknown as Record<
    string,
    unknown
  > | null;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const rawStr = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const isBaby = category === "baby_product_food";
  const babyFactor = isBaby ? T.baby_threshold_multiplier : 1;
  const beverage = looksLikeBeverage(a);

  // ---- 1. Concerns ------------------------------------------------------
  // Reference-database entries are rebuilt from local data (the model is only
  // trusted to NAME them). ai_knowledge entries keep the model's prose, with
  // the penalty clamped into its declared band.
  const concerns: NutritionalConcern[] = [];
  const seen = new Set<string>();

  for (const item of arr(raw?.concerns)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const ingredient = String(c.ingredient ?? "").trim();
    if (!ingredient) continue;
    const key = norm(ingredient);
    if (seen.has(key)) continue;

    const hit = matchNutritionalConcern(ingredient);
    if (hit) {
      seen.add(key);
      concerns.push(concernFromEntry(ingredient, hit.entry));
      continue;
    }
    // Not in the reference list — an ai_knowledge concern. Keep what the
    // model wrote, but constrain the type, level and penalty.
    const level = LEVELS.includes(c.concern_level as NutritionalConcernLevel)
      ? (c.concern_level as NutritionalConcernLevel)
      : "moderate";
    const type = CONCERN_TYPES.includes(c.concern_type as NutritionalConcernType)
      ? (c.concern_type as NutritionalConcernType)
      : "low_nutrient_density";
    seen.add(key);
    concerns.push({
      ingredient,
      concern_type: type,
      concern_level: level,
      why_flagged: rawStr(c.why_flagged),
      health_effects: rawStr(c.health_effects),
      moderation_guidance: rawStr(c.moderation_guidance),
      who_should_limit: arr(c.who_should_limit)
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean),
      better_alternative: rawStr(c.better_alternative),
      score_penalty: clampAiPenalty(level, num(c.score_penalty) ?? 0),
      source: "ai_knowledge",
    });
  }

  // Backstop: an ingredient the model already extracted that matches the
  // reference list exactly, but that it did not report as a concern. This can
  // only fire on a local alias match, so it cannot invent anything — it just
  // stops a missed flag from silently inflating the score.
  for (const ing of a.ingredient_analysis ?? []) {
    const name = String(ing?.name ?? "").trim();
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    const hit = matchNutritionalConcern(name);
    if (!hit) continue;
    seen.add(key);
    concerns.push(concernFromEntry(name, hit.entry));
  }

  // Baby food: any added sugar is 'significant' regardless of amount.
  if (isBaby) {
    for (const c of concerns) {
      if (c.concern_type === "added_sugar" && c.concern_level !== "significant") {
        c.concern_level = "significant";
        c.score_penalty = Math.max(c.score_penalty, LEVEL_BAND.significant[0]);
      }
    }
  }

  // ---- 2. Sugar aliases -------------------------------------------------
  // Distinct alias LABELS, not distinct reference entries: "Invert Sugar",
  // "Liquid Glucose" and "Dextrose" all belong to one entry but are three
  // separate names on the pack, which is exactly the practice being flagged.
  // Only names that resolve to the reference added-sugar list count: the rule
  // is "count aliases from the added-sugar list", so a concern the model
  // invented must not be able to push a product over the 3-alias threshold.
  const aliasLabels = new Set<string>();
  const collectAlias = (name: string) => {
    const hit = matchNutritionalConcern(name);
    if (hit && hit.entry.concern_type === "added_sugar") aliasLabels.add(hit.label);
  };
  for (const ing of a.ingredient_analysis ?? []) collectAlias(String(ing?.name ?? ""));
  for (const c of concerns) collectAlias(c.ingredient);
  const sugar_aliases_found = Array.from(aliasLabels).sort();
  const sugar_alias_count = sugar_aliases_found.length;

  // ---- 3. Threshold flags ----------------------------------------------
  const scored = new Map<ThresholdKey, ScoredFlag>();
  for (const item of arr(raw?.threshold_flags)) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const key = thresholdKey(String(f.nutrient ?? ""));
    if (!key || scored.has(key)) continue;
    const value = num(f.value_per_100);
    if (value === null || value < 0) continue;
    const unit = String(f.unit ?? "g");
    const flag = scoreThreshold(key, value, unit, { beverage, babyFactor });
    if (flag) scored.set(key, flag);
  }
  const threshold_flags: ThresholdFlag[] = Array.from(scored.values()).map(
    ({ key: _key, ...rest }) => rest,
  );
  // No panel visible => no thresholds => the assessment is ingredient-only.
  const nutrition_data_complete = threshold_flags.length > 0;

  // ---- 4. Processing level + food type -------------------------------
  const ingredientNames = (a.ingredient_analysis ?? []).map((i) =>
    String(i?.name ?? ""),
  );
  const firstThreeNames = ingredientNames.slice(0, 3);
  const ingredientCount = ingredientNames.length;
  const codedAdditives = (a.ingredient_analysis ?? []).filter((i) =>
    ADDITIVE_CODE.test(i?.name ?? ""),
  ).length;
  const additiveCount = Math.max(
    codedAdditives,
    a.dosage_analysis?.additive_count?.total ?? 0,
  );
  const is_ultra_processed =
    ingredientCount > T.ultra_processing.min_ingredients_exclusive &&
    additiveCount >= T.ultra_processing.min_additives;

  const productName = String(a.product_info?.name ?? "");
  // 'processed_product' is normalizeNutritionalAnalysis()'s default when the
  // model said nothing, so treat it as "no signal" and let the local
  // derivation run. An explicit 'staple_ingredient' / 'minimally_processed'
  // from the model is honoured (subject to the sanity checks inside).
  const modelFoodType = normalizeFoodType(raw?.food_type);
  const ftRes = resolveFoodType(
    modelFoodType === "processed_product" ? null : modelFoodType,
    {
      names: ingredientNames,
      productName,
      beverage,
      additiveCount,
      ultraProcessed: is_ultra_processed,
    },
  );
  const food_type = ftRes.type;
  const food_type_reason = rawStr(raw?.food_type_reason) ?? ftRes.reason;
  const isStaple = food_type === "staple_ingredient";
  const isMinimally = food_type === "minimally_processed";
  // Halved for staples, three-quarter strength for minimally processed.
  const concernMult = isStaple ? 0.5 : isMinimally ? 0.75 : 1;

  const primaryIsRefinedGrain = firstThreeNames.some((n) => {
    const h = matchNutritionalConcern(n);
    return h != null && h.entry.concern_type === "refined_grain";
  });
  const primaryHitTypes = firstThreeNames
    .map((n) => matchNutritionalConcern(n)?.entry.concern_type)
    .filter((t): t is NutritionalConcernType => t != null);
  const isExtremeStaple =
    isStaple &&
    (EXTREME_STAPLE_RE.test([productName, ...firstThreeNames].join(" ; ")) ||
      primaryHitTypes.includes("added_sugar") ||
      primaryHitTypes.includes("refined_oil"));

  // ---- 5. Nutrient density (display always; a ceiling only for products) ----
  const fibreScored = scored.get("fibre");
  const modelDensity = normalizeDensity(raw?.nutrient_density);
  const nutrient_density = resolveNutrientDensity(
    modelDensity === "moderate" ? null : modelDensity,
    {
      concerns,
      firstThree: firstThreeNames,
      sugarLevel: scored.get("sugar")?.level ?? null,
      fibreHigh: fibreScored != null && fibreScored.level !== "low",
      beverage,
      ultraProcessed: is_ultra_processed,
    },
  );
  const density_note =
    rawStr(raw?.density_note) ?? DENSITY_NOTE[nutrient_density];

  // ---- 6. Penalties --------------------------------------------------
  const sugarFlag = scored.get("sugar");
  const satFlag = scored.get("saturated_fat");
  const sugarPriced =
    sugarFlag != null && WORSE_THAN_MEDIUM.includes(sugarFlag.level);
  const satFatPriced =
    satFlag != null && (satFlag.level === "high" || satFlag.level === "very_high");

  const contributors: Contributor[] = [];
  let concernPenalties = 0;
  let thresholdPenalties = 0;
  let oilPenalties = 0;

  for (const c of concerns) {
    if (c.concern_type === "high_sodium") continue;
    if (c.concern_type === "added_sugar" && sugarPriced) continue;
    if (c.concern_type === "refined_oil" && satFatPriced) {
      oilPenalties += c.score_penalty;
      continue;
    }
    const charged = Math.round(c.score_penalty * concernMult);
    concernPenalties += charged;
    if (charged > 0) {
      contributors.push({
        label: c.ingredient,
        level: c.concern_level,
        penalty: charged,
        kind: "ingredient",
        concern_type: c.concern_type,
      });
    }
  }
  if (satFatPriced) {
    const oilCharge = Math.round(Math.min(oilPenalties, 8) * concernMult);
    concernPenalties += oilCharge;
    if (oilCharge > 0) {
      contributors.push({
        label: "Refined and hydrogenated oils",
        level: "moderate",
        penalty: oilCharge,
        kind: "ingredient",
        concern_type: "refined_oil",
      });
    }
  }

  // Threshold penalties apply at full strength to every food type — a staple
  // that IS 100% sugar or fat should still be flagged.
  for (const f of threshold_flags) {
    if (f.penalty <= 0) continue; // fibre / protein markers are handled as bonuses
    thresholdPenalties += f.penalty;
    contributors.push({
      label: f.nutrient,
      level: f.level,
      penalty: f.penalty,
      kind: "nutrient",
      value: f.value_per_100,
      unit: f.unit,
    });
  }

  // Ultra-processing + the sugar-alias rule: products only, never staples.
  if (is_ultra_processed && !isStaple) {
    concernPenalties += T.ultra_processing.penalty;
    contributors.push({
      label: "Ultra-processing",
      level: "significant",
      penalty: T.ultra_processing.penalty,
      kind: "rule",
    });
  }
  if (
    sugar_alias_count >= T.sugar_alias_rule.min_distinct_aliases &&
    !isStaple
  ) {
    concernPenalties += T.sugar_alias_rule.penalty;
    contributors.push({
      label: "Sugar under multiple names",
      level: "significant",
      penalty: T.sugar_alias_rule.penalty,
      kind: "rule",
    });
  }

  // ---- 7. Positive nutrition (FIX 3) --------------------------------
  const positives = computePositives({
    firstThree: firstThreeNames,
    allNames: ingredientNames,
    productName,
    concerns,
    scored,
    additiveCount,
    ingredientCount,
    isStaple,
    primaryIsRefinedGrain,
  });

  // ---- 8. Score --------------------------------------------------------
  let nutrition_score: number;

  if (isStaple) {
    // Staple scale: gentle. Halved concern penalties + a graded refinement
    // deduction (from density) + full threshold penalties, then a 60 floor.
    const refinement = T.staple_refinement_penalty[nutrient_density];
    const staplePenalty = Math.min(
      concernPenalties + refinement + thresholdPenalties,
      T.staple_penalty_cap,
    );
    if (refinement > 0) {
      contributors.push({
        label: "Refinement",
        level: "moderate",
        penalty: refinement,
        kind: "rule",
      });
    }
    const raw0 = Math.round(100 - staplePenalty + positives.total);
    nutrition_score = isExtremeStaple
      ? T.staple_extreme_score
      : Math.min(
          T.max_nutrition_score,
          Math.max(T.staple_floor, raw0),
        );
  } else {
    // Product scale: strict. Penalty cap, soft floor, then the hard ceilings.
    const cappedPenalty = Math.min(
      concernPenalties + thresholdPenalties,
      T.max_total_penalty,
    );
    let s = Math.min(
      T.max_nutrition_score,
      Math.round(100 - cappedPenalty + positives.total),
    );
    s = Math.max(T.score_floor_soft, s);

    const nonBonusFlags = Array.from(scored.values()).filter(
      (f) => !POSITIVE_KEYS.includes(f.key),
    );
    const hasLevel = (lvl: NutrientLevel) =>
      nonBonusFlags.some((f) => f.level === lvl);
    const mediumOrWorseCount = nonBonusFlags.filter((f) =>
      (["medium", "medium_high", "high", "very_high"] as NutrientLevel[]).includes(
        f.level,
      ),
    ).length;
    const transFlag = scored.get("trans_fat");

    const caps: number[] = [];
    if (hasLevel("very_high")) caps.push(T.score_caps.any_very_high);
    if (hasLevel("high")) caps.push(T.score_caps.any_high);
    if (mediumOrWorseCount >= 2) caps.push(T.score_caps.two_plus_medium);
    if (transFlag && transFlag.value_per_100 > T.trans_fat.bands[0].above) {
      caps.push(T.score_caps.trans_fat_present);
    }
    if (beverage && sugarFlag && WORSE_THAN_MEDIUM.includes(sugarFlag.level)) {
      caps.push(T.score_caps.beverage_sugar_medium_high);
    }
    if (
      sugar_alias_count >= T.sugar_alias_rule.min_distinct_aliases &&
      !nutrition_data_complete
    ) {
      caps.push(T.score_caps.sugar_aliases_no_panel);
    }

    // Density ceilings — raised by 10 for minimally-processed foods.
    const densityCapBase = T.density_caps[nutrient_density];
    if (densityCapBase != null) {
      caps.push(
        isMinimally
          ? densityCapBase + T.density_cap_minimally_bonus
          : densityCapBase,
      );
    }
    // The 90+ band is reserved for genuine density — processed products only.
    if (!isMinimally) {
      const topBandAllowed =
        nutrient_density === "high" &&
        !concerns.some(
          (c) =>
            c.concern_level === "moderate" || c.concern_level === "significant",
        );
      if (!topBandAllowed) caps.push(T.top_band_reserve);
    }

    const appliedCap = caps.length ? Math.min(...caps) : null;
    if (appliedCap != null) s = Math.min(s, appliedCap);
    nutrition_score = Math.max(T.score_floor, s);
  }

  // ---- FIX 3 (prior): the single biggest contributor -----------------
  const primary_concern = buildPrimaryConcern(contributors, beverage);

  // ---- 9. Narrative --------------------------------------------------
  const positive_notes = arr(raw?.positive_notes)
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
  // Surface every bonus that fired, so the user sees WHY it scored well.
  for (const note of positives.notes) {
    if (!positive_notes.some((n) => n.toLowerCase() === note.toLowerCase())) {
      positive_notes.push(note);
    }
  }
  if (concerns.length === 0 && positive_notes.length === 0) {
    positive_notes.push("No nutritional concerns were found in the ingredients list.");
  }

  const orderNote = rawStr(raw?.ingredient_order_note) ?? deriveOrderNote(a);

  const notInDb = concerns
    .filter((c) => c.source === "ai_knowledge")
    .map((c) => c.ingredient);

  const stapleSparing =
    isStaple &&
    (isExtremeStaple ||
      STAPLE_USE_SPARINGLY_RE.test(
        [productName, firstThreeNames[0] ?? ""].join(" ; "),
      ));
  const moderation_advice =
    rawStr(raw?.moderation_advice) ??
    deriveModerationAdvice(nutrition_score, concerns, food_type, stapleSparing);

  return {
    nutrition_score,
    nutrition_data_complete,
    food_type,
    food_type_reason,
    nutrient_density,
    density_note,
    primary_concern,
    concerns,
    threshold_flags,
    positive_notes,
    sugar_alias_count,
    sugar_aliases_found,
    is_ultra_processed,
    ingredient_order_note: orderNote,
    moderation_advice,
    nutritional_concerns_not_in_database: notInDb,
  };
}

/** Penalty-carrying threshold levels that count as "medium or worse". */
const WORSE_THAN_MEDIUM: NutrientLevel[] = ["medium_high", "high", "very_high"];

interface Contributor {
  label: string;
  /** Threshold band for a nutrient, concern_level for an ingredient/rule. */
  level: string;
  penalty: number;
  kind: "nutrient" | "ingredient" | "rule";
  concern_type?: NutritionalConcernType;
  value?: number;
  unit?: string;
}

const LEVEL_ADJECTIVE: Record<string, string> = {
  very_high: "Very high",
  high: "High",
  medium_high: "High",
  medium: "Moderate",
  significant: "Significant",
  moderate: "Moderate",
  mild: "Minor",
  low: "Low",
};

const CONCERN_PHRASE: Record<NutritionalConcernType, string> = {
  refined_grain: "a refined grain",
  added_sugar: "added sugar",
  refined_oil: "a refined or hydrogenated oil",
  high_sodium: "a high-sodium ingredient",
  saturated_fat: "a source of saturated fat",
  trans_fat: "a source of trans fat",
  processed_protein: "a processed protein",
  low_nutrient_density: "a low-nutrient-density ingredient",
};

/**
 * FIX 3 — the one thing to lead with. The largest single contributor to the
 * nutrition penalty, phrased for a non-specialist. null when nothing was flagged.
 */
function buildPrimaryConcern(
  contributors: Contributor[],
  beverage: boolean,
): NutritionalAnalysis["primary_concern"] {
  if (contributors.length === 0) return null;
  const top = [...contributors].sort((a, b) => b.penalty - a.penalty)[0];
  const adj = LEVEL_ADJECTIVE[top.level] ?? "Elevated";

  let explanation: string;
  if (top.kind === "nutrient") {
    const noun =
      top.label.toLowerCase() === "sugar" ? "added sugar" : top.label.toLowerCase();
    const basis = beverage ? "per 100 ml" : "per 100 g";
    explanation =
      top.value != null
        ? `${adj} ${noun} — ${top.value} ${top.unit ?? "g"} ${basis}.`
        : `${adj} ${noun}.`;
  } else if (top.kind === "rule") {
    explanation =
      top.label === "Ultra-processing"
        ? "This is an ultra-processed food — many ingredients and multiple additives."
        : "Sugar is listed under several different names, which hides the true total.";
  } else {
    const phrase = top.concern_type
      ? CONCERN_PHRASE[top.concern_type]
      : "a nutritional concern";
    explanation = `Made with ${top.label.toLowerCase()} — ${phrase}.`;
  }

  return {
    nutrient_or_ingredient: top.label,
    level: top.level,
    penalty: top.penalty,
    explanation,
  };
}

/** "Sugar is the 2nd ingredient" — derived locally when the model omits it. */
function deriveOrderNote(a: ProductAnalysis): string | null {
  const first3 = (a.ingredient_analysis ?? []).slice(0, 3);
  const hits: string[] = [];
  first3.forEach((ing, i) => {
    const hit = matchNutritionalConcern(String(ing?.name ?? ""));
    if (!hit) return;
    if (hit.entry.concern_type === "added_sugar" || hit.entry.concern_type === "refined_grain") {
      const ord = ["1st", "2nd", "3rd"][i];
      hits.push(`${ing.name} is the ${ord} ingredient`);
    }
  });
  if (hits.length === 0) return null;
  return `Ingredients are listed by descending weight: ${hits.join(", ")}.`;
}

/**
 * Fallback for when the model returns no moderation_advice. Deliberately does
 * NOT append the worst concern's own guidance — that text already opens with
 * its own "Fine occasionally", and the two read as a stutter together.
 */
function deriveModerationAdvice(
  score: number,
  concerns: NutritionalConcern[],
  foodType: FoodType,
  stapleSparing = false,
): string {
  const worst =
    concerns.find((c) => c.concern_level === "significant") ?? concerns[0];
  const better = worst?.better_alternative
    ? ` A less refined option: ${worst.better_alternative}.`
    : "";

  if (foodType === "staple_ingredient") {
    if (stapleSparing)
      return "Use sparingly as an ingredient — it is calorie-dense with little else.";
    if (score >= 75)
      return "A sound everyday staple — cook it as part of a balanced meal.";
    return `A normal, affordable staple — nothing to avoid.${better}`;
  }

  if (concerns.length === 0 && score >= 80) {
    return "A sound everyday choice.";
  }
  if (concerns.length === 0) {
    return "No nutritional concerns were identified in the ingredients that were read.";
  }
  if (score <= 30)
    return `A poor nutritional choice — best avoided as a regular food.${better}`;
  if (score <= 45)
    return `Okay very occasionally, not as a regular choice.${better}`;
  if (score <= 65) return `Reasonable in moderation.${better}`;
  if (score <= 85)
    return `A reasonable choice — fine to eat, though less refined versions are more nutritious.${better}`;
  return "A sound everyday choice.";
}

// ---------------------------------------------------------------------------
// Overall score + verdict
// ---------------------------------------------------------------------------

/**
 * Overall weighting (2026 recalibration). Nutrition now carries the MOST
 * weight: for a legal product on sale in India, safety and compliance are
 * usually fine and nutrition is what actually differentiates a good choice
 * from a bad one. Returns null whenever safety or compliance is null — a score
 * is never computed from incomplete data.
 */
export function computeOverallScore(
  safety: number | null,
  nutrition: number | null,
  compliance: number | null,
  isFood: boolean,
): number | null {
  if (safety == null || compliance == null) return null;
  if (isFood) {
    if (nutrition == null) return null;
    return Math.round(safety * 0.35 + nutrition * 0.5 + compliance * 0.15);
  }
  return Math.round(safety * 0.75 + compliance * 0.25);
}

/**
 * The verdict follows the WEAKEST relevant dimension, not the average — a
 * product with nothing harmful in it but a nutrition score of 30 is 'avoid',
 * however good its safety and compliance numbers are. 'good' in the spec is
 * this codebase's existing 'safe' verdict.
 *
 * Product bands (2026):
 *   safety < 50            -> avoid
 *   nutrition <= 30        -> avoid
 *   nutrition 31-45        -> limit
 *   nutrition 46-65        -> caution
 *   nutrition 66-95        -> safe ('good')
 *
 * STAPLE bands (FIX 6) — a plain cooking ingredient is never 'avoid'/'limit'
 * unless safety is low or a nutrient reads 'very_high':
 *   safety < 50 OR a very_high threshold -> fall through to the product bands
 *   score >= 60 (and not an oil / sugar / salt) -> safe   ("Good / Fine staple")
 *   otherwise                                   -> caution ("Use sparingly")
 */
export function deriveVerdict(
  safety: number | null,
  nutrition: number | null,
  overall: number | null,
  isFood: boolean,
  fallback: Verdict,
  foodType: FoodType = "processed_product",
  opts: { veryHighThreshold?: boolean; useSparingly?: boolean } = {},
): Verdict {
  // Partial scan — keep the model's best-judgement call rather than inventing
  // one from numbers we do not have.
  if (safety == null || overall == null) return fallback;
  if (safety < 50) return "avoid";

  if (
    isFood &&
    nutrition != null &&
    foodType === "staple_ingredient" &&
    !opts.veryHighThreshold
  ) {
    if (opts.useSparingly) return "caution";
    return nutrition >= 60 ? "safe" : "caution";
  }

  if (isFood && nutrition != null) {
    if (nutrition <= 30) return "avoid";
    if (nutrition <= 45) return "limit";
    if (nutrition <= 65) return "caution";
    return "safe";
  }
  return overall >= 75 ? "safe" : "caution";
}

/**
 * FSSAI caps trans fat at 2% of total fat. When the panel shows both numbers
 * and that is exceeded, it is a labelling/compliance violation as well as a
 * nutritional one — record it so it reaches the compliance section.
 */
function recordTransFatViolation(a: ProductAnalysis, n: NutritionalAnalysis): void {
  const trans = n.threshold_flags.find((f) => /trans/i.test(f.nutrient));
  const total = n.threshold_flags.find((f) => /total fat/i.test(f.nutrient));
  if (!trans || !total || total.value_per_100 <= 0) return;
  const share = trans.value_per_100 / total.value_per_100;
  if (share <= NUTRITIONAL_THRESHOLDS.trans_fat_share_of_total_fat) return;
  a.legal_metrology_compliance = {
    ...(a.legal_metrology_compliance ?? {}),
    trans_fat_limit: {
      present: true,
      value: `${trans.value_per_100} g trans fat in ${total.value_per_100} g total fat`,
      compliant: false,
      issue: `Trans fat is ${(share * 100).toFixed(1)}% of total fat — above the FSSAI limit of 2%.`,
      status: "present",
    },
  };
}

// ===========================================================================
// Public API
// ===========================================================================

export interface EnrichOptions {
  /**
   * The authoritative category from the router. Falls back to the category on
   * the analysis itself, which the model was told to echo.
   */
  category?: string | null;
}

/**
 * Fill in the long explanations from local reference data, rebuild the
 * nutritional analysis, and recompute every score locally.
 * Pure — returns a copy.
 */
export function enrichAnalysis(
  analysis: ProductAnalysis,
  opts: EnrichOptions = {},
): ProductAnalysis {
  const category = String(
    opts.category ?? analysis?.detected_category?.category ?? "unknown",
  );
  const isFood = isFoodCategory(category);

  const out: ProductAnalysis = {
    ...analysis,
    ingredient_analysis: Array.isArray(analysis.ingredient_analysis)
      ? analysis.ingredient_analysis.map(mergeIngredient)
      : analysis.ingredient_analysis,
  };

  const nutrition = buildNutritionalAnalysis(out, category);
  if (nutrition) {
    // A safety score of null means no ingredients could be read at all. There
    // is then nothing to assess nutritionally either — scoring 100 off an
    // empty concerns list would be the exact dishonesty the partial-scan guard
    // exists to prevent.
    if (out.overall_assessment?.safety_score == null) {
      nutrition.nutrition_score = null;
      nutrition.nutrition_data_complete = false;
      nutrition.primary_concern = null;
      nutrition.moderation_advice =
        "Not enough of the ingredients list was readable to assess nutritional quality.";
    }
    out.nutritional_analysis = nutrition;
    recordTransFatViolation(out, nutrition);
  } else {
    // Non-food: the field is omitted entirely, never returned as an empty shell.
    delete out.nutritional_analysis;
  }

  const oa = out.overall_assessment ?? {
    safety_score: null,
    compliance_score: null,
    summary: "",
    recommendation: "",
  };
  const nutritionScore = nutrition?.nutrition_score ?? null;
  const overall = computeOverallScore(
    oa.safety_score ?? null,
    nutritionScore,
    oa.compliance_score ?? null,
    isFood,
  );

  out.overall_assessment = {
    ...oa,
    nutrition_score: nutritionScore,
    overall_score: overall,
  };
  const nFinal = out.nutritional_analysis ?? null;
  const veryHighThreshold =
    nFinal?.threshold_flags.some((f) => f.level === "very_high") ?? false;
  const useSparingly =
    nFinal?.food_type === "staple_ingredient" &&
    (nFinal.nutrient_density === "empty" ||
      STAPLE_USE_SPARINGLY_RE.test(
        [
          out.product_info?.name ?? "",
          out.ingredient_analysis?.[0]?.name ?? "",
        ].join(" ; "),
      ));

  out.verdict = deriveVerdict(
    oa.safety_score ?? null,
    nutritionScore,
    overall,
    isFood,
    out.verdict,
    nFinal?.food_type ?? "processed_product",
    { veryHighThreshold, useSparingly },
  );

  return out;
}

// ---------------------------------------------------------------------------
// STEP 8 — health-profile escalation for nutritional findings
// ---------------------------------------------------------------------------

const has = (list: string[], re: RegExp) => list.some((s) => re.test(s));

/**
 * Product-level personal alerts driven by the NUTRITION dimension.
 *
 * These are deterministic and computed here rather than asked of the model:
 * "diabetic + refined grain" must fire every time, not most of the time.
 * Returns [] when there is no profile or nothing to escalate.
 */
export function nutritionPersonalAlerts(
  profile: UserHealthProfileInput | null | undefined,
  analysis: ProductAnalysis,
): PersonalFlag[] {
  const n = analysis.nutritional_analysis;
  if (!profile || !n) return [];

  const conditions = profile.health_conditions ?? [];
  const diet = profile.dietary_preferences ?? [];
  const custom = profile.custom_avoid_ingredients ?? [];
  const all = [...conditions, ...diet, ...custom];

  const level = (nutrient: RegExp): NutrientLevel | null =>
    n.threshold_flags.find((f) => nutrient.test(f.nutrient))?.level ?? null;

  // "High" for a personal alert means any band the recalibration prices as a
  // real problem — medium_high (beverage sugar) and very_high included.
  const sugarLvl = level(/sugar/i);
  const sugarHigh =
    sugarLvl === "high" || sugarLvl === "very_high" || sugarLvl === "medium_high";
  const sodiumLvl = level(/sodium/i);
  const sodiumHigh = sodiumLvl === "high" || sodiumLvl === "very_high";
  const satFatLvl = level(/saturated/i);
  const satFatHigh = satFatLvl === "high" || satFatLvl === "very_high";
  const transFat =
    (n.threshold_flags.find((f) => /trans/i.test(f.nutrient))?.value_per_100 ?? 0) >
      0 || n.concerns.some((c) => c.concern_type === "trans_fat");

  const refinedGrain = n.concerns.filter((c) => c.concern_type === "refined_grain");
  const addedSugar = n.concerns.filter((c) => c.concern_type === "added_sugar");

  const out: PersonalFlag[] = [];
  const push = (
    severity: PersonalFlag["severity"],
    reason: string,
    ingredient: string | null = null,
  ) => out.push({ reason, severity, ingredient });

  // Diabetes — refined grain or a high sugar reading.
  const diabetic = has(conditions, /^diabetic$/i);
  const preDiabetic = has(conditions, /pre-?diabetic/i);
  if (diabetic || preDiabetic) {
    // Pre-diabetes gets the same flags one severity step down.
    const sev: PersonalFlag["severity"] = diabetic ? "critical" : "warning";
    if (refinedGrain.length) {
      push(
        sev,
        `Contains ${refinedGrain.map((c) => c.ingredient).join(", ")} — a refined grain that raises blood sugar quickly. ${refinedGrain[0].better_alternative ? `Better: ${refinedGrain[0].better_alternative}.` : ""}`.trim(),
        refinedGrain[0].ingredient,
      );
    }
    if (sugarHigh) {
      push(sev, "High sugar for a product you are managing blood glucose against.");
    }
  }

  if (has(conditions, /hypertension|high bp|blood pressure/i) && sodiumHigh) {
    push(
      "critical",
      "High sodium — above 600 mg per 100 g. Sodium raises blood pressure directly.",
    );
  }

  if (has(conditions, /heart|cardiac|cholesterol/i)) {
    if (satFatHigh) {
      push(
        "critical",
        "High saturated fat — above 5 g per 100 g, which raises LDL cholesterol.",
      );
    }
    if (transFat) {
      push(
        "critical",
        "Contains trans fat. There is no safe level of industrial trans fat for a heart condition.",
      );
    }
  }

  if (has(all, /weight|obes/i)) {
    if (n.is_ultra_processed) {
      push("warning", "Ultra-processed — these are easy to overeat and low in satiety.");
    }
    if (sugarHigh) push("warning", "High sugar adds calories without filling you up.");
  }

  if (has(diet, /^no sugar$/i) && addedSugar.length) {
    push(
      "warning",
      `Contains added sugar under ${addedSugar.length > 1 ? "these names" : "the name"}: ${n.sugar_aliases_found.join(", ") || addedSugar.map((c) => c.ingredient).join(", ")}.`,
    );
  }

  if (has(conditions, /child under/i)) {
    if (n.is_ultra_processed) {
      push("warning", "Ultra-processed food — worth keeping occasional for children.");
    }
    if (sugarHigh) push("warning", "High sugar for a child's daily intake.");
  }

  // Never duplicate an alert the model already produced.
  const existing = new Set(
    (analysis.personal_alerts ?? []).map((f) => norm(f.reason)),
  );
  return out.filter((f) => {
    const k = norm(f.reason);
    if (existing.has(k)) return false;
    existing.add(k);
    return true;
  });
}
