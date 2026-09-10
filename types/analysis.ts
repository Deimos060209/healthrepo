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
 * - ok_inferred:    not explicitly declared, but satisfied by other visible
 *                   text — currently only country_of_origin, resolved from a
 *                   full Indian manufacturer address. Counts as compliant.
 * - missing:        label is legible and the declaration is genuinely absent
 * - not_visible:    could not tell — only part of the pack was photographed
 * - not_applicable: does not apply to this product category
 */
export type ComplianceItemStatus =
  | "present"
  | "ok_inferred"
  | "missing"
  | "not_visible"
  | "not_applicable";

export interface ComplianceItem {
  present: boolean;
  value: string | null;
  compliant: boolean;
  issue: string | null;
  /**
   * Neutral explanatory text (not a problem). Used for "ok_inferred" to say the
   * label carries no explicit declaration but it was resolved from other text.
   */
  note?: string | null;
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
  /** Banned substances + harmful additives only. null when safety_status is 'insufficient_data'. */
  safety_score: number | null;
  /** null when compliance_status is 'insufficient_data'. */
  compliance_score: number | null;
  /**
   * Nutritional quality, 10-100. Computed locally (never by the model) from
   * `nutritional_analysis`. null for every non-food category, where nutrition
   * is not a meaningful dimension.
   */
  nutrition_score?: number | null;
  /**
   * Weighted blend of the three dimensions — food:
   *   safety x 0.35 + nutrition x 0.50 + compliance x 0.15
   * non-food:
   *   safety x 0.75 + compliance x 0.25
   * Nutrition carries the most weight: for a legal product on sale in India,
   * safety and compliance are usually fine and nutrition is what separates a
   * good choice from a bad one. null whenever safety_score or compliance_score
   * is null: a score is never computed from incomplete data.
   */
  overall_score?: number | null;
  safety_status?: AssessmentStatus;
  compliance_status?: AssessmentStatus;
  summary: string;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Nutritional quality (food categories only)
// ---------------------------------------------------------------------------

/**
 * Why an ingredient is nutritionally worth flagging. These are all LEGAL,
 * additive-free ingredients — the concern is dietary quality, never safety.
 */
export type NutritionalConcernType =
  | "refined_grain"
  | "added_sugar"
  | "refined_oil"
  | "high_sodium"
  | "saturated_fat"
  | "trans_fat"
  | "processed_protein"
  | "low_nutrient_density";

/**
 * How much the concern matters.
 * - mild:        minor, fine in normal amounts         (ai_knowledge penalty 3-5)
 * - moderate:    worth limiting, alternatives exist    (ai_knowledge penalty 6-10)
 * - significant: regular consumption is a real problem (ai_knowledge penalty 11-15)
 *
 * Those bands clamp concerns the model raised from its own knowledge. Curated
 * reference-database entries set their own penalty and may sit above the band
 * (e.g. maida is 'significant' / 18, semolina 'moderate' / 12) — the levels are
 * still ordered, the absolute numbers are just tuned per ingredient.
 */
export type NutritionalConcernLevel = "mild" | "moderate" | "significant";

/** One flagged ingredient in the nutritional (not safety) dimension. */
export interface NutritionalConcern {
  ingredient: string;
  concern_type: NutritionalConcernType;
  concern_level: NutritionalConcernLevel;
  why_flagged: string | null;
  health_effects: string | null;
  moderation_guidance: string | null;
  who_should_limit: string[];
  better_alternative: string | null;
  /** Points subtracted from nutrition_score. Assigned locally for reference_database entries. */
  score_penalty: number;
  source: AnalysisSource;
}

/**
 * Where a nutrient's per-100 value falls against the FSSAI/WHO reference bands.
 * 'medium_high' exists only on the beverage sugar scale; 'very_high' is the
 * extreme band on every scale and, on its own, caps the nutrition score.
 */
export type NutrientLevel =
  | "low"
  | "medium"
  | "medium_high"
  | "high"
  | "very_high";

/** One nutrient read off the nutrition panel and scored against its thresholds. */
export interface ThresholdFlag {
  /** "Sugar", "Sodium", "Saturated fat", "Total fat", "Trans fat", "Fibre". */
  nutrient: string;
  value_per_100: number;
  /** "g" or "mg" — the unit of value_per_100, not the serving basis. */
  unit: string;
  level: NutrientLevel;
  /** Positive = points subtracted; negative = a bonus (fibre). */
  penalty: number;
  /** Plain-language band this value was judged against. Filled in locally. */
  reference?: string | null;
}

/**
 * What a food positively contributes, judged from its PRIMARY ingredients (the
 * first three by weight), not from the absence of faults. A clean label and a
 * nutritious food are different things — this is the dimension that separates
 * "no active problems" from "genuinely nutrient-dense".
 *
 * - 'high'     — whole grains, legumes, nuts, seeds, plain dairy, eggs, fresh
 *                produce; meaningful fibre, protein, vitamins or minerals
 * - 'moderate' — some nutritional value but notable refinement/processing, or a
 *                narrow nutrient profile
 * - 'low'      — refined grains, starches, oils and sugars as primary
 *                ingredients; mainly calories, little fibre or micronutrients
 * - 'empty'    — essentially sugar, refined starch or fat with negligible
 *                nutritional contribution (soft drinks, boiled sweets)
 *
 * Drives a hard ceiling on nutrition_score: empty -> 30, low -> 70,
 * moderate -> 85, high -> no cap. Scores above 85 require genuine density.
 */
export type NutrientDensity = "high" | "moderate" | "low" | "empty";

/**
 * Whether this is a raw cooking input or a finished manufactured item — the
 * distinction is WHO controls the final dish. A bag of rice is a staple (the
 * eater decides what goes with it); a packet of instant noodles is a product
 * (the manufacturer decided). Staples are scored on a gentler scale: no
 * nutrient-density cap, no ultra-processing penalty, halved ingredient
 * penalties, a floor of 60. Processed products keep the strict rules.
 *
 * - 'staple_ingredient'   — 1-3 ingredient cooking input: rice, atta, dal,
 *                           plain pasta, oil, sugar, salt, spices, plain milk
 * - 'minimally_processed' — recognisable whole food, light processing: dahi,
 *                           paneer, roasted nuts, dried fruit, frozen veg
 * - 'processed_product'   — formulated recipe eaten as-is: biscuits, chips,
 *                           sauces, cereals, noodles, beverages, confectionery
 */
export type FoodType =
  | "staple_ingredient"
  | "minimally_processed"
  | "processed_product";

/**
 * The single largest contributor to the nutrition penalty. The results screen
 * and the PDF LEAD with this — it is what the user should take away. null only
 * when nothing at all was flagged.
 */
export interface PrimaryConcern {
  /** Nutrient name ("Sugar", "Sodium", …) or the ingredient / rule responsible. */
  nutrient_or_ingredient: string;
  /** Threshold band for a nutrient, concern_level for an ingredient. */
  level: string;
  /** Points this single contributor removed from nutrition_score. */
  penalty: number;
  /** One plain sentence naming the concern and its value. */
  explanation: string;
}

export interface NutritionalAnalysis {
  /** 10-95, or null when the category has no nutrition dimension. */
  nutrition_score: number | null;
  /** false when no nutrition panel was visible — thresholds could not be applied. */
  nutrition_data_complete: boolean;
  /**
   * Raw cooking input vs finished product. Recomputed locally (model's call is
   * the starting point). Decides which scoring scale applies.
   */
  food_type: FoodType;
  /** One line explaining the food_type classification. */
  food_type_reason: string | null;
  /**
   * What the food positively provides. Recomputed locally (with the model's
   * classification as a starting point, then local downgrades for refined
   * primary ingredients). Drives a hard score ceiling for non-staples.
   */
  nutrient_density: NutrientDensity;
  /** One sentence explaining the nutrient_density classification. */
  density_note: string | null;
  /** The biggest single contributor to the penalty; the UI and PDF lead with it. */
  primary_concern: PrimaryConcern | null;
  concerns: NutritionalConcern[];
  threshold_flags: ThresholdFlag[];
  positive_notes: string[];
  /** How many DISTINCT added-sugar names appear in the ingredients list. */
  sugar_alias_count: number;
  sugar_aliases_found: string[];
  is_ultra_processed: boolean;
  /** Set when sugar or a refined grain appears in the first three ingredients. */
  ingredient_order_note: string | null;
  moderation_advice: string;
  /** Concerns the model flagged from its own training rather than the reference list. */
  nutritional_concerns_not_in_database: string[];
}

export interface BannedIngredientCheck {
  ingredient: string;
  detected: boolean;
  notes: string | null;
}

/**
 * Top-line call the results screen leads with. Driven by the WEAKEST relevant
 * dimension, not by the average — see deriveVerdict() in lib/enrich-analysis.ts.
 * - safe:    "Safe to consume"          (the 'good' branch: overall >= 75)
 * - caution: "Consume with caution"
 * - limit:   "Okay occasionally"        — nothing harmful, but nutritionally poor
 * - avoid:   "Avoid this product"
 */
export type Verdict = "safe" | "caution" | "limit" | "avoid";

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
   * Nutritional quality — a second dimension alongside safety, covering legal,
   * additive-free ingredients that are still worth flagging (refined grains,
   * added sugar, refined oils, high sodium). Omitted entirely for
   * personal_care / household_cleaning / baby_product_care.
   */
  nutritional_analysis?: NutritionalAnalysis | null;
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
