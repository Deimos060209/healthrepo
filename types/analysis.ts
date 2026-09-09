/**
 * Shape of the analysis returned by POST /api/analyze.
 *
 * The route asks Claude for exactly this JSON; the fields Claude cannot fill
 * from the OCR text come back as null / empty arrays rather than being omitted,
 * but treat every field as best-effort — always guard before rendering.
 */

export type SafetyStatus =
  | "safe"
  | "caution"
  | "harmful"
  | "banned"
  | "unknown";

/** Where a flagged ingredient's information came from. */
export type AnalysisSource = "reference_database" | "ai_knowledge";

/**
 * How urgent a personal-health-profile conflict is.
 * - critical: allergen present, or medically dangerous for the user's condition
 * - warning:  conflicts with a dietary preference, or concerning for a condition
 * - info:     mild relevance, worth noting
 */
export type PersonalFlagSeverity = "critical" | "warning" | "info";

/** One conflict between an ingredient/product and the user's health profile. */
export interface PersonalFlag {
  reason: string;
  severity: PersonalFlagSeverity;
  /** The ingredient this flag concerns; null for product-level alerts (e.g. high sodium). */
  ingredient?: string | null;
}

/**
 * Broad regulatory category the analyzer detects from the packaging text
 * (PHASE 1 of the analysis). Each maps to a different law + regulator, and the
 * ingredient rules applied in PHASE 2 depend on it.
 */
export type DetectedCategoryId =
  | "food_and_beverages"
  | "personal_care"
  | "household_cleaning"
  | "baby_product_food"
  | "baby_product_care"
  | "unknown";

export interface DetectedCategory {
  category: DetectedCategoryId;
  confidence: "high" | "medium" | "low";
  /** The text signals that identified the category (for transparency + the "is this right?" prompt). */
  signals_found: string[];
  regulatory_body: string;
  applicable_act: string;
  complaint_portal: string;
}

export interface ProductInfo {
  name: string | null;
  brand: string | null;
  category: string | null;
  net_weight: string | null;
  mrp: string | null;
  manufacture_date: string | null;
  expiry_date: string | null;
  manufacturer_address: string | null;
  fssai_license: string | null;
  batch_number: string | null;
  customer_care: string | null;
  country_of_origin: string | null;
}

/**
 * State of one mandatory declaration.
 * - present:        visible on the label
 * - missing:        label is legible and the declaration is genuinely absent
 * - not_visible:    could not tell — only part of the pack was photographed
 * - not_applicable: does not apply to this product category
 */
export type ComplianceItemStatus =
  | "present"
  | "missing"
  | "not_visible"
  | "not_applicable";

export interface ComplianceItem {
  present: boolean;
  value: string | null;
  compliant: boolean;
  issue: string | null;
  /** Optional richer state; older stored rows may not have it. */
  status?: ComplianceItemStatus;
}

/**
 * Keyed by the mandatory Legal Metrology (Packaged Commodities) Rules 2011
 * declaration. Keys are model-generated, so this is an index signature.
 */
export type LegalMetrologyCompliance = Record<string, ComplianceItem>;

export interface IngredientAnalysis {
  name: string;
  safety_status: SafetyStatus;
  /** Plain-language explanation of WHY it is flagged. */
  reason: string | null;
  /** Plain-language explanation of what it does to the human body. */
  health_effects: string | null;
  /** Specific higher-risk groups (children, pregnant women, asthmatics, …). */
  who_should_avoid: string | null;
  /** Countries / regions that ban or restrict it. */
  banned_in_countries: string[];
  healthier_alternative: string | null;
  /** Whether this came from our reference lists or Claude's own knowledge. */
  source: AnalysisSource;
  /** Optional: daily intake limit, when the model provides one. */
  daily_limit?: string | null;
  /**
   * Conflicts with the user's personal health profile — set only when a profile
   * was supplied. Empty for the general population.
   */
  personal_flags: PersonalFlag[];
}

/**
 * An ingredient Claude flagged from its own training data that was NOT in the
 * reference lists — surfaced so the knowledge base can be extended.
 */
export interface DatabaseGapEntry {
  name: string;
  why_flagged: string;
  suggested_status: SafetyStatus;
}

/**
 * 'ok'                — a real score was produced.
 * 'insufficient_data' — the scan couldn't read enough to score honestly
 *                       (no ingredients found, or >3 declarations not visible).
 *                       The matching score is then null.
 */
export type AssessmentStatus = "ok" | "insufficient_data";

export interface OverallAssessment {
  /** null when safety_status is 'insufficient_data'. */
  safety_score: number | null;
  /** null when compliance_status is 'insufficient_data'. */
  compliance_score: number | null;
  safety_status?: AssessmentStatus;
  compliance_status?: AssessmentStatus;
  summary: string;
  recommendation: string;
}

export interface BannedIngredientCheck {
  ingredient: string;
  detected: boolean;
  notes: string | null;
}

/**
 * Top-line call the results screen leads with.
 * - safe:    "Safe to consume"
 * - caution: "Consume with caution"
 * - avoid:   "Avoid this product"
 */
export type Verdict = "safe" | "caution" | "avoid";

/** Overall additive load, based on how many additives are present and how concerning they are. */
export type CumulativeRisk = "low" | "medium" | "high";

/** Outcome of checking one additive's amount against its FSSAI prescribed limit. */
export type LimitCheckStatus =
  | "within_limit"
  | "exceeds_limit"
  | "quantity_not_declared";

export interface AdditiveCount {
  preservatives: number;
  colors: number;
  sweeteners: number;
  antioxidants: number;
  emulsifiers: number;
  flavor_enhancers: number;
  total: number;
}

export interface LimitCheck {
  name: string;
  /** The FSSAI maximum for this additive in this product category, as text. */
  fssai_limit: string | null;
  /** The quantity declared on the pack, if any (usually not declared). */
  declared_quantity_if_available: string | null;
  status: LimitCheckStatus;
  note: string | null;
}

export interface DosageAnalysis {
  additive_count: AdditiveCount;
  limit_checks: LimitCheck[];
  cumulative_risk: CumulativeRisk;
  /** How much of this product a 60 kg adult could safely consume per day, when calculable. */
  daily_intake_warning: string | null;
  /** Dangerous combinations (multiple preservatives, benzoate + ascorbic acid, …). */
  combination_warnings: string[];
}

export interface ProductAnalysis {
  product_info: ProductInfo;
  /** Broad regulatory category (food / personal care / household / baby) + which rules were applied. */
  detected_category: DetectedCategory;
  /** Top-line call the results screen leads with. */
  verdict: Verdict;
  /** One sentence backing the verdict, <= 20 words. */
  verdict_reason: string;
  /** 2-4 short headline findings, each under ~12 words. */
  key_findings: string[];
  legal_metrology_compliance: LegalMetrologyCompliance;
  ingredient_analysis: IngredientAnalysis[];
  dosage_analysis: DosageAnalysis;
  /**
   * Product-level conflicts with the user's health profile (e.g. high sodium
   * with hypertension). Ingredient-specific conflicts live on each
   * IngredientAnalysis.personal_flags. Empty when no profile was supplied.
   */
  personal_alerts: PersonalFlag[];
  overall_assessment: OverallAssessment;
  banned_ingredients_check: BannedIngredientCheck[];
  ingredients_not_in_database: DatabaseGapEntry[];
}

/** The user's health profile as sent to /api/analyze (labels, not slugs). */
export interface UserHealthProfileInput {
  allergies: string[];
  dietary_preferences: string[];
  health_conditions: string[];
  custom_avoid_ingredients: string[];
}

export interface AnalyzeRequestBody {
  extractedText: string;
  imageUrl?: string;
  userHealthProfile?: UserHealthProfileInput | null;
  /**
   * Set when the user rejected the auto-detected category and picked the right
   * one. The analysis is then re-run under that category's rules.
   */
  categoryOverride?: DetectedCategoryId | null;
}
