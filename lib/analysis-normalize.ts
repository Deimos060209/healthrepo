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

const score = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(str(v) ?? NaN);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
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
    legal_metrology_compliance[key] = {
      present: v.present === true,
      value: str(v.value),
      compliant: v.compliant === true,
      issue: str(v.issue),
    };
  }

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
  const overall_assessment: OverallAssessment = {
    safety_score: score(oa.safety_score),
    compliance_score: score(oa.compliance_score),
    summary: str(oa.summary) ?? "",
    recommendation: str(oa.recommendation) ?? "",
  };

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
    legal_metrology_compliance,
    ingredient_analysis,
    dosage_analysis: normalizeDosageAnalysis(r.dosage_analysis),
    personal_alerts: personalFlags(r.personal_alerts),
    overall_assessment,
    banned_ingredients_check,
    ingredients_not_in_database,
  };
}