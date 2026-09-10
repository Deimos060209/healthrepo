/* eslint-disable no-console */
/**
 * PURE-LOCAL tests of the nutrition scoring engine (no API calls, no cost).
 *
 * Everything that decides a nutrition_score lives in lib/enrich-analysis.ts:
 * the double-counting rules, the sugar-alias rule, the threshold bands, the
 * ultra-processing rule, the 75-point penalty cap, the hard score ceilings
 * (2026 recalibration) and the 25 / 10 floors. The model only IDENTIFIES;
 * these assertions pin the arithmetic.
 *
 * Run: npx tsx scripts/test-nutrition-rules.ts
 */
import {
  enrichAnalysis,
  nutritionPersonalAlerts,
  deriveVerdict,
} from "@/lib/enrich-analysis";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import type { ProductAnalysis } from "@/types/analysis";

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label}${ok ? ` = ${JSON.stringify(got)}` : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  );
};
const ok = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

interface Build {
  category?: string;
  name?: string;
  netWeight?: string;
  ingredients: string[];
  concerns?: Record<string, unknown>[];
  flags?: { nutrient: string; value_per_100: number; unit?: string }[];
  safety?: number | null;
  compliance?: number | null;
  additiveTotal?: number;
  /**
   * Force food_type 'processed_product' for blocks that test PRODUCT mechanics
   * (density caps, ultra-processing, alias rule). Without this a short
   * additive-free fixture is now classified as a staple ingredient.
   */
  product?: boolean;
}

/** Minimal well-formed model reply, run through the real normalize+enrich path. */
function build(b: Build): ProductAnalysis {
  const ingredients = b.product
    ? [...b.ingredients, "Emulsifier (INS 322)", "Raising Agent (INS 500(ii))", "Acidity Regulator (INS 330)"]
    : b.ingredients;
  const additiveTotal = b.product ? Math.max(b.additiveTotal ?? 0, 3) : b.additiveTotal ?? 0;
  return enrichAnalysis(
    normalizeAnalysis({
      product_info: { name: b.name ?? "Test product", net_weight: b.netWeight ?? "200 g" },
      detected_category: { category: b.category ?? "food_and_beverages" },
      verdict: "safe",
      verdict_reason: "",
      key_findings: [],
      legal_metrology_compliance: {
        mrp: { present: true, value: "Rs 50", compliant: true, issue: null, status: "present" },
      },
      ingredient_analysis: ingredients.map((name) => ({
        name,
        safety_status: "safe",
        source: "reference_database",
        personal_flags: [],
      })),
      dosage_analysis: {
        additive_count: { total: additiveTotal },
        limit_checks: [],
        cumulative_risk: "low",
        combination_warnings: [],
      },
      nutritional_analysis: {
        nutrition_score: 50, // deliberately wrong — must be overwritten locally
        nutrition_data_complete: true,
        concerns: b.concerns ?? [],
        threshold_flags: (b.flags ?? []).map((f) => ({
          ...f,
          unit: f.unit ?? "g",
          level: "low", // deliberately wrong — must be recomputed locally
          penalty: 0,
        })),
        positive_notes: [],
        sugar_alias_count: 0,
        sugar_aliases_found: [],
        is_ultra_processed: false,
        ingredient_order_note: null,
        moderation_advice: "",
        nutritional_concerns_not_in_database: [],
      },
      overall_assessment: {
        safety_score: b.safety === undefined ? 90 : b.safety,
        compliance_score: b.compliance === undefined ? 80 : b.compliance,
        safety_status: b.safety === null ? "insufficient_data" : "ok",
        compliance_status: b.compliance === null ? "insufficient_data" : "ok",
        summary: "s",
        recommendation: "r",
      },
      banned_ingredients_check: [],
      ingredients_not_in_database: [],
    }),
    { category: b.category ?? "food_and_beverages" },
  );
}

const ref = (ingredient: string) => ({ ingredient, source: "reference_database" });

console.log("\n═══ 1. Reference lookup + local rescoring (staple scale) ═══");
{
  const a = build({ ingredients: ["Durum Wheat Semolina"], concerns: [ref("Durum Wheat Semolina")] });
  const n = a.nutritional_analysis!;
  eq("semolina reference penalty (moderate, 12)", n.concerns[0].score_penalty, 12);
  eq("concern level", n.concerns[0].concern_level, "moderate");
  ok(
    "prose re-attached from local data",
    (n.concerns[0].health_effects ?? "").includes("Fibre content is low") &&
      (n.concerns[0].why_flagged ?? "").includes("coarser and less processed"),
    (n.concerns[0].health_effects ?? "").slice(0, 40),
  );
  eq(
    "better_alternative re-attached",
    n.concerns[0].better_alternative,
    "Whole wheat pasta, millet pasta, buckwheat noodles",
  );
  // Single-ingredient plain pasta => staple_ingredient. Halved concern (6) +
  // refinement deduction for 'low' density (22) => 100 - 28 = 72. No density cap.
  eq("food_type staple_ingredient", n.food_type, "staple_ingredient");
  eq("density = low", n.nutrient_density, "low");
  eq("staple score 100 - (6 + 22) = 72", n.nutrition_score, 72);
  eq("overall = .35*90 + .50*72 + .15*80", a.overall_assessment.overall_score, 80);
  eq("verdict", a.verdict, "safe");
}

console.log("\n═══ 2. Refined grains are ranked, not equal ═══");
{
  const maida = build({ ingredients: ["Refined Wheat Flour (Maida)"], concerns: [ref("Refined Wheat Flour (Maida)")] });
  const sooji = build({ ingredients: ["Sooji"], concerns: [ref("Sooji")] });
  eq("maida reference penalty", maida.nutritional_analysis!.concerns[0].score_penalty, 18);
  eq("maida level", maida.nutritional_analysis!.concerns[0].concern_level, "significant");
  eq("sooji reference penalty", sooji.nutritional_analysis!.concerns[0].score_penalty, 12);
  eq("sooji level", sooji.nutritional_analysis!.concerns[0].concern_level, "moderate");
  // Both staples on the gentle scale, but the halved penalty difference
  // survives: maida 100 - (9 + 22) = 69, semolina 100 - (6 + 22) = 72.
  eq("maida staple score", maida.nutritional_analysis!.nutrition_score, 69);
  eq("semolina staple score", sooji.nutritional_analysis!.nutrition_score, 72);
  ok(
    "maida scores below semolina",
    maida.nutritional_analysis!.nutrition_score! <
      sooji.nutritional_analysis!.nutrition_score!,
    `${maida.nutritional_analysis!.nutrition_score} < ${sooji.nutritional_analysis!.nutrition_score}`,
  );
}

console.log("\n═══ 3. Sugar threshold 'high' suppresses the alias penalties ═══");
{
  // 40 g sugar per 100 g solid -> HIGH (30, exactly on the very_high boundary).
  // Individual sugar penalties dropped; the 'any high nutrient' ceiling of 45
  // then governs the score.
  const a = build({
    product: true,
    ingredients: ["Sugar", "Invert Sugar", "Liquid Glucose", "Wheat Flour"],
    concerns: [ref("Sugar"), ref("Invert Sugar"), ref("Liquid Glucose")],
    flags: [{ nutrient: "Sugar", value_per_100: 40 }],
  });
  const n = a.nutritional_analysis!;
  eq("sugar flag recomputed to high", n.threshold_flags[0].level, "high");
  eq("penalty recomputed to 30", n.threshold_flags[0].penalty, 30);
  eq("alias count", n.sugar_alias_count, 3);
  // First three ingredients are all added sugar -> nutrient density 'empty' ->
  // ceiling 35 (which beats the 'any high nutrient' ceiling of 45).
  eq("density = empty", n.nutrient_density, "empty");
  eq("score = min(62, empty-density cap 35)", n.nutrition_score, 35);
}

console.log("\n═══ 4. No panel -> individual sugar penalties DO apply ═══");
{
  const a = build({
    product: true,
    ingredients: ["Sugar", "Invert Sugar", "Liquid Glucose", "Dextrose"],
    concerns: [ref("Sugar"), ref("Invert Sugar"), ref("Liquid Glucose"), ref("Dextrose")],
    flags: [],
  });
  const n = a.nutritional_analysis!;
  eq("threshold_flags empty", n.threshold_flags.length, 0);
  eq("nutrition_data_complete false", n.nutrition_data_complete, false);
  eq("alias count", n.sugar_alias_count, 4);
  eq("aliases", n.sugar_aliases_found, ["Dextrose", "Invert Sugar", "Liquid Glucose", "Sugar"]);
  // 12 + 8 + 8 + 8 = 36, + 8 alias rule = 44 -> score 56. The product is pure
  // sugar by the first three ingredients -> density 'empty' -> ceiling 35
  // (below the no-panel alias cap of 50).
  eq("density = empty", n.nutrient_density, "empty");
  eq("score = min(56, empty-density cap 35)", n.nutrition_score, 35);
  ok("no invented sugar value", !JSON.stringify(n.threshold_flags).includes("value_per_100"));
}

console.log("\n═══ 5. Beverages use the per-100 ml scale ═══");
{
  // 12 straddles the two scales: medium against 22.5 (solid), high against
  // 11.25 (liquid). Same number, different verdict — that IS the rule.
  const solid = build({
    name: "Biscuit",
    netWeight: "200 g",
    ingredients: ["Wheat Flour"],
    flags: [{ nutrient: "Sugar", value_per_100: 12 }],
  });
  const drink = build({
    name: "Orange Drink",
    netWeight: "600 ml",
    ingredients: ["Water", "Sugar"],
    flags: [{ nutrient: "Sugar", value_per_100: 12 }],
  });
  eq("12 g per 100 g solid -> medium", solid.nutritional_analysis!.threshold_flags[0].level, "medium");
  eq("12 g per 100 ml drink -> high", drink.nutritional_analysis!.threshold_flags[0].level, "high");
  eq("solid penalty 12", solid.nutritional_analysis!.threshold_flags[0].penalty, 12);
  eq("liquid penalty 35", drink.nutritional_analysis!.threshold_flags[0].penalty, 35);
}

console.log("\n═══ 6. Saturated-fat priced caps the combined oil penalties at 8 ═══");
{
  const a = build({
    product: true,
    ingredients: ["Palm Oil", "Refined Vegetable Oil", "Interesterified Fat"],
    concerns: [ref("Palm Oil"), ref("Refined Vegetable Oil"), ref("Interesterified Fat")],
    flags: [{ nutrient: "Saturated fat", value_per_100: 14 }],
  });
  const n = a.nutritional_analysis!;
  // All three are concern_type 'refined_oil': 8 + 6 + 8 = 22, capped to 8.
  // 14 g sat fat is 'very_high' (30). 8 + 30 = 38 -> score 62. Both the
  // 'any very_high nutrient' ceiling (30) and the 'empty' density ceiling (35)
  // apply; the lower wins -> 30.
  eq("sat fat flag very_high", n.threshold_flags[0].level, "very_high");
  eq("three oils summing 22 are capped to 8", n.concerns.length, 3);
  eq("density = empty (all-fat primary ingredients)", n.nutrient_density, "empty");
  eq("score = min(62, cap 30)", n.nutrition_score, 30);

  // A 'medium' sat-fat reading does not price the fat, so the oils are charged
  // in full: 8 + 6 + 8 = 22, plus the medium sat-fat threshold penalty 8 -> 70,
  // then the 'empty' density ceiling of 35 governs.
  const uncapped = build({
    product: true,
    ingredients: ["Palm Oil", "Refined Vegetable Oil", "Interesterified Fat"],
    concerns: [ref("Palm Oil"), ref("Refined Vegetable Oil"), ref("Interesterified Fat")],
    flags: [{ nutrient: "Saturated fat", value_per_100: 2 }],
  });
  eq("100 - (22 + 8) = 70, then empty-density cap 35", uncapped.nutritional_analysis!.nutrition_score, 35);
}

console.log("\n═══ 7. Sodium is threshold-only, never an ingredient penalty ═══");
{
  const a = build({
    product: true,
    ingredients: ["Salt", "Wheat Flour"],
    concerns: [{ ingredient: "Salt", concern_type: "high_sodium", concern_level: "moderate", score_penalty: 9, source: "ai_knowledge" }],
    flags: [{ nutrient: "Sodium", value_per_100: 780, unit: "mg" }],
  });
  const n = a.nutritional_analysis!;
  eq("sodium high", n.threshold_flags[0].level, "high");
  // 780 mg sodium is 'high' (25) -> score 75, then capped to 45 by the 'any
  // high nutrient' ceiling. The salt ingredient is still never charged.
  eq("score = min(75, high cap 45)", n.nutrition_score, 45);
}

console.log("\n═══ 8. Salt in grams converts to sodium in mg ═══");
{
  const a = build({ ingredients: ["Wheat Flour"], flags: [{ nutrient: "Salt", value_per_100: 2, unit: "g" }] });
  const f = a.nutritional_analysis!.threshold_flags[0];
  eq("2 g salt -> 800 mg sodium", f.value_per_100, 800);
  eq("level", f.level, "high");
}

console.log("\n═══ 9. Fibre + whole-grain bonuses lift a staple to the ceiling ═══");
{
  const a = build({
    ingredients: ["Whole Wheat Atta"],
    flags: [{ nutrient: "Fibre", value_per_100: 9 }],
  });
  const n = a.nutritional_analysis!;
  eq("fibre flag kept as a display marker (negative)", n.threshold_flags[0].penalty < 0, true);
  eq("food_type staple_ingredient", n.food_type, "staple_ingredient");
  eq("whole-grain atta reads as high density", n.nutrient_density, "high");
  ok(
    "fibre (+8) and whole-grain (+12) bonuses surfaced",
    n.positive_notes.some((p) => /fibre/i.test(p)) &&
      n.positive_notes.some((p) => /whole grain/i.test(p)),
    n.positive_notes.join(" | "),
  );
  eq("score capped at 95 (max), not 100 + bonuses", n.nutrition_score, 95);
}

console.log("\n═══ 10. Ultra-processing + the 75 penalty cap + the 25 soft floor ═══");
{
  const a = build({
    ingredients: [
      "Refined Wheat Flour", "Sugar", "Palm Oil", "Invert Sugar", "High Fructose Corn Syrup",
      "Hydrogenated Vegetable Oil", "Salt", "Tartrazine (E102)", "Sodium Benzoate (E211)",
      "Flavour Enhancer (INS 621)", "Emulsifier (E471)", "Water",
    ],
    concerns: [
      ref("Refined Wheat Flour"), ref("Sugar"), ref("Palm Oil"), ref("Invert Sugar"),
      ref("High Fructose Corn Syrup"), ref("Hydrogenated Vegetable Oil"),
    ],
    additiveTotal: 4,
  });
  const n = a.nutritional_analysis!;
  eq("ultra-processed", n.is_ultra_processed, true);
  eq("soft floor holds at 25 (penalties capped at 75)", n.nutrition_score, 25);
  eq("verdict is 'avoid' (nutrition <= 30)", a.verdict, "avoid");
  eq("order note derived", n.ingredient_order_note !== null, true);
}

console.log("\n═══ 11. Non-food categories have no nutrition dimension ═══");
{
  for (const cat of ["personal_care", "household_cleaning", "baby_product_care"]) {
    const a = build({
      category: cat,
      ingredients: ["Aqua", "Sodium Laureth Sulfate", "Palm Oil"],
      concerns: [ref("Palm Oil")],
    });
    eq(`${cat}: nutritional_analysis absent`, a.nutritional_analysis ?? null, null);
    eq(`${cat}: nutrition_score null`, a.overall_assessment.nutrition_score ?? null, null);
    eq(`${cat}: overall = .75*90 + .25*80`, a.overall_assessment.overall_score, 88);
  }
}

console.log("\n═══ 12. Baby food halves the thresholds ═══");
{
  const adult = build({ ingredients: ["Wheat Flour"], flags: [{ nutrient: "Sugar", value_per_100: 15 }] });
  const baby = build({
    category: "baby_product_food",
    ingredients: ["Wheat Flour", "Sugar"],
    concerns: [ref("Sugar")],
    flags: [{ nutrient: "Sugar", value_per_100: 15 }],
  });
  eq("15 g/100 g adult -> medium", adult.nutritional_analysis!.threshold_flags[0].level, "medium");
  eq("15 g/100 g baby -> high (11.25 cut-off)", baby.nutritional_analysis!.threshold_flags[0].level, "high");
  const honey = build({
    category: "baby_product_food",
    ingredients: ["Honey"],
    concerns: [ref("Honey")],
  });
  eq(
    "any added sugar in baby food is 'significant'",
    honey.nutritional_analysis!.concerns[0].concern_level,
    "significant",
  );
}

console.log("\n═══ 13. Partial data -> no overall score is computed ═══");
{
  const a = build({ ingredients: ["Sugar"], concerns: [ref("Sugar")], compliance: null });
  eq("overall_score null", a.overall_assessment.overall_score, null);
  ok("verdict falls back to the model's", a.verdict === "safe", `verdict=${a.verdict}`);
}

console.log("\n═══ 14. ai_knowledge penalties are clamped to their band ═══");
{
  const a = build({
    ingredients: ["Hydrolysed Vegetable Protein", "Sago Pearls"],
    concerns: [
      { ingredient: "Hydrolysed Vegetable Protein", concern_type: "high_sodium", concern_level: "moderate", score_penalty: 40, why_flagged: "x", source: "ai_knowledge" },
      { ingredient: "Sago Pearls", concern_type: "low_nutrient_density", concern_level: "mild", score_penalty: 0, why_flagged: "y", source: "ai_knowledge" },
    ],
  });
  const n = a.nutritional_analysis!;
  eq("40 clamped into the 'moderate' band", n.concerns[0].score_penalty, 10);
  eq("0 raised to the 'mild' floor", n.concerns[1].score_penalty, 3);
  eq("both listed as not-in-database", n.nutritional_concerns_not_in_database, [
    "Hydrolysed Vegetable Protein",
    "Sago Pearls",
  ]);
  // A name that DOES resolve to a reference alias is rebuilt from local data,
  // whatever the model claimed. "Tapioca Maltodextrin" contains "Maltodextrin".
  const b = build({
    ingredients: ["Tapioca Maltodextrin"],
    concerns: [
      { ingredient: "Tapioca Maltodextrin", concern_type: "low_nutrient_density", concern_level: "mild", score_penalty: 3, why_flagged: "model text", source: "ai_knowledge" },
    ],
  });
  eq("alias hit overrides the model's claim", b.nutritional_analysis!.concerns[0].source, "reference_database");
  eq("and takes the reference penalty", b.nutritional_analysis!.concerns[0].score_penalty, 8);
}

console.log("\n═══ 15. Verdict follows the weakest dimension ═══");
{
  // deriveVerdict(safety, nutrition, overall, isFood, fallback, foodType, opts)
  const P = "processed_product" as const;
  const S = "staple_ingredient" as const;
  const cases: [string, string][] = [
    // Processed products — the strict bands.
    [`${deriveVerdict(96, 90, 88, true, "caution", P)} <- 96/90/88 product`, "safe"],
    [`${deriveVerdict(96, 60, 82, true, "caution", P)} <- 96/60/82 product`, "caution"],
    [`${deriveVerdict(96, 40, 90, true, "caution", P)} <- 96/40/90 product`, "limit"],
    [`${deriveVerdict(96, 25, 90, true, "caution", P)} <- 96/25/90 product`, "avoid"],
    [`${deriveVerdict(40, 95, 95, true, "caution", P)} <- 40/95/95 product`, "avoid"],
    // Staple ingredients — never 'avoid'/'limit' from nutrition alone.
    [`${deriveVerdict(96, 72, 82, true, "caution", S)} <- 96/72 staple`, "safe"],
    [`${deriveVerdict(96, 55, 82, true, "caution", S)} <- 96/55 staple`, "caution"],
    [`${deriveVerdict(96, 40, 82, true, "caution", S, { useSparingly: true })} <- staple use-sparingly`, "caution"],
    [`${deriveVerdict(40, 95, 82, true, "caution", S)} <- 40 safety staple`, "avoid"],
  ];
  for (const [got, want] of cases) {
    ok(got, got.split(" ")[0] === want, `want ${want}`);
  }
}

console.log("\n═══ 16. Health-profile escalation (STEP 8) ═══");
{
  const highSugarRefined = build({
    ingredients: ["Refined Wheat Flour", "Sugar"],
    concerns: [ref("Refined Wheat Flour"), ref("Sugar")],
    flags: [
      { nutrient: "Sugar", value_per_100: 40 },
      { nutrient: "Sodium", value_per_100: 900, unit: "mg" },
      { nutrient: "Saturated fat", value_per_100: 12 },
    ],
    additiveTotal: 4,
  });
  const p = (o: Partial<Record<string, string[]>>) => ({
    allergies: [],
    dietary_preferences: [],
    health_conditions: [],
    custom_avoid_ingredients: [],
    ...o,
  });
  const sev = (profile: Parameters<typeof nutritionPersonalAlerts>[0]) =>
    nutritionPersonalAlerts(profile, highSugarRefined).map((f) => f.severity);

  ok("diabetic + refined grain -> critical", sev(p({ health_conditions: ["Diabetic"] })).includes("critical"));
  ok("hypertension + high sodium -> critical", sev(p({ health_conditions: ["Hypertension (high BP)"] })).includes("critical"));
  ok("heart + high sat fat -> critical", sev(p({ health_conditions: ["Heart condition"] })).includes("critical"));
  ok("weight management + ultra-processed -> warning", sev(p({ health_conditions: ["Weight management"] })).includes("warning"));
  ok("'No sugar' + a sugar alias -> warning", sev(p({ dietary_preferences: ["No sugar"] })).includes("warning"));
  ok("child under 12 -> warning", sev(p({ health_conditions: ["Child under 12"] })).includes("warning"));
  eq("no profile -> no alerts", nutritionPersonalAlerts(null, highSugarRefined).length, 0);

  const shampoo = build({ category: "personal_care", ingredients: ["Aqua"] });
  eq("non-food -> no nutrition alerts", nutritionPersonalAlerts(p({ health_conditions: ["Diabetic"] }), shampoo).length, 0);
}

console.log("\n═══ 17. Trans fat above 2% of total fat is ALSO a compliance issue ═══");
{
  const a = build({
    ingredients: ["Hydrogenated Vegetable Oil"],
    concerns: [ref("Hydrogenated Vegetable Oil")],
    flags: [
      { nutrient: "Trans fat", value_per_100: 1.2 },
      { nutrient: "Total fat", value_per_100: 20 },
    ],
  });
  const c = a.legal_metrology_compliance.trans_fat_limit;
  ok("compliance entry recorded", !!c && c.compliant === false, c?.issue ?? "(absent)");
}

console.log(`\n${"=".repeat(70)}`);
console.log(fails === 0 ? "NUTRITION RULES: ALL CHECKS PASSED" : `NUTRITION RULES: ${fails} FAILURE(S)`);
process.exitCode = fails ? 1 : 0;
