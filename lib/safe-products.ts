/**
 * Verified safe products — ACCURACY-FIRST.
 *
 * Nothing here is a curated list. Every product surfaced by these helpers comes
 * from `public.verified_safe_products` / `public.search_safe_products`, which are
 * pure projections of real scan rows that scored >= 75 AND came back
 * `compliant`. The more the community scans, the more this returns.
 *
 * See supabase/migrations/20260909020000_safe_products_view.sql.
 */

import type {
  DetectedCategory,
  DetectedCategoryId,
  IngredientAnalysis,
} from "@/types/analysis";
import type { HealthProfile } from "./health-profile";

// ---------------------------------------------------------------------------
// Row shape (shared by the view and the RPC)
// ---------------------------------------------------------------------------

export interface SafeProductRow {
  id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  detected_category?: DetectedCategory | null;
  image_url: string | null;
  overall_score: number | null;
  compliance_status: string | null;
  ingredient_analysis: IngredientAnalysis[] | Record<string, never> | null;
  times_scanned: number | string | null;
}

/** One de-duplicated product (best-scoring scan wins), with its verification count. */
export interface SafeProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  /** Broad regulatory category id (food / personal care / …); "unknown" for older rows. */
  categoryId: DetectedCategoryId;
  imageUrl: string | null;
  score: number;
  ingredients: IngredientAnalysis[];
  timesScanned: number;
}

const toCategoryId = (
  v: DetectedCategory | null | undefined,
): DetectedCategoryId => {
  const id = v?.category;
  return id === "food_and_beverages" ||
    id === "personal_care" ||
    id === "household_cleaning" ||
    id === "baby_product_food" ||
    id === "baby_product_care"
    ? id
    : "unknown";
};

const SCORE_FILTERS = [
  { key: "75", label: "All safe (75+)", min: 75 },
  { key: "85", label: "Very safe (85+)", min: 85 },
  { key: "95", label: "Excellent (95+)", min: 95 },
] as const;
export type ScoreFilterKey = (typeof SCORE_FILTERS)[number]["key"];
export const SCORE_FILTER_OPTIONS = SCORE_FILTERS;

const asArray = (v: unknown): IngredientAnalysis[] =>
  Array.isArray(v) ? (v as IngredientAnalysis[]) : [];

const toCount = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * Collapse many scan rows into one card per product (name + brand), keeping the
 * highest-scoring scan as the representative and the largest `times_scanned`.
 */
export function dedupeSafeProducts(rows: SafeProductRow[]): SafeProduct[] {
  const byKey = new Map<string, SafeProduct>();
  for (const r of rows) {
    if (!r.product_name) continue;
    const key = `${r.product_name.trim().toLowerCase()}|${(r.brand ?? "")
      .trim()
      .toLowerCase()}`;
    const score = Math.max(0, Math.min(100, Math.round(r.overall_score ?? 0)));
    const timesScanned = toCount(r.times_scanned);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        id: r.id,
        name: r.product_name,
        brand: r.brand,
        category: r.category,
        categoryId: toCategoryId(r.detected_category),
        imageUrl: r.image_url,
        score,
        ingredients: asArray(r.ingredient_analysis),
        timesScanned: Math.max(timesScanned, 1),
      });
      continue;
    }
    existing.timesScanned = Math.max(existing.timesScanned, timesScanned, 1);
    if (score > existing.score) {
      existing.score = score;
      existing.id = r.id;
      existing.ingredients = asArray(r.ingredient_analysis);
      existing.category = r.category;
      existing.categoryId = toCategoryId(r.detected_category);
    }
    if (!existing.imageUrl && r.image_url) existing.imageUrl = r.image_url;
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.score - a.score || b.timesScanned - a.timesScanned,
  );
}

// ---------------------------------------------------------------------------
// Ingredient summary (shown on every card)
// ---------------------------------------------------------------------------

export interface IngredientSummary {
  safe: number;
  concerning: number;
  noBanned: boolean;
  noHarmfulAdditives: boolean;
}

const ADDITIVE_HINT =
  /\b(e\s?\d{3}|ins\s?\d{3}|colour|color|preservative|emulsifier|stabili[sz]er|acidity regulator|antioxidant|flavour enhancer|flavor enhancer|sweetener)\b/i;

export function summarizeIngredients(
  ingredients: IngredientAnalysis[],
): IngredientSummary {
  let safe = 0;
  let concerning = 0;
  let banned = 0;
  let harmfulAdditive = 0;
  for (const ing of ingredients) {
    const status = ing.safety_status;
    if (status === "safe") safe += 1;
    else if (status === "caution" || status === "harmful") concerning += 1;
    if (status === "banned") banned += 1;
    const looksAdditive =
      ADDITIVE_HINT.test(ing.name ?? "") ||
      ADDITIVE_HINT.test(ing.reason ?? "");
    if (looksAdditive && (status === "harmful" || status === "banned"))
      harmfulAdditive += 1;
  }
  return {
    safe,
    concerning,
    noBanned: banned === 0,
    noHarmfulAdditives: harmfulAdditive === 0,
  };
}

// ---------------------------------------------------------------------------
// Health-profile matching
//
// The view does not carry per-user `personal_flags` (those are computed at scan
// time against the scanning user's own profile), so we re-check the ingredient
// list here with a conservative keyword match. False negatives are possible;
// anything it flags is worth showing.
// ---------------------------------------------------------------------------

export type ProfileConcernSeverity = "critical" | "warning";

export interface ProfileConcern {
  severity: ProfileConcernSeverity;
  message: string;
}

const ALLERGEN_TERMS: Record<string, string[]> = {
  Nuts: ["nut", "almond", "cashew", "walnut", "hazelnut", "pistachio", "pecan"],
  Peanuts: ["peanut", "groundnut", "arachis"],
  Gluten: ["gluten", "wheat", "barley", "rye", "malt", "maida", "atta", "semolina"],
  "Dairy/Lactose": [
    "milk",
    "lactose",
    "whey",
    "casein",
    "butter",
    "ghee",
    "cheese",
    "cream",
    "khoya",
  ],
  Eggs: ["egg", "albumen", "albumin"],
  Soy: ["soy", "soya", "soja", "edamame"],
  Shellfish: ["shellfish", "shrimp", "prawn", "crab", "lobster", "krill"],
  Fish: ["fish", "anchovy", "tuna", "cod", "sardine"],
  Wheat: ["wheat", "atta", "maida", "semolina", "suji", "rava"],
  Sesame: ["sesame", "til", "tahini", "gingelly"],
  Mustard: ["mustard", "sarson", "rai"],
  Celery: ["celery", "celeriac"],
};

const DIET_TERMS: Record<string, { terms: string[]; label: string }> = {
  "No sugar": {
    terms: ["sugar", "sucrose", "glucose", "fructose", "corn syrup", "invert syrup", "honey"],
    label: "contains added sugar",
  },
  "Low sugar": {
    terms: ["sugar", "sucrose", "glucose syrup", "corn syrup", "invert syrup"],
    label: "contains added sugar",
  },
  "No artificial sweeteners": {
    terms: ["aspartame", "sucralose", "acesulfame", "saccharin", "sweetener", "e95", "e951", "e950", "e955"],
    label: "contains an artificial sweetener",
  },
  "Low sodium/salt": { terms: ["salt", "sodium"], label: "contains added salt / sodium" },
  "Low fat": { terms: ["palm oil", "palmolein", "hydrogenated", "vanaspati"], label: "contains added fat / oil" },
  "No trans fat": {
    terms: ["hydrogenated", "vanaspati", "trans fat", "partially hydrogenated"],
    label: "may contain trans fat (hydrogenated oil)",
  },
  "No artificial colors": {
    terms: ["colour", "color", "tartrazine", "sunset yellow", "carmoisine", "ponceau", "brilliant blue", "e102", "e110", "e122", "e124", "e133"],
    label: "contains an added colour",
  },
  "No artificial preservatives": {
    terms: ["preservative", "benzoate", "sorbate", "sulphite", "sulfite", "metabisulphite", "nitrite", "e2"],
    label: "contains a chemical preservative",
  },
  Vegetarian: { terms: ["gelatin", "gelatine", "rennet", "carmine", "cochineal", "lard", "tallow"], label: "may contain a non-vegetarian ingredient" },
  Vegan: {
    terms: ["milk", "ghee", "butter", "honey", "gelatin", "egg", "whey", "casein", "lactose", "cheese"],
    label: "contains an animal-derived ingredient",
  },
  Keto: { terms: ["sugar", "maltodextrin", "corn syrup", "wheat flour", "rice"], label: "high-carb — not keto-friendly" },
  "No palm oil": { terms: ["palm oil", "palmolein", "palm kernel", "palm fat"], label: "contains palm oil" },
  "No high fructose corn syrup": {
    terms: ["high fructose corn syrup", "hfcs", "corn syrup", "glucose-fructose syrup"],
    label: "contains high-fructose corn syrup",
  },
  "Organic only": { terms: [], label: "" },
  "No MSG": {
    terms: ["monosodium glutamate", "msg", "e621", "621", "disodium guanylate", "disodium inosinate", "e627", "e631"],
    label: "contains MSG / a flavour enhancer",
  },
};

const CONDITION_TERMS: Record<
  string,
  { terms: string[]; message: string }
> = {
  Diabetic: {
    terms: ["sugar", "sucrose", "glucose", "fructose", "corn syrup", "maltodextrin", "honey", "invert syrup"],
    message: "Contains sugar — not ideal for a diabetic diet",
  },
  "Pre-diabetic": {
    terms: ["sugar", "sucrose", "glucose", "corn syrup", "maltodextrin", "honey"],
    message: "Contains sugar — go easy with a pre-diabetic diet",
  },
  "Hypertension (high BP)": {
    terms: ["salt", "sodium"],
    message: "Contains added sodium — watch your intake with high BP",
  },
  "Heart condition": {
    terms: ["hydrogenated", "vanaspati", "trans fat", "palm oil", "palmolein"],
    message: "Contains saturated / hydrogenated fat — not ideal for a heart condition",
  },
  "Kidney condition": {
    terms: ["sodium", "potassium chloride", "phosphate", "phosphoric"],
    message: "Contains sodium / phosphate additives — check with a kidney condition",
  },
  Pregnant: {
    terms: ["caffeine", "aspartame", "artificial colour"],
    message: "Contains caffeine or additives worth limiting during pregnancy",
  },
  Breastfeeding: {
    terms: ["caffeine"],
    message: "Contains caffeine — limit while breastfeeding",
  },
  "Child under 5": {
    terms: ["colour", "color", "caffeine", "aspartame", "benzoate"],
    message: "Contains colours / caffeine / additives best avoided for under-5s",
  },
  "Child under 12": {
    terms: ["caffeine", "energy"],
    message: "Contains caffeine — not recommended for children",
  },
  "ADHD (self/child)": {
    terms: ["tartrazine", "sunset yellow", "carmoisine", "ponceau", "allura", "e102", "e110", "e122", "e124", "e129", "benzoate"],
    message: "Contains a colour / benzoate linked to hyperactivity (Southampton six)",
  },
  "Phenylketonuria (PKU)": {
    terms: ["aspartame", "phenylalanine", "e951"],
    message: "Contains aspartame (a source of phenylalanine) — unsafe with PKU",
  },
  Asthma: {
    terms: ["sulphite", "sulfite", "metabisulphite", "sulphur dioxide", "tartrazine", "benzoate"],
    message: "Contains sulphites / additives that can trigger asthma",
  },
};

const norm = (s: string) => s.toLowerCase();

function ingredientHaystack(ingredients: IngredientAnalysis[]): string {
  return ingredients
    .map((i) => `${i.name ?? ""} ${i.reason ?? ""}`)
    .join(" | ")
    .toLowerCase();
}

function hit(haystack: string, terms: string[]): boolean {
  return terms.some((t) => t && haystack.includes(norm(t)));
}

/**
 * Re-check a product's ingredient list against the user's health profile.
 * Returns an empty array when the profile is empty or nothing matched.
 */
export function profileConcerns(
  ingredients: IngredientAnalysis[],
  profile: HealthProfile | null | undefined,
): ProfileConcern[] {
  if (!profile || ingredients.length === 0) return [];
  const hay = ingredientHaystack(ingredients);
  const out: ProfileConcern[] = [];
  const seen = new Set<string>();
  const push = (severity: ProfileConcernSeverity, message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    out.push({ severity, message });
  };

  for (const allergy of profile.allergies) {
    const terms = ALLERGEN_TERMS[allergy] ?? [norm(allergy)];
    if (hit(hay, terms)) push("critical", `May contain ${allergy.toLowerCase()} — you flagged this as an allergy`);
  }

  for (const raw of profile.custom_avoid_ingredients) {
    const term = raw.trim();
    if (term.length >= 3 && hay.includes(norm(term)))
      push("critical", `Contains "${term}" — on your avoid list`);
  }

  for (const pref of profile.dietary_preferences) {
    const rule = DIET_TERMS[pref];
    if (rule && rule.terms.length && hit(hay, rule.terms))
      push("warning", `${rule.label} — conflicts with "${pref}"`);
  }

  for (const cond of profile.health_conditions) {
    const rule = CONDITION_TERMS[cond];
    if (rule && hit(hay, rule.terms))
      push(cond === "Phenylketonuria (PKU)" ? "critical" : "warning", rule.message);
  }

  return out;
}
