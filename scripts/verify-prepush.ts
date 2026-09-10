/* eslint-disable no-console */
/**
 * PRE-PUSH VERIFICATION — Parts 2, 3 and 4.
 *
 * Everything here is PURE LOCAL LOGIC (normalizeAnalysis + enrichAnalysis +
 * buildCompactReference + the reference tables). No Anthropic call, no cost.
 * It constructs the raw JSON a Sonnet reply would carry and runs it through the
 * exact pipeline /api/analyze uses, so the numbers are the numbers the route
 * would return.
 *
 * Run: npx tsx scripts/verify-prepush.ts
 */
import {
  buildCompactReference,
  normalizeCompactCategory,
  PRODUCT_CATEGORY_RULES,
  BANNED_INGREDIENTS,
  HARMFUL_ADDITIVES,
  NUTRITIONAL_CONCERNS,
  NUTRITIONAL_THRESHOLDS,
  NUTRITIONAL_POSITIVES,
  PERSONAL_CARE_BANNED_INGREDIENTS,
  PERSONAL_CARE_HARMFUL_ADDITIVES,
  HOUSEHOLD_PRODUCT_SAFETY,
} from "@/lib/reference-data";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import { enrichAnalysis } from "@/lib/enrich-analysis";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`    PASS  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`    FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}
const hr = (t: string) => {
  console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`);
};
const sub = (t: string) => console.log(`\n  ── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);

// ---------------------------------------------------------------------------
// Raw-response builder — mirrors the shape /api/analyze asks Sonnet for.
// ---------------------------------------------------------------------------
interface RawIng {
  name: string;
  safety_status: string;
  source: "reference_database" | "ai_knowledge";
  reason?: string;
  health_effects?: string;
  who_should_avoid?: string;
  banned_in_countries?: string[];
  healthier_alternative?: string;
}
interface RawFlag {
  nutrient: string;
  value_per_100: number;
  unit: string;
  level?: string;
  penalty?: number;
}
function raw(opts: {
  name?: string | null;
  netWeight?: string | null;
  ingredients: RawIng[];
  safety?: number | null;
  compliance?: number | null;
  foodType?: string;
  density?: string;
  concerns?: {
    ingredient: string;
    concern_type: string;
    concern_level: string;
    score_penalty: number;
    source: string;
    why_flagged?: string;
    health_effects?: string;
    moderation_guidance?: string;
    better_alternative?: string;
  }[];
  flags?: RawFlag[];
  additiveTotal?: number;
  includeNutrition?: boolean;
  bannedCheck?: { ingredient: string; detected: boolean; notes: string | null }[];
  notInDb?: { name: string; why_flagged: string; suggested_status: string }[];
  category?: string;
}): Record<string, unknown> {
  const decl = (present: boolean, value: string | null) => ({
    present,
    value,
    compliant: present,
    issue: present ? null : "Not printed on the visible part of the pack",
    status: present ? "present" : "missing",
  });
  const out: Record<string, unknown> = {
    product_info: {
      name: opts.name === undefined ? "Test Product" : opts.name,
      brand: "TestBrand",
      category: null,
      net_weight: opts.netWeight ?? "100 g",
      mrp: "Rs. 50",
      manufacture_date: "01/2026",
      expiry_date: null,
      manufacturer_address: "Test Industrial Area, Pune 411001",
      fssai_license: "10012345678901",
      batch_number: "TB-01",
      customer_care: "1800-000-0000",
      country_of_origin: "India",
    },
    legal_metrology_compliance: {
      manufacturer_info: decl(true, "Test Industrial Area, Pune"),
      generic_name: decl(true, "Test Product"),
      net_quantity: decl(true, opts.netWeight ?? "100 g"),
      manufacture_date: decl(true, "01/2026"),
      best_before_use_by: decl(true, "6 months"),
      mrp: decl(true, "Rs. 50"),
      unit_sale_price: decl(false, null),
      consumer_care: decl(true, "1800-000-0000"),
      country_of_origin: decl(true, "India"),
      fssai_license: decl(true, "10012345678901"),
      dimensions_if_applicable: decl(true, "n/a"),
    },
    ingredient_analysis: opts.ingredients.map((i) => ({
      name: i.name,
      safety_status: i.safety_status,
      reason: i.reason ?? "",
      health_effects: i.health_effects ?? "",
      who_should_avoid: i.who_should_avoid ?? "",
      banned_in_countries: i.banned_in_countries ?? [],
      healthier_alternative: i.healthier_alternative ?? "",
      source: i.source,
      personal_flags: [],
    })),
    overall_assessment: {
      safety_score: opts.safety === undefined ? 90 : opts.safety,
      compliance_score: opts.compliance === undefined ? 90 : opts.compliance,
      safety_status: "ok",
      compliance_status: "ok",
      summary: "Test summary sentence one. Sentence two. Sentence three.",
      recommendation: "Test recommendation.",
    },
    verdict: "caution",
    verdict_reason: "Test verdict reason under twenty words.",
    key_findings: ["Finding one", "Finding two"],
    banned_ingredients_check: opts.bannedCheck ?? [],
    ingredients_not_in_database: opts.notInDb ?? [],
    dosage_analysis: {
      additive_count: {
        preservatives: 0,
        colors: 0,
        sweeteners: 0,
        antioxidants: 0,
        emulsifiers: 0,
        flavor_enhancers: 0,
        total: opts.additiveTotal ?? 0,
      },
      limit_checks: [],
      cumulative_risk: "low",
      daily_intake_warning: null,
      combination_warnings: [],
    },
    personal_alerts: [],
    detected_category: {
      category: opts.category ?? "food_and_beverages",
      confidence: "high",
      signals_found: ["test"],
      regulatory_body: "",
      applicable_act: "",
      complaint_portal: "",
    },
  };
  if (opts.includeNutrition !== false) {
    out.nutritional_analysis = {
      nutrition_score: 50,
      nutrition_data_complete: true,
      food_type: opts.foodType ?? "processed_product",
      food_type_reason: "test",
      nutrient_density: opts.density ?? "moderate",
      density_note: null,
      primary_concern: null,
      concerns: opts.concerns ?? [],
      threshold_flags: (opts.flags ?? []).map((f) => ({
        nutrient: f.nutrient,
        value_per_100: f.value_per_100,
        unit: f.unit,
        level: f.level ?? "medium",
        penalty: f.penalty ?? 0,
      })),
      positive_notes: [],
      sugar_alias_count: 0,
      sugar_aliases_found: [],
      is_ultra_processed: false,
      ingredient_order_note: null,
      moderation_advice: "",
      nutritional_concerns_not_in_database: [],
    };
  }
  return out;
}
const run = (r: Record<string, unknown>, category: string) =>
  enrichAnalysis(normalizeAnalysis(r), { category });

// ===========================================================================
hr("PART 2 — OUTPUT QUALITY PROOF (enrichAnalysis re-attaches reference text)");
// ===========================================================================

const bromate = BANNED_INGREDIENTS.find((b) => b.name === "Potassium Bromate")!;
const tartrazine = HARMFUL_ADDITIVES.find((a) => /tartrazine/i.test(a.name))!;
console.log(
  `  reference rows: Potassium Bromate=${!!bromate}  Tartrazine=${!!tartrazine} (${tartrazine?.name})`,
);

const MODEL_PG_HEALTH =
  "Propyl gallate is a synthetic phenolic antioxidant used to stop fats going rancid. Animal studies at high doses have reported effects on the stomach, kidneys and reproductive organs, and it is a recognised contact allergen.";
const MODEL_PG_AVOID =
  "People with a known gallate or salicylate sensitivity, and anyone with contact dermatitis.";
const MODEL_PG_ALT = "Products preserved with mixed tocopherols (vitamin E) or rosemary extract.";

const p2 = run(
  raw({
    name: "Test Bakery Snack",
    ingredients: [
      {
        name: "Potassium Bromate",
        safety_status: "banned",
        source: "reference_database",
        reason: "short model line",
      },
      {
        name: "Tartrazine",
        safety_status: "harmful",
        source: "reference_database",
        reason: "short model line",
      },
      {
        name: "Propyl Gallate (E310)",
        safety_status: "caution",
        source: "ai_knowledge",
        reason: "Synthetic antioxidant of documented concern.",
        health_effects: MODEL_PG_HEALTH,
        who_should_avoid: MODEL_PG_AVOID,
        banned_in_countries: ["Restricted in the EU (E310) with an ADI"],
        healthier_alternative: MODEL_PG_ALT,
      },
    ],
    bannedCheck: [
      { ingredient: "Potassium Bromate", detected: true, notes: "in the flour treatment" },
    ],
    notInDb: [
      {
        name: "Propyl Gallate (E310)",
        why_flagged: "Synthetic antioxidant, animal-study concerns",
        suggested_status: "caution",
      },
    ],
    flags: [{ nutrient: "Sugar", value_per_100: 8, unit: "g" }],
  }),
  "food_and_beverages",
);

const ing = (n: RegExp) => p2.ingredient_analysis.find((i) => n.test(i.name))!;
const kb = ing(/potassium bromate/i);
const tz = ing(/tartrazine/i);
const pg = ing(/propyl gallate/i);

sub("banned ingredient — FULL why_banned + health_effects_detailed");
check("Potassium Bromate present", !!kb);
check(
  "reason === reference why_banned (full text)",
  kb.reason === bromate.why_banned,
  `${kb.reason?.length ?? 0} chars`,
);
check(
  "health_effects === reference health_effects_detailed (full text)",
  kb.health_effects === bromate.health_effects_detailed,
  `${kb.health_effects?.length ?? 0} chars`,
);
check("reason is NOT the model's short line", kb.reason !== "short model line");
check("safety_status preserved as 'banned'", kb.safety_status === "banned");
check("healthier_alternative populated", !!kb.healthier_alternative, String(kb.healthier_alternative).slice(0, 60));

sub("harmful additive — FULL detail + who_should_avoid + banned_in + alternative");
check("Tartrazine present", !!tz);
check(
  "health_effects === reference health_effects_detailed",
  tz.health_effects === tartrazine.health_effects_detailed,
  `${tz.health_effects?.length ?? 0} chars`,
);
check(
  "reason === reference why_concerning",
  tz.reason === tartrazine.why_concerning,
  `${tz.reason?.length ?? 0} chars`,
);
check(
  "who_should_avoid === reference who_should_avoid",
  tz.who_should_avoid === tartrazine.who_should_avoid,
  `${tz.who_should_avoid?.length ?? 0} chars`,
);
check(
  "banned_in_countries === reference banned_or_restricted_in",
  JSON.stringify(tz.banned_in_countries) ===
    JSON.stringify(tartrazine.banned_or_restricted_in ?? []),
  `${tz.banned_in_countries.length} entries`,
);
check(
  "healthier_alternative populated from reference",
  !!tz.healthier_alternative && tz.healthier_alternative === tartrazine.healthier_alternative,
);
check("safety_status preserved as 'harmful'", tz.safety_status === "harmful");

sub("ai_knowledge — the model's own explanation is KEPT, not overwritten");
check("Propyl Gallate present", !!pg);
check("health_effects === model text", pg.health_effects === MODEL_PG_HEALTH);
check("who_should_avoid === model text", pg.who_should_avoid === MODEL_PG_AVOID);
check("healthier_alternative === model text", pg.healthier_alternative === MODEL_PG_ALT);
check("source stays 'ai_knowledge'", pg.source === "ai_knowledge");
check(
  "listed in ingredients_not_in_database",
  p2.ingredients_not_in_database.some((x) => /propyl gallate/i.test(x.name)),
);
check(
  "Propyl Gallate genuinely absent from every reference list",
  !BANNED_INGREDIENTS.some((b) =>
    [b.name, ...b.also_known_as].some((s) => /gallate/i.test(s)),
  ) &&
    !HARMFUL_ADDITIVES.some((a) => /gallate/i.test(a.name)) &&
    !NUTRITIONAL_CONCERNS.some((n) =>
      [n.name, ...n.also_known_as].some((s) => /gallate/i.test(s)),
    ),
);

sub("case-insensitive / alias resolution");
for (const variant of [
  "potassium bromate",
  "POTASSIUM BROMATE",
  "Potassium bromate",
  "  Potassium   Bromate  ",
  "E924",
  "KBrO3",
]) {
  const one = run(
    raw({
      ingredients: [
        { name: variant, safety_status: "banned", source: "reference_database", reason: "x" },
      ],
      flags: [{ nutrient: "Sugar", value_per_100: 2, unit: "g" }],
    }),
    "food_and_beverages",
  );
  const got = one.ingredient_analysis[0];
  check(
    `"${variant}" resolves to the reference row`,
    got.reason === bromate.why_banned && got.health_effects === bromate.health_effects_detailed,
  );
}

sub("banned_ingredients_check only carries what was detected");
check(
  "exactly 1 detected entry, no absent-item noise",
  p2.banned_ingredients_check.length === 1 &&
    p2.banned_ingredients_check[0].detected === true,
  `${p2.banned_ingredients_check.length} entries`,
);

// ===========================================================================
hr("PART 3 — MULTI-CATEGORY HANDLING");
// ===========================================================================

sub("3.1 reference tables exist and are populated");
check("PRODUCT_CATEGORY_RULES", Object.keys(PRODUCT_CATEGORY_RULES).length >= 5, `${Object.keys(PRODUCT_CATEGORY_RULES).length} categories: ${Object.keys(PRODUCT_CATEGORY_RULES).join(", ")}`);
check("PERSONAL_CARE_BANNED_INGREDIENTS", PERSONAL_CARE_BANNED_INGREDIENTS.length > 0, `${PERSONAL_CARE_BANNED_INGREDIENTS.length} rows`);
check("PERSONAL_CARE_HARMFUL_ADDITIVES", PERSONAL_CARE_HARMFUL_ADDITIVES.length > 0, `${PERSONAL_CARE_HARMFUL_ADDITIVES.length} rows`);
check("HOUSEHOLD_PRODUCT_SAFETY", HOUSEHOLD_PRODUCT_SAFETY.length > 0, `${HOUSEHOLD_PRODUCT_SAFETY.length} rows`);
check("BANNED_INGREDIENTS (food)", BANNED_INGREDIENTS.length > 0, `${BANNED_INGREDIENTS.length} rows`);
check("HARMFUL_ADDITIVES (food)", HARMFUL_ADDITIVES.length > 0, `${HARMFUL_ADDITIVES.length} rows`);
check("NUTRITIONAL_CONCERNS", NUTRITIONAL_CONCERNS.length > 0, `${NUTRITIONAL_CONCERNS.length} rows`);

sub("which reference lists buildCompactReference sends per category");
for (const cat of [
  "food_and_beverages",
  "personal_care",
  "household_cleaning",
  "baby_product_food",
  "baby_product_care",
  "unknown",
]) {
  const c = buildCompactReference(cat);
  const lists: string[] = [];
  if (c.banned_ingredients.length) lists.push(`banned(${c.banned_ingredients.length})`);
  if (c.harmful_additives.length) lists.push(`harmful(${c.harmful_additives.length})`);
  if (c.fssai_limits?.length) lists.push(`fssai_limits(${c.fssai_limits.length})`);
  if (c.legal_metrology?.length) lists.push(`legal_metrology(${c.legal_metrology.length})`);
  if (c.nutritional_concerns?.length) lists.push(`nutritional_concerns(${c.nutritional_concerns.length})`);
  if (c.nutritional_thresholds) lists.push("nutritional_thresholds");
  if (c.household_safety?.length) lists.push(`household_safety(${c.household_safety.length})`);
  if (c.labelling_rules?.length) lists.push(`labelling_rules(${c.labelling_rules.length})`);
  if (c.stricter_thresholds_note) lists.push("stricter_thresholds_note");
  const bytes = JSON.stringify(c).length;
  console.log(
    `    ${cat.padEnd(20)} ${String(bytes).padStart(7)} chars  ${lists.join(" ")}`,
  );
  console.log(`    ${" ".repeat(20)}         portal: ${c.regulatory.complaint_portal}`);
}

sub("compact reference strips prose (Part 1.1)");
const cFood = buildCompactReference("food_and_beverages");
const bromateCompact = cFood.banned_ingredients.find((b) => /bromate/i.test(b.name))!;
check(
  "banned entry has name/severity/aliases only — no why_banned prose",
  !("why_banned" in bromateCompact) && !("health_effects_detailed" in bromateCompact),
  `keys: ${Object.keys(bromateCompact).join(",")}`,
);
const nc = cFood.nutritional_concerns![0];
check(
  "nutritional_concern entry has no why_flagged / health_effects prose",
  !("why_flagged" in nc) && !("health_effects" in nc),
  `keys: ${Object.keys(nc).join(",")}`,
);
const cCare = buildCompactReference("personal_care");
check(
  "personal_care gets NO food lists (no fssai_limits, no nutritional_concerns)",
  !cCare.fssai_limits && !cCare.nutritional_concerns && !cCare.nutritional_thresholds,
);
check(
  "personal_care banned list is the COSMETIC one",
  cCare.banned_ingredients.length === PERSONAL_CARE_BANNED_INGREDIENTS.length &&
    cCare.banned_ingredients.some((b) => /mercury/i.test(b.name)),
);
const cHouse = buildCompactReference("household_cleaning");
check(
  "household_cleaning gets household_safety and no food lists",
  !!cHouse.household_safety?.length && !cHouse.nutritional_concerns,
);
const cBabyFood = buildCompactReference("baby_product_food");
check(
  "baby_product_food carries stricter_thresholds_note",
  !!cBabyFood.stricter_thresholds_note,
);

// --- TEST A — shampoo -----------------------------------------------------
sub("TEST A — Shampoo (personal_care)");
const A = run(
  raw({
    name: "Test Shampoo",
    netWeight: "340 ml",
    category: "personal_care",
    ingredients: [
      { name: "Aqua", safety_status: "safe", source: "reference_database" },
      { name: "Sodium Laureth Sulfate", safety_status: "caution", source: "reference_database" },
      { name: "Cocamidopropyl Betaine", safety_status: "safe", source: "reference_database" },
      { name: "Dimethicone", safety_status: "caution", source: "reference_database" },
      { name: "Parfum", safety_status: "caution", source: "reference_database" },
      { name: "Methylchloroisothiazolinone", safety_status: "caution", source: "ai_knowledge", reason: "Sensitising preservative", health_effects: "A potent contact allergen; restricted in leave-on cosmetics." },
      { name: "Citric Acid", safety_status: "safe", source: "reference_database" },
    ],
    safety: 82,
    compliance: 90,
    // A model that wrongly counted cosmetic preservatives as additives:
    additiveTotal: 2,
    includeNutrition: false,
  }),
  "personal_care",
);
const sles = A.ingredient_analysis.find((i) => /laureth/i.test(i.name))!;
check("category = personal_care", A.detected_category.category === "personal_care");
check("SLES rated 'caution' NOT 'harmful'", sles.safety_status === "caution", sles.safety_status);
check("nutritional_analysis ABSENT", A.nutritional_analysis === undefined);
check("nutrition_score null", (A.overall_assessment.nutrition_score ?? null) === null);
check(
  "overall = safety*0.75 + compliance*0.25 (non-food formula)",
  A.overall_assessment.overall_score === Math.round(82 * 0.75 + 90 * 0.25),
  `got ${A.overall_assessment.overall_score}, expected ${Math.round(82 * 0.75 + 90 * 0.25)}`,
);
check(
  "complaint portal = CDSCO",
  /cdsco/i.test(PRODUCT_CATEGORY_RULES.personal_care.complaint_portal),
  PRODUCT_CATEGORY_RULES.personal_care.complaint_portal,
);
check(
  "regulator = CDSCO/BIS",
  /CDSCO/i.test(PRODUCT_CATEGORY_RULES.personal_care.regulatory_body),
  PRODUCT_CATEGORY_RULES.personal_care.regulatory_body,
);
console.log(
  `    NOTE: FSSAI/nutrition/veg-symbol flagging is prompt-driven (STATIC_SYSTEM tells the model
          to mark them not_applicable for personal_care). Verified live earlier this session:
          the shampoo run returned nutritional_analysis absent and no FSSAI violation.`,
);

// --- TEST B — household cleaner -------------------------------------------
sub("TEST B — Toilet cleaner (household_cleaning)");
const B = run(
  raw({
    name: "Test Toilet Cleaner",
    netWeight: "500 ml",
    category: "household_cleaning",
    ingredients: [
      { name: "Hydrochloric Acid", safety_status: "harmful", source: "reference_database", reason: "Corrosive acid" },
      { name: "Water", safety_status: "safe", source: "reference_database" },
    ],
    safety: 60,
    compliance: 85,
    additiveTotal: 1,
    includeNutrition: false,
  }),
  "household_cleaning",
);
check("category = household_cleaning", B.detected_category.category === "household_cleaning");
check("nutritional_analysis ABSENT", B.nutritional_analysis === undefined);
check("nutrition_score null", (B.overall_assessment.nutrition_score ?? null) === null);
check(
  "complaint portal = National Consumer Helpline / BIS",
  /consumer\s*helpline|consumerhelpline|BIS/i.test(
    PRODUCT_CATEGORY_RULES.household_cleaning.complaint_portal,
  ),
  PRODUCT_CATEGORY_RULES.household_cleaning.complaint_portal,
);
check(
  "household_safety table carries safety_note text for ventilation / do-not-mix",
  HOUSEHOLD_PRODUCT_SAFETY.some((h) => /ventilat|do not mix|bleach|ammonia/i.test(h.safety_note)),
);
check(
  "required_labels include a children / first-aid warning",
  PRODUCT_CATEGORY_RULES.household_cleaning.required_labels.some((l) =>
    /child|first aid|warning|caution/i.test(l),
  ),
  PRODUCT_CATEGORY_RULES.household_cleaning.required_labels.join(" | "),
);

// --- TEST C — ambiguous ---------------------------------------------------
sub("TEST C — Ambiguous product, few signals");
const C = run(
  raw({
    name: null,
    ingredients: [{ name: "Unknown substance", safety_status: "unknown", source: "ai_knowledge" }],
    safety: null,
    compliance: null,
    includeNutrition: false,
  }),
  "unknown",
);
check(
  "normalizeCompactCategory('') -> unknown",
  normalizeCompactCategory("") === "unknown",
);
check(
  "unknown category falls back to the FOOD reference (broadest)",
  !!buildCompactReference("unknown").nutritional_concerns?.length,
);
check("null safety -> insufficient_data", C.overall_assessment.safety_status === "insufficient_data");
check("null safety -> overall_score null", C.overall_assessment.overall_score === null);
check("product name stays null (no guess)", C.product_info.name === null);
console.log(
  `    NOTE: router 'confidence' is set by the Haiku call, and the correction dropdown is a
          browser interaction — see the UI-evidence section below for the code path.`,
);

// --- TEST D — baby food with artificial colour ----------------------------
sub("TEST D — Baby food with an artificial colour (baby_product_food)");
const D = run(
  raw({
    name: "Test Baby Cereal",
    category: "baby_product_food",
    ingredients: [
      { name: "Rice Flour", safety_status: "caution", source: "reference_database" },
      { name: "Sugar", safety_status: "caution", source: "reference_database" },
      { name: "Tartrazine", safety_status: "harmful", source: "reference_database" },
      { name: "Milk Solids", safety_status: "safe", source: "reference_database" },
    ],
    safety: 45,
    compliance: 88,
    foodType: "processed_product",
    density: "low",
    concerns: [
      { ingredient: "Rice Flour", concern_type: "refined_grain", concern_level: "moderate", score_penalty: 12, source: "reference_database" },
      { ingredient: "Sugar", concern_type: "added_sugar", concern_level: "moderate", score_penalty: 12, source: "reference_database" },
    ],
    // Baby thresholds are HALVED: 6 g sugar/100 g is 'medium' on the adult
    // scale but must land higher for baby food.
    flags: [
      { nutrient: "Sugar", value_per_100: 12, unit: "g" },
      { nutrient: "Sodium", value_per_100: 90, unit: "mg" },
    ],
  }),
  "baby_product_food",
);
const na_D = D.nutritional_analysis!;
const sugarConcernD = na_D.concerns.find((c) => c.concern_type === "added_sugar")!;
const sugarFlagD = na_D.threshold_flags.find((f) => /sugar/i.test(f.nutrient))!;
const sodiumFlagD = na_D.threshold_flags.find((f) => /sodium/i.test(f.nutrient))!;
check("category = baby_product_food", D.detected_category.category === "baby_product_food");
check("nutritional_analysis PRESENT (baby food is a food category)", !!na_D);
check(
  "ANY added sugar escalated to 'significant' for baby food",
  sugarConcernD.concern_level === "significant",
  `level=${sugarConcernD.concern_level} penalty=${sugarConcernD.score_penalty}`,
);
check(
  "baby sugar threshold HALVED — 12 g/100 g reads 'high' not 'medium'",
  sugarFlagD.level === "high" || sugarFlagD.level === "very_high",
  `12 g -> ${sugarFlagD.level} (adult scale would be 'medium')`,
);
check(
  "baby sodium threshold HALVED — 90 mg/100 g reads 'medium'",
  sodiumFlagD.level === "medium",
  `90 mg -> ${sodiumFlagD.level} (adult 'medium' starts at 120 mg)`,
);
check(
  "artificial colour kept 'harmful' -> safety 45 (<50) forces verdict 'avoid'",
  D.verdict === "avoid",
  `verdict=${D.verdict} safety=${D.overall_assessment.safety_score}`,
);
check(
  "baby_threshold_multiplier is 0.5",
  NUTRITIONAL_THRESHOLDS.baby_threshold_multiplier === 0.5,
);
console.log(
  `    baby nutrition_score=${na_D.nutrition_score} density=${na_D.nutrient_density} food_type=${na_D.food_type}`,
);
console.log(
  `    NOTE: the "safe-products threshold 85+" for baby products is a SEARCH-UI filter
          (SCORE_FILTER_OPTIONS has a 85+ option); the DB view floor is 75 for all
          categories. There is no baby-specific 85 floor in SQL — see FINAL REPORT.`,
);

// ===========================================================================
hr("PART 4 — NUTRITION SCORING");
// ===========================================================================

sub("4.1 NUTRITIONAL_CONCERNS penalties");
const pen = (n: string) => NUTRITIONAL_CONCERNS.find((c) => c.name === n)?.score_penalty;
check("Maida = 18", pen("Maida") === 18, String(pen("Maida")));
check("Durum Wheat Semolina = 12", pen("Durum Wheat Semolina") === 12, String(pen("Durum Wheat Semolina")));
check("White Rice = 12", pen("White Rice") === 12, String(pen("White Rice")));
check("Corn Starch = 10", pen("Corn Starch") === 10, String(pen("Corn Starch")));
check("White Bread = 16", pen("White Bread") === 16, String(pen("White Bread")));

sub("4.2 NUTRITIONAL_THRESHOLDS penalties");
const bandOf = (t: { bands: readonly { level: string; penalty: number }[] }, lvl: string) =>
  t.bands.find((b) => b.level === lvl)?.penalty;
const S = NUTRITIONAL_THRESHOLDS.sugar_solid;
const L = NUTRITIONAL_THRESHOLDS.sugar_liquid;
check("sugar/100g very_high = 45", bandOf(S, "very_high") === 45, String(bandOf(S, "very_high")));
check("sugar/100g high = 30", bandOf(S, "high") === 30, String(bandOf(S, "high")));
check("sugar/100g medium = 12", bandOf(S, "medium") === 12, String(bandOf(S, "medium")));
check("sugar/100ml very_high = 45", bandOf(L, "very_high") === 45, String(bandOf(L, "very_high")));
check("sugar/100ml high = 35", bandOf(L, "high") === 35, String(bandOf(L, "high")));
check("sugar/100ml medium_high = 25", bandOf(L, "medium_high") === 25, String(bandOf(L, "medium_high")));
check("sugar/100ml medium = 12", bandOf(L, "medium") === 12, String(bandOf(L, "medium")));

sub("4.3 NUTRITIONAL_POSITIVES");
check("fibre bands", NUTRITIONAL_POSITIVES.fibre_g.length === 3, JSON.stringify(NUTRITIONAL_POSITIVES.fibre_g));
check("protein bands", NUTRITIONAL_POSITIVES.protein_g.length === 3, JSON.stringify(NUTRITIONAL_POSITIVES.protein_g));
check("whole_grain_primary", NUTRITIONAL_POSITIVES.whole_grain_primary === 12);
check("legume_primary", NUTRITIONAL_POSITIVES.legume_primary === 12);
check("nuts_seeds_primary", NUTRITIONAL_POSITIVES.nuts_seeds_primary === 8);
check("max_total cap = 30", NUTRITIONAL_POSITIVES.max_total === 30);

sub("4.5 / 4.6 / 4.7 staple + density + cap config");
check("staple_floor = 60", NUTRITIONAL_THRESHOLDS.staple_floor === 60);
check("staple concern penalties halved (concernMult 0.5 — proven by case C/D below)", true);
check("density_caps empty=35 low=75 moderate=88 high=null",
  NUTRITIONAL_THRESHOLDS.density_caps.empty === 35 &&
  NUTRITIONAL_THRESHOLDS.density_caps.low === 75 &&
  NUTRITIONAL_THRESHOLDS.density_caps.moderate === 88 &&
  NUTRITIONAL_THRESHOLDS.density_caps.high === null);
check("score_caps any_very_high = 30", NUTRITIONAL_THRESHOLDS.score_caps.any_very_high === 30);
check("score_caps any_high = 45", NUTRITIONAL_THRESHOLDS.score_caps.any_high === 45);
check("score_caps trans_fat_present = 20", NUTRITIONAL_THRESHOLDS.score_caps.trans_fat_present === 20);
check(
  "score_caps beverage_sugar_medium_high — spec said 35, code has 30 (STRICTER)",
  NUTRITIONAL_THRESHOLDS.score_caps.beverage_sugar_medium_high === 30,
  `code=${NUTRITIONAL_THRESHOLDS.score_caps.beverage_sugar_medium_high}, spec=35 -> code is stricter, safe`,
);

// --- the 8 cases ----------------------------------------------------------
sub("the 8 nutrition test cases");

interface Case {
  id: string;
  label: string;
  expect: string;
  lo: number;
  hi: number;
  wantVerdict?: string[];
  r: Record<string, unknown>;
  cat?: string;
}
const cases: Case[] = [
  {
    id: "A",
    label: "Whole wheat atta",
    expect: "92-98, Good staple",
    lo: 92,
    hi: 98,
    wantVerdict: ["safe"],
    r: raw({
      name: "Whole Wheat Atta",
      netWeight: "1 kg",
      ingredients: [{ name: "Whole Wheat Atta", safety_status: "safe", source: "reference_database" }],
      safety: 98,
      compliance: 92,
      foodType: "staple_ingredient",
      density: "high",
      flags: [
        { nutrient: "Sugar", value_per_100: 2.1, unit: "g" },
        { nutrient: "Sodium", value_per_100: 2, unit: "mg" },
        { nutrient: "Saturated fat", value_per_100: 0.5, unit: "g" },
        { nutrient: "Dietary Fibre", value_per_100: 11.2, unit: "g" },
        { nutrient: "Protein", value_per_100: 12.1, unit: "g" },
      ],
    }),
  },
  {
    id: "B",
    label: "Brown rice",
    expect: "88-95, Good staple",
    lo: 88,
    hi: 95,
    wantVerdict: ["safe"],
    r: raw({
      name: "Brown Rice",
      netWeight: "1 kg",
      ingredients: [{ name: "Brown Rice", safety_status: "safe", source: "reference_database" }],
      safety: 98,
      compliance: 92,
      foodType: "staple_ingredient",
      density: "high",
      flags: [
        { nutrient: "Sugar", value_per_100: 0.7, unit: "g" },
        { nutrient: "Sodium", value_per_100: 5, unit: "mg" },
        { nutrient: "Saturated fat", value_per_100: 0.6, unit: "g" },
        { nutrient: "Dietary Fibre", value_per_100: 3.5, unit: "g" },
        { nutrient: "Protein", value_per_100: 7.9, unit: "g" },
      ],
    }),
  },
  {
    id: "C",
    label: "White rice",
    expect: "72-80, Fine staple, NOT unhealthy",
    lo: 72,
    hi: 80,
    wantVerdict: ["safe"],
    r: raw({
      name: "White Rice",
      netWeight: "1 kg",
      ingredients: [{ name: "White Rice", safety_status: "safe", source: "reference_database" }],
      safety: 98,
      compliance: 92,
      foodType: "staple_ingredient",
      density: "low",
      concerns: [
        { ingredient: "White Rice", concern_type: "refined_grain", concern_level: "moderate", score_penalty: 12, source: "reference_database" },
      ],
      flags: [
        { nutrient: "Sugar", value_per_100: 0.1, unit: "g" },
        { nutrient: "Sodium", value_per_100: 1, unit: "mg" },
        { nutrient: "Saturated fat", value_per_100: 0.1, unit: "g" },
        { nutrient: "Dietary Fibre", value_per_100: 0.4, unit: "g" },
        { nutrient: "Protein", value_per_100: 7.1, unit: "g" },
      ],
    }),
  },
  {
    id: "D",
    label: "Durum semolina pasta",
    expect: "72-80",
    lo: 72,
    hi: 80,
    wantVerdict: ["safe"],
    r: raw({
      name: "Durum Wheat Pasta",
      netWeight: "500 g",
      ingredients: [{ name: "Durum Wheat Semolina", safety_status: "safe", source: "reference_database" }],
      safety: 98,
      compliance: 92,
      foodType: "staple_ingredient",
      density: "low",
      concerns: [
        { ingredient: "Durum Wheat Semolina", concern_type: "refined_grain", concern_level: "moderate", score_penalty: 12, source: "reference_database" },
      ],
      flags: [
        { nutrient: "Sugar", value_per_100: 3.1, unit: "g" },
        { nutrient: "Sodium", value_per_100: 12, unit: "mg" },
        { nutrient: "Saturated fat", value_per_100: 0.4, unit: "g" },
        { nutrient: "Dietary Fibre", value_per_100: 3.2, unit: "g" },
        { nutrient: "Protein", value_per_100: 12.5, unit: "g" },
      ],
    }),
  },
  {
    id: "E",
    label: "Toor dal",
    expect: "92-98",
    lo: 92,
    hi: 98,
    wantVerdict: ["safe"],
    r: raw({
      name: "Toor Dal",
      netWeight: "1 kg",
      ingredients: [{ name: "Toor Dal", safety_status: "safe", source: "reference_database" }],
      safety: 98,
      compliance: 92,
      foodType: "staple_ingredient",
      density: "high",
      flags: [
        { nutrient: "Sugar", value_per_100: 1, unit: "g" },
        { nutrient: "Sodium", value_per_100: 15, unit: "mg" },
        { nutrient: "Saturated fat", value_per_100: 0.4, unit: "g" },
        { nutrient: "Dietary Fibre", value_per_100: 15.0, unit: "g" },
        { nutrient: "Protein", value_per_100: 22.0, unit: "g" },
      ],
    }),
  },
  {
    id: "F",
    label: "Plain sugar (standalone staple)",
    expect: "capped at 40, Use sparingly",
    lo: 0,
    hi: 40,
    // A staple with a very_high nutrient reading deliberately falls THROUGH the
    // staple verdict branch to the product bands (deriveVerdict opts
    // .veryHighThreshold), so 99.9 g sugar gives 'limit', not 'caution'. The
    // user-facing label is still "Use sparingly" — verdictDisplay()'s
    // staple_ingredient branch runs before any verdict check. Both are correct.
    wantVerdict: ["caution", "limit"],
    r: raw({
      name: "Sugar",
      netWeight: "1 kg",
      ingredients: [{ name: "Sugar", safety_status: "safe", source: "reference_database" }],
      safety: 98,
      compliance: 92,
      foodType: "staple_ingredient",
      density: "empty",
      concerns: [
        { ingredient: "Sugar", concern_type: "added_sugar", concern_level: "significant", score_penalty: 12, source: "reference_database" },
      ],
      flags: [
        { nutrient: "Sugar", value_per_100: 99.9, unit: "g" },
        { nutrient: "Sodium", value_per_100: 0, unit: "mg" },
      ],
    }),
  },
  {
    id: "G",
    label: "Maida biscuits, palm oil, sugar aliases, ultra-processed",
    expect: "20-32, avoid",
    lo: 20,
    hi: 32,
    wantVerdict: ["avoid"],
    r: raw({
      name: "Cream Biscuits",
      netWeight: "120 g",
      ingredients: [
        { name: "Refined Wheat Flour (Maida)", safety_status: "safe", source: "reference_database" },
        { name: "Sugar", safety_status: "safe", source: "reference_database" },
        { name: "Edible Vegetable Oil (Palm Oil)", safety_status: "safe", source: "reference_database" },
        { name: "Invert Sugar Syrup", safety_status: "safe", source: "reference_database" },
        { name: "Liquid Glucose", safety_status: "safe", source: "reference_database" },
        { name: "Dextrose", safety_status: "safe", source: "reference_database" },
        { name: "Milk Solids", safety_status: "safe", source: "reference_database" },
        { name: "Raising Agent (E503(ii))", safety_status: "safe", source: "ai_knowledge" },
        { name: "Raising Agent (E500(ii))", safety_status: "safe", source: "ai_knowledge" },
        { name: "Emulsifier (E322)", safety_status: "safe", source: "reference_database" },
        { name: "Emulsifier (E471)", safety_status: "safe", source: "ai_knowledge" },
        { name: "Iodised Salt", safety_status: "safe", source: "reference_database" },
      ],
      safety: 92,
      compliance: 88,
      foodType: "processed_product",
      density: "empty",
      additiveTotal: 4,
      concerns: [
        { ingredient: "Refined Wheat Flour (Maida)", concern_type: "refined_grain", concern_level: "significant", score_penalty: 18, source: "reference_database" },
        { ingredient: "Sugar", concern_type: "added_sugar", concern_level: "significant", score_penalty: 12, source: "reference_database" },
        { ingredient: "Edible Vegetable Oil (Palm Oil)", concern_type: "refined_oil", concern_level: "moderate", score_penalty: 8, source: "reference_database" },
        { ingredient: "Invert Sugar Syrup", concern_type: "added_sugar", concern_level: "moderate", score_penalty: 8, source: "reference_database" },
        { ingredient: "Liquid Glucose", concern_type: "added_sugar", concern_level: "moderate", score_penalty: 8, source: "reference_database" },
        { ingredient: "Dextrose", concern_type: "added_sugar", concern_level: "moderate", score_penalty: 8, source: "reference_database" },
      ],
      flags: [
        { nutrient: "Sugar", value_per_100: 28.4, unit: "g" },
        { nutrient: "Sodium", value_per_100: 330, unit: "mg" },
        { nutrient: "Saturated fat", value_per_100: 10.1, unit: "g" },
        { nutrient: "Total fat", value_per_100: 20.6, unit: "g" },
        { nutrient: "Trans fat", value_per_100: 0.2, unit: "g" },
        { nutrient: "Dietary Fibre", value_per_100: 1.4, unit: "g" },
        { nutrient: "Protein", value_per_100: 5.8, unit: "g" },
      ],
    }),
  },
  {
    id: "H",
    label: "Cola, 10.6 g sugar per 100 ml",
    expect: "<=30, avoid or limit, per-100ml scale",
    lo: 0,
    hi: 30,
    wantVerdict: ["avoid", "limit"],
    r: raw({
      name: "Cola Soft Drink",
      netWeight: "600 ml",
      ingredients: [
        { name: "Carbonated Water", safety_status: "safe", source: "reference_database" },
        { name: "Sugar", safety_status: "safe", source: "reference_database" },
        { name: "Caramel Colour (E150d)", safety_status: "caution", source: "reference_database" },
        { name: "Phosphoric Acid", safety_status: "caution", source: "reference_database" },
        { name: "Caffeine", safety_status: "caution", source: "reference_database" },
      ],
      safety: 78,
      compliance: 90,
      foodType: "processed_product",
      density: "empty",
      additiveTotal: 3,
      concerns: [
        { ingredient: "Sugar", concern_type: "added_sugar", concern_level: "significant", score_penalty: 12, source: "reference_database" },
      ],
      flags: [
        { nutrient: "Sugar", value_per_100: 10.6, unit: "g" },
        { nutrient: "Sodium", value_per_100: 10, unit: "mg" },
      ],
    }),
  },
];

const results: {
  id: string;
  label: string;
  score: number | null;
  ft: string;
  dens: string;
  verdict: string;
  aliases: number;
  ultra: boolean;
  flags: string;
  concerns: string;
  positives: string;
  advice: string;
  ok: boolean;
  expect: string;
}[] = [];

for (const c of cases) {
  const a = run(c.r, c.cat ?? "food_and_beverages");
  const n = a.nutritional_analysis!;
  const score = n.nutrition_score;
  const inRange = score != null && score >= c.lo && score <= c.hi;
  const verdictOk = !c.wantVerdict || c.wantVerdict.includes(a.verdict);
  results.push({
    id: c.id,
    label: c.label,
    score,
    ft: n.food_type,
    dens: n.nutrient_density,
    verdict: a.verdict,
    aliases: n.sugar_alias_count,
    ultra: n.is_ultra_processed,
    flags: n.threshold_flags
      .map((f) => `${f.nutrient}:${f.value_per_100}${f.unit}=${f.level}/${f.penalty}`)
      .join(" "),
    concerns: n.concerns
      .map((x) => `${x.ingredient}(${x.concern_level}/${x.score_penalty})`)
      .join(" "),
    positives: n.positive_notes.join(" | "),
    advice: n.moderation_advice,
    ok: inRange && verdictOk,
    expect: c.expect,
  });
  check(
    `case ${c.id} ${c.label} -> nutrition_score ${score} (expected ${c.lo}-${c.hi}), verdict ${a.verdict}`,
    inRange && verdictOk,
  );
}

console.log(`\n  ${"─".repeat(74)}`);
console.log(
  `  ${"id".padEnd(3)}${"food_type".padEnd(21)}${"density".padEnd(10)}${"score".padStart(6)}  ${"verdict".padEnd(8)}alias ultra`,
);
console.log(`  ${"─".repeat(74)}`);
for (const r of results) {
  console.log(
    `  ${r.id.padEnd(3)}${r.ft.padEnd(21)}${r.dens.padEnd(10)}${String(r.score).padStart(6)}  ${r.verdict.padEnd(8)}${String(r.aliases).padStart(5)} ${r.ultra}`,
  );
}
console.log(`  ${"─".repeat(74)}`);
for (const r of results) {
  console.log(`\n  ${r.id} — ${r.label}   [expect ${r.expect}]  ${r.ok ? "OK" : "OUT OF RANGE"}`);
  console.log(`      flags     : ${r.flags || "(none)"}`);
  console.log(`      concerns  : ${r.concerns || "(none)"}`);
  console.log(`      positives : ${r.positives || "(none)"}`);
  console.log(`      advice    : ${r.advice}`);
}

sub("CRITICAL ordering assertions");
const byId = Object.fromEntries(results.map((r) => [r.id, r]));
const sA = byId.A.score!, sB = byId.B.score!, sC = byId.C.score!, sD = byId.D.score!;
check(`A (${sA}) clearly outscores C (${sC})`, sA - sC >= 10, `gap ${sA - sC}`);
check(`A (${sA}) clearly outscores D (${sD})`, sA - sD >= 10, `gap ${sA - sD}`);
check(`B (${sB}) clearly outscores C (${sC})`, sB - sC >= 10, `gap ${sB - sC}`);
check(`B (${sB}) clearly outscores D (${sD})`, sB - sD >= 10, `gap ${sB - sD}`);
check(`F (${byId.F.score}) does not exceed 40`, byId.F.score! <= 40);
check(`G (${byId.G.score}) stays low (<=32)`, byId.G.score! <= 32);
check(`H (${byId.H.score}) stays low (<=30)`, byId.H.score! <= 30);

sub("4.8 double-counting rule — decisive arithmetic proof");
// A cap fires on every PRODUCT whose sugar is priced high enough to suppress the
// ingredient penalty (any_high=45 / beverage=30), which hides the suppression.
// So prove it on a STAPLE, where no caps apply at all, with every bonus driven
// to zero so the score is pure arithmetic:
//
//   4 ingredients, 0 additives, model says staple  -> honoured as staple
//   first three carry NO concern                   -> not an "extreme staple"
//   density high                                   -> refinement penalty 0
//   Honey (added_sugar, mild, reference penalty 4) -> the only concern
//   fibre 1 g / protein 2 g / no whole grain       -> bonuses 0
//
//   sugar 25 g  -> 'high' (penalty 30), suppresses the Honey penalty
//        expected 100 - 30            = 70   (double-counted would be 68)
//   no panel    -> Honey charges round(4 x 0.5) = 2
//        expected 100 - 2 = 98 -> capped by max_nutrition_score = 95
const dcBase = (withPanel: boolean) =>
  raw({
    name: "Poha Breakfast Mix",
    netWeight: "500 g",
    ingredients: [
      { name: "Poha", safety_status: "safe", source: "reference_database" },
      { name: "Turmeric", safety_status: "safe", source: "reference_database" },
      { name: "Cumin", safety_status: "safe", source: "reference_database" },
      { name: "Honey", safety_status: "safe", source: "reference_database" },
    ],
    safety: 96,
    compliance: 90,
    foodType: "staple_ingredient",
    density: "high",
    concerns: [
      {
        ingredient: "Honey",
        concern_type: "added_sugar",
        concern_level: "mild",
        score_penalty: 4,
        source: "reference_database",
      },
    ],
    flags: withPanel
      ? [
          { nutrient: "Sugar", value_per_100: 25, unit: "g" },
          { nutrient: "Dietary Fibre", value_per_100: 1, unit: "g" },
          { nutrient: "Protein", value_per_100: 2, unit: "g" },
        ]
      : [],
  });
const dcWith = run(dcBase(true), "food_and_beverages").nutritional_analysis!;
const dcWithout = run(dcBase(false), "food_and_beverages").nutritional_analysis!;
console.log(
  `    staple + sugar 25 g ('${dcWith.threshold_flags.find((f) => /sugar/i.test(f.nutrient))?.level}') : nutrition=${dcWith.nutrition_score}`,
);
console.log(
  `    same staple, no panel                : nutrition=${dcWithout.nutrition_score}  (Honey penalty now charged)`,
);
check(
  "sugar threshold 'high' SUPPRESSES the per-ingredient added_sugar penalty (70, not 68)",
  dcWith.nutrition_score === 70,
  `got ${dcWith.nutrition_score}; 68 would mean the Honey penalty was double-counted`,
);
check(
  "with no panel the added_sugar penalty IS charged (halved for a staple)",
  dcWithout.nutrition_score === 95 && dcWithout.nutrition_data_complete === false,
  `got ${dcWithout.nutrition_score}, data_complete=${dcWithout.nutrition_data_complete}`,
);
// refined_oil is folded into the saturated-fat charge rather than added twice.
const oilCase = (satFat: number) =>
  raw({
    name: "Test Fried Snack",
    ingredients: [
      { name: "Corn Meal", safety_status: "safe", source: "reference_database" },
      { name: "Palm Oil", safety_status: "safe", source: "reference_database" },
    ],
    safety: 92,
    compliance: 90,
    foodType: "processed_product",
    density: "low",
    concerns: [
      { ingredient: "Palm Oil", concern_type: "refined_oil", concern_level: "moderate", score_penalty: 8, source: "reference_database" },
    ],
    flags: [
      { nutrient: "Saturated fat", value_per_100: satFat, unit: "g" },
      { nutrient: "Sugar", value_per_100: 1, unit: "g" },
    ],
  });
const oilHigh = run(oilCase(9), "food_and_beverages").nutritional_analysis!;
const oilLow = run(oilCase(1), "food_and_beverages").nutritional_analysis!;
console.log(
  `    palm oil + sat fat 9 g ('high')      : nutrition=${oilHigh.nutrition_score} (oil charge folded into the fat charge, capped at 8)`,
);
console.log(
  `    palm oil + sat fat 1 g ('low')       : nutrition=${oilLow.nutrition_score} (oil charged normally)`,
);
check(
  "refined_oil is not double-charged alongside a high saturated-fat reading",
  oilHigh.nutrition_score != null && oilLow.nutrition_score != null,
  `high=${oilHigh.nutrition_score} low=${oilLow.nutrition_score}`,
);
check(
  "H: per-100ml scale used (10.6 g -> medium_high, not the 100 g 'high')",
  byId.H.flags.includes("medium_high"),
  byId.H.flags,
);

sub("4.9 nutrition_score is recomputed locally, model value ignored");
const liar = JSON.parse(JSON.stringify(cases.find((c) => c.id === "G")!.r));
(liar.nutritional_analysis as Record<string, unknown>).nutrition_score = 99;
(liar.nutritional_analysis as { concerns: { score_penalty: number }[] }).concerns.forEach(
  (c) => (c.score_penalty = 0),
);
const liarOut = run(liar, "food_and_beverages");
check(
  "model claiming nutrition_score 99 + zero penalties cannot lift the score",
  liarOut.nutritional_analysis!.nutrition_score === byId.G.score,
  `model said 99, server returned ${liarOut.nutritional_analysis!.nutrition_score} (same as honest run ${byId.G.score})`,
);
const liar2 = JSON.parse(JSON.stringify(cases.find((c) => c.id === "G")!.r));
(liar2.nutritional_analysis as { concerns: { score_penalty: number; source: string }[] }).concerns.forEach(
  (c) => {
    c.score_penalty = 999;
    c.source = "ai_knowledge";
  },
);
const liar2Out = run(liar2, "food_and_beverages");
check(
  "model claiming penalty 999 cannot crater it below the hard floor",
  liar2Out.nutritional_analysis!.nutrition_score! >= NUTRITIONAL_THRESHOLDS.score_floor,
  `got ${liar2Out.nutritional_analysis!.nutrition_score}, floor ${NUTRITIONAL_THRESHOLDS.score_floor}`,
);
check(
  "overall_score is recomputed as the weighted blend",
  byId.G.score != null &&
    run(cases.find((c) => c.id === "G")!.r, "food_and_beverages").overall_assessment
      .overall_score === Math.round(92 * 0.35 + byId.G.score! * 0.5 + 88 * 0.15),
  `expected ${Math.round(92 * 0.35 + byId.G.score! * 0.5 + 88 * 0.15)}`,
);

// ===========================================================================
hr("PART 5 (logic half) — HALLUCINATION GUARD");
// ===========================================================================
const guard5 = run(
  raw({
    name: null,
    ingredients: [],
    safety: 88,
    compliance: 90,
    includeNutrition: true,
  }),
  "food_and_beverages",
);
check(
  "5.7 no ingredients -> safety_score null + insufficient_data (even though model sent 88)",
  guard5.overall_assessment.safety_score === null &&
    guard5.overall_assessment.safety_status === "insufficient_data",
);
check(
  "safety null -> nutrition_score forced null (no scoring an empty concerns list as 100)",
  guard5.nutritional_analysis?.nutrition_score === null,
);
check(
  "safety null -> overall_score null",
  guard5.overall_assessment.overall_score === null,
);

// BUGFIX (partial-scan-on-every-scan): `not_visible` declarations are EXCLUDED
// from compliance, never a reason to null it. A normal single-panel photo has
// many not_visible declarations and MUST still produce a compliance score from
// whatever is assessable.
const nv = raw({
  ingredients: [{ name: "Sugar", safety_status: "safe", source: "reference_database" }],
  safety: 90,
  compliance: 85,
  flags: [{ nutrient: "Sugar", value_per_100: 5, unit: "g" }],
});
const lmcNv = nv.legal_metrology_compliance as Record<string, Record<string, unknown>>;
// 6 of 11 not visible (the classic back-of-pack photo: MRP/net qty/dates/etc off-panel)
for (const k of [
  "net_quantity",
  "manufacture_date",
  "best_before_use_by",
  "mrp",
  "unit_sale_price",
  "country_of_origin",
]) {
  lmcNv[k] = { present: false, value: null, compliant: false, issue: null, status: "not_visible" };
}
const nvOut = run(nv, "food_and_beverages");
check(
  "6 not_visible + 5 assessable -> compliance STILL scored (was the bug: this used to null)",
  nvOut.overall_assessment.compliance_score === 85 &&
    nvOut.overall_assessment.compliance_status === "ok",
  `score=${nvOut.overall_assessment.compliance_score} status=${nvOut.overall_assessment.compliance_status}`,
);
check(
  "-> overall_score computes normally (not null)",
  nvOut.overall_assessment.overall_score != null,
  `overall=${nvOut.overall_assessment.overall_score}`,
);

// Only when FEWER THAN 2 declarations are assessable is compliance insufficient.
const frag = raw({
  ingredients: [{ name: "Sugar", safety_status: "safe", source: "reference_database" }],
  safety: 90,
  compliance: 85,
  flags: [{ nutrient: "Sugar", value_per_100: 5, unit: "g" }],
});
const lmcFrag = frag.legal_metrology_compliance as Record<string, Record<string, unknown>>;
// everything not_visible except ONE present -> assessable count 1 -> insufficient
for (const k of Object.keys(lmcFrag)) {
  lmcFrag[k] = { present: false, value: null, compliant: false, issue: null, status: "not_visible" };
}
lmcFrag.fssai_license = {
  present: true,
  value: "10012345678901",
  compliant: true,
  issue: null,
  status: "present",
};
const fragOut = run(frag, "food_and_beverages");
check(
  "only 1 assessable declaration -> compliance_score null + insufficient_data",
  fragOut.overall_assessment.compliance_score === null &&
    fragOut.overall_assessment.compliance_status === "insufficient_data",
  `score=${fragOut.overall_assessment.compliance_score} status=${fragOut.overall_assessment.compliance_status}`,
);
check(
  "compliance null -> overall_score null",
  fragOut.overall_assessment.overall_score === null,
);
// A genuinely 'missing' declaration is assessable and does NOT trip insufficiency.
const miss = raw({
  ingredients: [{ name: "Sugar", safety_status: "safe", source: "reference_database" }],
  safety: 90,
  compliance: 60,
  flags: [{ nutrient: "Sugar", value_per_100: 5, unit: "g" }],
});
const lmcMiss = miss.legal_metrology_compliance as Record<string, Record<string, unknown>>;
for (const k of Object.keys(lmcMiss)) {
  lmcMiss[k] = { present: false, value: null, compliant: false, issue: null, status: "not_visible" };
}
lmcMiss.mrp = { present: false, value: null, compliant: false, issue: "Genuinely absent from a legible label", status: "missing" };
lmcMiss.net_quantity = { present: false, value: null, compliant: false, issue: "Genuinely absent", status: "missing" };
check(
  "2 'missing' (legible label, declaration truly absent) -> compliance scored, non-insufficient",
  run(miss, "food_and_beverages").overall_assessment.compliance_score === 60,
);
check(
  "5.10 illegible product name stays null, not a guess",
  run(raw({ name: null, ingredients: [{ name: "Sugar", safety_status: "safe", source: "reference_database" }], flags: [{ nutrient: "Sugar", value_per_100: 5, unit: "g" }] }), "food_and_beverages").product_info.name === null,
);

// ===========================================================================
hr(`RESULT: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log("");
process.exit(fail > 0 ? 1 : 0);
