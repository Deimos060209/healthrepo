/**
 * Defensive normalisation of the /api/analyze model response.
 *
 * Claude follows the response schema reliably, but "reliably" is not "always",
 * and this payload is consumed unguarded by the results page, the PDF generator
 * and the Supabase row. One malformed field — ingredient_analysis as an object
 * rather than an array, a null compliance entry, banned_in_countries as a comma
 * string — would throw mid-render and blank the screen. Everything here coerces
 * the reply into a shape all three consumers can read unconditionally.
 */

import type {
  ProductAnalysis,
  ProductInfo,
  LegalMetrologyCompliance,
  IngredientAnalysis,
  OverallAssessment,
  BannedIngredientCheck,
  DatabaseGapEntry,
  SafetyStatus,
  DosageAnalysis,
  CumulativeRisk,
  LimitCheckStatus,
  PersonalFlag,
  PersonalFlagSeverity,
  DetectedCategory,
  DetectedCategoryId,
  ComplianceItemStatus,
  NutritionalAnalysis,
  NutritionalConcern,
  NutritionalConcernLevel,
  NutritionalConcernType,
  NutrientLevel,
  ThresholdFlag,
  Verdict,
} from "@/types/analysis";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

const strList = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    return v.map(str).filter((x): x is string => x !== null);
  }
  const s = str(v);
  if (!s) return [];
  // Models occasionally send "USA, Norway" where a list was asked for.
  return s.split(",").map((p) => p.trim()).filter(Boolean);
};

/**
 * Returns null when the model explicitly declined to score
 * (safety_score: null / "insufficient_data") rather than inventing a 0.
 */
const clampScore = (n: number): number | null =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;

const scoreOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  // A number is the normal case — take it directly. (Testing the string
  // sentinels against a coerced "" here used to null EVERY numeric score.)
  if (typeof v === "number") return clampScore(v);
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (
    s === "" ||
    s === "null" ||
    s === "n/a" ||
    s === "na" ||
    s === "unknown" ||
    s.includes("insufficient")
  ) {
    return null;
  }
  return clampScore(Number(s));
};

const COMPLIANCE_ITEM_STATUSES: readonly string[] = [
  "present",
  "ok_inferred",
  "missing",
  "not_visible",
  "not_applicable",
];
/** Resolve a compliance item's state, honouring an explicit model `status`. */
const complianceItemStatus = (
  raw: unknown,
  present: boolean,
  issue: string | null,
): ComplianceItemStatus => {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (COMPLIANCE_ITEM_STATUSES.includes(s)) return s as ComplianceItemStatus;
  if (s.includes("not_visible") || s.includes("unclear") || s.includes("cannot_tell"))
    return "not_visible";
  if (s.includes("not_applicable") || s === "na") return "not_applicable";
  // "ok_inferred" / "inferred" / "ok inferred" — satisfied without an explicit
  // declaration (country of origin from an Indian address).
  if (s.includes("inferred")) return "ok_inferred";
  if (s.includes("present") || s.includes("found") || s === "ok" || s === "compliant")
    return "present";
  if (s.includes("missing") || s.includes("absent")) return "missing";
  // No usable status from the model — fall back to the old present/issue shape.
  if (!present && /not applicable/i.test(issue ?? "")) return "not_applicable";
  return present ? "present" : "missing";
};

const SAFETY_STATUSES: readonly string[] = [
  "safe",
  "caution",
  "harmful",
  "banned",
  "unknown",
];
const safetyStatus = (v: unknown): SafetyStatus => {
  const s = String(v ?? "").toLowerCase().trim();
  return SAFETY_STATUSES.includes(s) ? (s as SafetyStatus) : "unknown";
};

const PERSONAL_SEVERITIES: readonly string[] = ["critical", "warning", "info"];
const personalSeverity = (v: unknown): PersonalFlagSeverity => {
  const s = String(v ?? "").toLowerCase().trim();
  if (PERSONAL_SEVERITIES.includes(s)) return s as PersonalFlagSeverity;
  if (s.includes("critic") || s.includes("danger") || s.includes("severe"))
    return "critical";
  if (s.includes("warn") || s.includes("caution")) return "warning";
  return "info";
};

/** Coerce a `personal_flags` / `personal_alerts` array; drops entries with no reason. */
const personalFlags = (v: unknown): PersonalFlag[] =>
  (Array.isArray(v) ? v : [])
    .filter(isObj)
    .map((f) => ({
      reason: str(f.reason) ?? "",
      severity: personalSeverity(f.severity),
      ingredient: str(f.ingredient),
    }))
    .filter((f) => f.reason.length > 0);

/** Non-negative integer count; anything unparseable becomes 0. */
const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(str(v) ?? NaN);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Like strList but WITHOUT comma-splitting — warnings are full sentences. */
const sentenceList = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    return v.map(str).filter((x): x is string => x !== null);
  }
  const s = str(v);
  return s ? [s] : [];
};

const CUMULATIVE_RISKS: readonly string[] = ["low", "medium", "high"];
const cumulativeRisk = (v: unknown): CumulativeRisk => {
  const s = String(v ?? "").toLowerCase().trim();
  return CUMULATIVE_RISKS.includes(s) ? (s as CumulativeRisk) : "low";
};

const LIMIT_STATUSES: readonly string[] = [
  "within_limit",
  "exceeds_limit",
  "quantity_not_declared",
];
const limitStatus = (v: unknown): LimitCheckStatus => {
  const s = String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (LIMIT_STATUSES.includes(s)) return s as LimitCheckStatus;
  if (s.includes("exceed") || s.includes("over") || s.includes("above"))
    return "exceeds_limit";
  if (s.includes("within") || s.includes("under") || s.includes("ok"))
    return "within_limit";
  return "quantity_not_declared";
};

const DETECTED_CATEGORY_IDS: readonly string[] = [
  "food_and_beverages",
  "personal_care",
  "household_cleaning",
  "baby_product_food",
  "baby_product_care",
  "unknown",
];
const detectedCategoryId = (v: unknown): DetectedCategoryId => {
  const s = String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (DETECTED_CATEGORY_IDS.includes(s)) return s as DetectedCategoryId;
  // Tolerate near-misses from the model.
  if (s.includes("baby") && (s.includes("care") || s.includes("cosmetic")))
    return "baby_product_care";
  if (s.includes("baby") || s.includes("infant")) return "baby_product_food";
  if (s.includes("household") || s.includes("cleaning") || s.includes("cleaner"))
    return "household_cleaning";
  if (s.includes("personal") || s.includes("cosmetic") || s.includes("care"))
    return "personal_care";
  if (s.includes("food") || s.includes("beverage") || s.includes("drink"))
    return "food_and_beverages";
  return "unknown";
};

const CONFIDENCE_LEVELS: readonly string[] = ["high", "medium", "low"];

export function normalizeDetectedCategory(raw: unknown): DetectedCategory {
  const d = isObj(raw) ? raw : {};
  const conf = String(d.confidence ?? "").toLowerCase().trim();
  return {
    category: detectedCategoryId(d.category ?? d.detected_category),
    confidence: CONFIDENCE_LEVELS.includes(conf)
      ? (conf as DetectedCategory["confidence"])
      : "low",
    signals_found: sentenceList(d.signals_found),
    regulatory_body: str(d.regulatory_body) ?? "",
    applicable_act: str(d.applicable_act ?? d.act) ?? "",
    complaint_portal: str(d.complaint_portal) ?? "",
  };
}

export function normalizeDosageAnalysis(raw: unknown): DosageAnalysis {
  const d = isObj(raw) ? raw : {};
  const ac = isObj(d.additive_count) ? d.additive_count : {};

  const preservatives = count(ac.preservatives);
  const colors = count(ac.colors ?? ac.colours);
  const sweeteners = count(ac.sweeteners);
  const antioxidants = count(ac.antioxidants);
  const emulsifiers = count(ac.emulsifiers);
  const flavor_enhancers = count(ac.flavor_enhancers ?? ac.flavour_enhancers);
  const sum =
    preservatives +
    colors +
    sweeteners +
    antioxidants +
    emulsifiers +
    flavor_enhancers;
  const total = Math.max(count(ac.total), sum);

  const limit_checks = (
    Array.isArray(d.limit_checks) ? d.limit_checks : []
  )
    .filter(isObj)
    .map((v) => ({
      name: str(v.name) ?? "Unnamed additive",
      fssai_limit: str(v.fssai_limit),
      declared_quantity_if_available: str(v.declared_quantity_if_available),
      status: limitStatus(v.status),
      note: str(v.note),
    }));

  return {
    additive_count: {
      preservatives,
      colors,
      sweeteners,
      antioxidants,
      emulsifiers,
      flavor_enhancers,
      total,
    },
    limit_checks,
    cumulative_risk: cumulativeRisk(d.cumulative_risk),
    daily_intake_warning: str(d.daily_intake_warning),
    combination_warnings: sentenceList(d.combination_warnings),
  };
}

const CONCERN_TYPES: readonly string[] = [
  "refined_grain",
  "added_sugar",
  "refined_oil",
  "high_sodium",
  "saturated_fat",
  "trans_fat",
  "processed_protein",
  "low_nutrient_density",
];
const CONCERN_LEVELS: readonly string[] = ["mild", "moderate", "significant"];
const NUTRIENT_LEVELS: readonly string[] = [
  "low",
  "medium",
  "medium_high",
  "high",
  "very_high",
];

/** Plain number, or null. Used for nutrient readings off the panel. */
const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/**
 * Coerce the model's `nutritional_analysis` into the right SHAPE. It does not
 * score anything — lib/enrich-analysis.ts recomputes every penalty, level and
 * total from local reference data. Returns null when the model omitted the
 * field (which it is told to do for every non-food category).
 */
export function normalizeNutritionalAnalysis(
  raw: unknown,
): NutritionalAnalysis | null {
  if (!isObj(raw)) return null;

  const concerns: NutritionalConcern[] = (
    Array.isArray(raw.concerns) ? raw.concerns : []
  )
    .filter(isObj)
    .map((c) => {
      const level = String(c.concern_level ?? "").toLowerCase().trim();
      const type = String(c.concern_type ?? "")
        .toLowerCase()
        .trim()
        .replace(/[\s-]+/g, "_");
      return {
        ingredient: str(c.ingredient ?? c.name) ?? "",
        concern_type: (CONCERN_TYPES.includes(type)
          ? type
          : "low_nutrient_density") as NutritionalConcernType,
        concern_level: (CONCERN_LEVELS.includes(level)
          ? level
          : "moderate") as NutritionalConcernLevel,
        why_flagged: str(c.why_flagged),
        health_effects: str(c.health_effects),
        moderation_guidance: str(c.moderation_guidance),
        who_should_limit: strList(c.who_should_limit),
        better_alternative: str(c.better_alternative),
        score_penalty: numOrNull(c.score_penalty) ?? 0,
        source:
          c.source === "reference_database" ? "reference_database" : "ai_knowledge",
      } satisfies NutritionalConcern;
    })
    .filter((c) => c.ingredient.length > 0);

  const threshold_flags: ThresholdFlag[] = (
    Array.isArray(raw.threshold_flags) ? raw.threshold_flags : []
  )
    .filter(isObj)
    .map((f) => {
      const lvl = String(f.level ?? "").toLowerCase().trim();
      return {
        nutrient: str(f.nutrient) ?? "",
        value_per_100: numOrNull(f.value_per_100) ?? 0,
        unit: str(f.unit) ?? "g",
        level: (NUTRIENT_LEVELS.includes(lvl) ? lvl : "medium") as NutrientLevel,
        penalty: numOrNull(f.penalty) ?? 0,
        reference: str(f.reference),
      } satisfies ThresholdFlag;
    })
    .filter((f) => f.nutrient.length > 0);

  const density = String(raw.nutrient_density ?? "").toLowerCase().trim();
  const foodType = String(raw.food_type ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");

  return {
    nutrition_score: scoreOrNull(raw.nutrition_score),
    nutrition_data_complete: raw.nutrition_data_complete === true,
    // Shape only — enrichAnalysis() recomputes food_type, density and the
    // primary concern locally (with the model's values as a starting point).
    food_type: ([
      "staple_ingredient",
      "minimally_processed",
      "processed_product",
    ].includes(foodType)
      ? foodType
      : "processed_product") as NutritionalAnalysis["food_type"],
    food_type_reason: str(raw.food_type_reason),
    nutrient_density: (["high", "moderate", "low", "empty"].includes(density)
      ? density
      : "moderate") as NutritionalAnalysis["nutrient_density"],
    density_note: str(raw.density_note),
    primary_concern: null,
    concerns,
    threshold_flags,
    positive_notes: sentenceList(raw.positive_notes),
    sugar_alias_count: count(raw.sugar_alias_count),
    sugar_aliases_found: strList(raw.sugar_aliases_found),
    is_ultra_processed: raw.is_ultra_processed === true,
    ingredient_order_note: str(raw.ingredient_order_note),
    moderation_advice: str(raw.moderation_advice) ?? "",
    nutritional_concerns_not_in_database: strList(
      raw.nutritional_concerns_not_in_database,
    ),
  };
}

export function normalizeAnalysis(raw: unknown): ProductAnalysis {
  const r = isObj(raw) ? raw : {};

  const pi = isObj(r.product_info) ? r.product_info : {};
  const product_info: ProductInfo = {
    name: str(pi.name),
    brand: str(pi.brand),
    category: str(pi.category),
    net_weight: str(pi.net_weight),
    mrp: str(pi.mrp),
    manufacture_date: str(pi.manufacture_date),
    expiry_date: str(pi.expiry_date),
    manufacturer_address: str(pi.manufacturer_address),
    fssai_license: str(pi.fssai_license),
    batch_number: str(pi.batch_number),
    customer_care: str(pi.customer_care),
    country_of_origin: str(pi.country_of_origin),
  };

  const legal_metrology_compliance: LegalMetrologyCompliance = {};
  const lmc = isObj(r.legal_metrology_compliance)
    ? r.legal_metrology_compliance
    : {};
  for (const [key, v] of Object.entries(lmc)) {
    if (!isObj(v)) continue; // drop nulls / stray strings rather than render them
    const issue = str(v.issue);
    const present = v.present === true;
    const status = complianceItemStatus(v.status, present, issue);
    legal_metrology_compliance[key] = {
      present,
      value: str(v.value),
      // "ok_inferred" is compliant by definition (satisfied without an explicit
      // declaration), even if the model forgot to set compliant: true.
      compliant: v.compliant === true || status === "ok_inferred",
      issue,
      note: str(v.note),
      status,
    };
  }

  // Compliance is scored from the declarations that can actually be assessed
  // ("present", "ok_inferred" or "missing"). "not_visible" declarations — the
  // off-panel MRP / net quantity / dates on a normal single-photo scan — are
  // simply excluded, NOT a reason to discard the whole compliance verdict. It
  // is only "insufficient" when barely anything on the label was captured.
  const assessableComplianceCount = Object.values(
    legal_metrology_compliance,
  ).filter(
    (c) =>
      c.status === "present" ||
      c.status === "ok_inferred" ||
      c.status === "missing",
  ).length;

  const ingredient_analysis: IngredientAnalysis[] = (
    Array.isArray(r.ingredient_analysis) ? r.ingredient_analysis : []
  )
    .filter(isObj)
    .map((v) => ({
      name: str(v.name) ?? "Unnamed ingredient",
      safety_status: safetyStatus(v.safety_status),
      reason: str(v.reason),
      health_effects: str(v.health_effects),
      who_should_avoid: str(v.who_should_avoid),
      banned_in_countries: strList(v.banned_in_countries),
      healthier_alternative: str(v.healthier_alternative),
      source:
        v.source === "reference_database" ? "reference_database" : "ai_knowledge",
      personal_flags: personalFlags(v.personal_flags),
    }));

  const oa = isObj(r.overall_assessment) ? r.overall_assessment : {};
  const rawSafety = scoreOrNull(oa.safety_score);
  const rawCompliance = scoreOrNull(oa.compliance_score);
  // Force "insufficient" when the model said so, when it returned no score, when
  // it found no ingredients (cannot score safety), or when too much of the
  // label was unreadable (cannot score compliance).
  const safetyInsufficient =
    rawSafety === null ||
    /insufficient/i.test(String(oa.safety_status ?? "")) ||
    ingredient_analysis.length === 0;
  const complianceInsufficient =
    rawCompliance === null ||
    /insufficient/i.test(String(oa.compliance_status ?? "")) ||
    assessableComplianceCount < 2;

  // TEMP DEBUG — log which exact sub-condition nulled a score. Remove with the
  // ANALYZE_DEBUG / HAIKU_ROUTER_DEBUG logging in app/api/analyze/route.ts.
  if (safetyInsufficient || complianceInsufficient) {
    // eslint-disable-next-line no-console
    console.log(
      "INSUFFICIENT_GATE_DEBUG",
      JSON.stringify({
        safety_insufficient: safetyInsufficient,
        safety_trigger: safetyInsufficient
          ? rawSafety === null
            ? `rawSafety===null (model sent ${JSON.stringify(oa.safety_score)})`
            : /insufficient/i.test(String(oa.safety_status ?? ""))
              ? `model safety_status="${oa.safety_status}"`
              : `ingredient_analysis.length===0`
          : null,
        compliance_insufficient: complianceInsufficient,
        compliance_trigger: complianceInsufficient
          ? rawCompliance === null
            ? `rawCompliance===null (model sent ${JSON.stringify(oa.compliance_score)})`
            : /insufficient/i.test(String(oa.compliance_status ?? ""))
              ? `model compliance_status="${oa.compliance_status}"`
              : `assessableComplianceCount<2 (was ${assessableComplianceCount})`
          : null,
        raw_safety_score: rawSafety,
        raw_compliance_score: rawCompliance,
        ingredient_count: ingredient_analysis.length,
        assessable_compliance_count: assessableComplianceCount,
        lmc_statuses: Object.fromEntries(
          Object.entries(legal_metrology_compliance).map(([k, v]) => [
            k,
            v.status,
          ]),
        ),
      }),
    );
  }

  const overall_assessment: OverallAssessment = {
    safety_score: safetyInsufficient ? null : rawSafety,
    compliance_score: complianceInsufficient ? null : rawCompliance,
    safety_status: safetyInsufficient ? "insufficient_data" : "ok",
    compliance_status: complianceInsufficient ? "insufficient_data" : "ok",
    summary: str(oa.summary) ?? "",
    recommendation: str(oa.recommendation) ?? "",
  };

  // ---- Top-line verdict + headline findings (FIX 2) ----
  const bannedCount = ingredient_analysis.filter(
    (i) => i.safety_status === "banned",
  ).length;
  const harmfulCount = ingredient_analysis.filter(
    (i) => i.safety_status === "harmful",
  ).length;
  const verdict = normalizeVerdict(
    r.verdict,
    overall_assessment.safety_score,
    bannedCount,
    harmfulCount,
  );
  const verdict_reason = str(r.verdict_reason) ?? "";
  const key_findings = sentenceList(r.key_findings)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);

  const banned_ingredients_check: BannedIngredientCheck[] = (
    Array.isArray(r.banned_ingredients_check) ? r.banned_ingredients_check : []
  )
    .filter(isObj)
    .map((v) => ({
      ingredient: str(v.ingredient) ?? "Unknown",
      detected: v.detected === true,
      notes: str(v.notes),
    }));

  const ingredients_not_in_database: DatabaseGapEntry[] = (
    Array.isArray(r.ingredients_not_in_database)
      ? r.ingredients_not_in_database
      : []
  )
    .filter(isObj)
    .map((v) => ({
      name: str(v.name) ?? "Unnamed ingredient",
      why_flagged: str(v.why_flagged) ?? "",
      suggested_status: safetyStatus(v.suggested_status),
    }));

  return {
    product_info,
    detected_category: normalizeDetectedCategory(r.detected_category),
    verdict,
    verdict_reason,
    key_findings,
    legal_metrology_compliance,
    ingredient_analysis,
    dosage_analysis: normalizeDosageAnalysis(r.dosage_analysis),
    // Shape only — enrichAnalysis() rebuilds and rescores this, and drops it
    // entirely for the non-food categories.
    nutritional_analysis: normalizeNutritionalAnalysis(r.nutritional_analysis),
    personal_alerts: personalFlags(r.personal_alerts),
    overall_assessment,
    banned_ingredients_check,
    ingredients_not_in_database,
  };
}

const VERDICTS: readonly string[] = ["safe", "caution", "limit", "avoid"];
/**
 * Coerce the model's verdict, deriving a sane one when it is missing/garbled.
 * This is the FALLBACK: for a fully-scored scan, lib/enrich-analysis.ts
 * recomputes the verdict from the three dimensions and overrides it.
 */
export function normalizeVerdict(
  raw: unknown,
  safetyScore: number | null,
  bannedCount: number,
  harmfulCount: number,
): Verdict {
  const s = String(raw ?? "").toLowerCase().trim();
  if (VERDICTS.includes(s)) return s as Verdict;
  if (s.includes("avoid") || s.includes("unsafe") || s.includes("danger"))
    return "avoid";
  if (s.includes("limit") || s.includes("occasional")) return "limit";
  if (s.includes("caution") || s.includes("moderate")) return "caution";
  if (s === "safe" || s.includes("ok") || s.includes("good")) return "safe";
  // Derive from the numbers when the model gave nothing usable.
  if (bannedCount > 0) return "avoid";
  if (safetyScore != null) {
    if (safetyScore >= 75) return "safe";
    if (safetyScore >= 50) return "caution";
    return "avoid";
  }
  return harmfulCount > 0 ? "avoid" : "caution";
}