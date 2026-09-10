/* eslint-disable no-console */
/**
 * STEP 10, OFFLINE — the same six cases and the SAME assertions as
 * scripts/test-nutrition.ts, but fed a hand-written model reply instead of
 * calling Claude. Written because the Anthropic account ran out of credit
 * mid-verification; run scripts/test-nutrition.ts once it is topped up.
 *
 * WHAT THIS PROVES: everything downstream of the model — the reference lookup,
 * the prose re-attachment, the threshold bands and per-100 ml scale, the
 * double-counting rules, the alias rule, nutrition_score, overall_score and
 * the verdict. All of that now lives in lib/enrich-analysis.ts.
 *
 * WHAT IT DOES NOT PROVE: that Sonnet actually identifies these ingredients
 * and reads these numbers off a real label. Each fixture below is what the
 * prompt ASKS the model to return, not what it was observed to return.
 *
 * Run: npx tsx scripts/test-nutrition-offline.ts
 */
import { CASES, banner, report } from "./test-nutrition";
import { enrichAnalysis } from "@/lib/enrich-analysis";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import type { ProductAnalysis } from "@/types/analysis";

/** A reference-database concern as the prompt asks for it: five short fields. */
const rc = (ingredient: string, type: string, level: string, penalty: number) => ({
  ingredient,
  concern_type: type,
  concern_level: level,
  score_penalty: penalty,
  why_flagged: "",
  health_effects: "",
  moderation_guidance: "",
  better_alternative: "",
  who_should_limit: [],
  source: "reference_database",
});

const tf = (nutrient: string, value: number, unit = "g", level = "medium") => ({
  nutrient,
  value_per_100: value,
  unit,
  level,
  penalty: 0,
});

const ing = (name: string, status = "safe") => ({
  name,
  safety_status: status,
  reason: "",
  source: "reference_database",
  personal_flags: [],
});

const decl = (present: boolean, value: string | null) => ({
  present,
  value,
  compliant: present,
  issue: present ? null : "Not found on the part of the label that was read",
  status: present ? "present" : "missing",
});

const COMPLIANT = {
  manufacturer_info: decl(true, "Given"),
  generic_name: decl(true, "Given"),
  net_quantity: decl(true, "Given"),
  manufacture_date: decl(true, "Given"),
  best_before_use_by: decl(true, "Given"),
  mrp: decl(true, "Given"),
  unit_sale_price: decl(false, null),
  consumer_care: decl(true, "Given"),
  country_of_origin: decl(false, null),
  fssai_license: decl(true, "Given"),
};

/** The model reply each case's prompt asks for. */
const FIXTURES: Record<string, Record<string, unknown>> = {
  "1": {
    product_info: { name: "Elbow Macaroni Pasta", brand: "First Crop", net_weight: "500 g", mrp: "Rs. 145" },
    ingredient_analysis: [ing("Durum Wheat Semolina")],
    legal_metrology_compliance: COMPLIANT,
    nutritional_analysis: {
      nutrition_score: 90,
      nutrition_data_complete: false,
      concerns: [rc("Durum Wheat Semolina", "refined_grain", "moderate", 6)],
      threshold_flags: [],
      positive_notes: ["Single ingredient — no additives, no added sugar, no added oil."],
      sugar_alias_count: 0,
      sugar_aliases_found: [],
      is_ultra_processed: false,
      ingredient_order_note: null,
      moderation_advice: "Nutritional values not visible — scan the nutrition panel for a complete assessment.",
      nutritional_concerns_not_in_database: [],
    },
    overall_assessment: { safety_score: 96, compliance_score: 82, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "safe",
  },

  "2": {
    product_info: { name: "Crunchy Glucose Biscuits", net_weight: "250 g", mrp: "Rs. 30" },
    ingredient_analysis: [
      ing("Refined Wheat Flour (Maida)"),
      ing("Sugar"),
      ing("Palm Oil"),
      ing("Invert Syrup"),
      ing("Salt"),
      ing("Raising Agent (INS 503(ii))"),
      ing("Raising Agent (INS 500(ii))"),
      ing("Emulsifier (INS 322(i))", "caution"),
      ing("Artificial Flavouring Substances", "caution"),
    ],
    legal_metrology_compliance: COMPLIANT,
    dosage_analysis: { additive_count: { emulsifiers: 1, total: 4 }, limit_checks: [], cumulative_risk: "medium", combination_warnings: [] },
    nutritional_analysis: {
      nutrition_score: 45,
      nutrition_data_complete: true,
      concerns: [
        rc("Refined Wheat Flour (Maida)", "refined_grain", "significant", 12),
        rc("Sugar", "added_sugar", "significant", 12),
        rc("Palm Oil", "refined_oil", "moderate", 8),
        rc("Invert Syrup", "added_sugar", "moderate", 8),
      ],
      threshold_flags: [
        tf("Sugar", 21),
        tf("Saturated fat", 7.2),
        tf("Total fat", 15),
        tf("Sodium", 310, "mg"),
        tf("Fibre", 1.2),
      ],
      positive_notes: [],
      sugar_alias_count: 2,
      sugar_aliases_found: ["Sugar", "Invert Syrup"],
      is_ultra_processed: false,
      ingredient_order_note: "Refined flour is the 1st ingredient and sugar the 2nd — together they are most of this product.",
      moderation_advice: "",
      nutritional_concerns_not_in_database: [],
    },
    overall_assessment: { safety_score: 78, compliance_score: 82, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "caution",
  },

  "3": {
    product_info: { name: "Orange Fizz Sparkling Drink", net_weight: "600 ml", mrp: "Rs. 45", category: "Carbonated beverage" },
    ingredient_analysis: [
      ing("Carbonated Water"),
      ing("Sugar"),
      ing("Orange Juice Concentrate"),
      ing("Acidity Regulator (INS 330)"),
      ing("Preservative (INS 211)", "caution"),
      ing("Stabiliser (INS 445)", "caution"),
      ing("Artificial Flavouring Substances", "caution"),
      ing("Colour (INS 110)", "harmful"),
    ],
    legal_metrology_compliance: COMPLIANT,
    dosage_analysis: { additive_count: { preservatives: 1, colors: 1, emulsifiers: 1, total: 4 }, limit_checks: [], cumulative_risk: "medium", combination_warnings: [] },
    nutritional_analysis: {
      nutrition_score: 55,
      nutrition_data_complete: true,
      concerns: [
        rc("Sugar", "added_sugar", "significant", 12),
        rc("Orange Juice Concentrate", "added_sugar", "moderate", 7),
      ],
      threshold_flags: [tf("Sugar", 11.0), tf("Sodium", 12, "mg"), tf("Total fat", 0)],
      positive_notes: [],
      sugar_alias_count: 2,
      sugar_aliases_found: ["Sugar", "Orange Juice Concentrate"],
      is_ultra_processed: false,
      ingredient_order_note: "Sugar is the 2nd ingredient.",
      moderation_advice: "",
      nutritional_concerns_not_in_database: [],
    },
    overall_assessment: { safety_score: 62, compliance_score: 82, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "caution",
  },

  "3b": {
    product_info: { name: "Mango Nectar Drink", net_weight: "1 L", mrp: "Rs. 99", category: "Fruit drink" },
    ingredient_analysis: [
      ing("Water"),
      ing("Sugar"),
      ing("Mango Pulp"),
      ing("Liquid Glucose"),
      ing("Acidity Regulator (INS 330)"),
      ing("Preservative (INS 211)", "caution"),
      ing("Stabiliser (INS 440)"),
      ing("Artificial Flavouring Substances", "caution"),
      ing("Colour (INS 102)", "harmful"),
    ],
    legal_metrology_compliance: COMPLIANT,
    dosage_analysis: { additive_count: { preservatives: 1, colors: 1, total: 4 }, limit_checks: [], cumulative_risk: "medium", combination_warnings: [] },
    nutritional_analysis: {
      nutrition_score: 40,
      nutrition_data_complete: true,
      concerns: [
        rc("Sugar", "added_sugar", "significant", 12),
        rc("Liquid Glucose", "added_sugar", "moderate", 8),
      ],
      threshold_flags: [tf("Sugar", 12.8), tf("Sodium", 9, "mg"), tf("Total fat", 0)],
      positive_notes: [],
      sugar_alias_count: 2,
      sugar_aliases_found: ["Sugar", "Liquid Glucose"],
      is_ultra_processed: false,
      ingredient_order_note: "Sugar is the 2nd ingredient.",
      moderation_advice: "",
      nutritional_concerns_not_in_database: [],
    },
    overall_assessment: { safety_score: 58, compliance_score: 82, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "caution",
  },

  // Non-food: the prompt tells the model to OMIT nutritional_analysis entirely.
  "4": {
    product_info: { name: "Shampoo", net_weight: "340 ml", mrp: "Rs. 199" },
    ingredient_analysis: [
      ing("Aqua"),
      ing("Sodium Laureth Sulfate", "caution"),
      ing("Cocamidopropyl Betaine"),
      ing("Dimethicone"),
      ing("Parfum", "caution"),
      ing("Methylchloroisothiazolinone", "caution"),
    ],
    legal_metrology_compliance: COMPLIANT,
    overall_assessment: { safety_score: 72, compliance_score: 84, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "caution",
  },

  "5": {
    product_info: { name: "Instant Savoury Noodle Cup", net_weight: "70 g", mrp: "Rs. 40" },
    ingredient_analysis: [
      ing("Sago Pearls"),
      ing("Tapioca Maltodextrin"),
      ing("Glucose Syrup Solids"),
      ing("Hydrolysed Vegetable Protein"),
      ing("Condensed Milk Solids"),
      ing("Refined Coconut Oil"),
      ing("Onion Powder"),
      ing("Turmeric"),
      ing("Black Pepper"),
      ing("Iodised Salt"),
    ],
    legal_metrology_compliance: COMPLIANT,
    nutritional_analysis: {
      nutrition_score: 60,
      nutrition_data_complete: false,
      concerns: [
        // Reference hits — five short fields only.
        rc("Tapioca Maltodextrin", "added_sugar", "moderate", 8),
        rc("Glucose Syrup Solids", "added_sugar", "moderate", 8),
        // ai_knowledge — the model writes its own prose.
        {
          ingredient: "Sago Pearls",
          concern_type: "low_nutrient_density",
          concern_level: "moderate",
          score_penalty: 7,
          why_flagged:
            "Sago is almost pure starch extracted from tapioca root, with negligible protein, fibre, vitamins or minerals.",
          health_effects:
            "Digests rapidly and raises blood glucose quickly. As a large share of a meal it displaces foods that would supply protein and fibre.",
          moderation_guidance:
            "Fine as an occasional food and useful during illness or fasting, but a poor base for a regular meal.",
          better_alternative: "Whole millets, oats, brown rice",
          who_should_limit: ["Diabetic"],
          source: "ai_knowledge",
        },
        {
          ingredient: "Hydrolysed Vegetable Protein",
          concern_type: "high_sodium",
          concern_level: "moderate",
          score_penalty: 7,
          why_flagged:
            "A savoury flavouring produced by acid hydrolysis of plant protein. It is naturally high in free glutamate and sodium and is used to make a product taste richer than its ingredients justify.",
          health_effects:
            "Contributes substantially to a product's sodium load, which raises blood pressure over time.",
          moderation_guidance:
            "Not dangerous, but it usually signals a heavily salted product. Check the sodium figure on the panel.",
          better_alternative: "Products flavoured with real vegetables, spices or stock",
          who_should_limit: ["Hypertension (high BP)"],
          source: "ai_knowledge",
        },
        {
          ingredient: "Condensed Milk Solids",
          concern_type: "added_sugar",
          concern_level: "moderate",
          score_penalty: 8,
          why_flagged:
            "Condensed milk is milk with a large quantity of sugar added and the water removed — typically around 55% sugar by weight.",
          health_effects:
            "Adds concentrated sugar alongside the milk protein and fat, raising the product's total sugar load.",
          moderation_guidance: "Treat it as a sweetener rather than as a dairy ingredient.",
          better_alternative: "Plain milk powder, unsweetened dairy",
          who_should_limit: ["Diabetic", "Weight management"],
          source: "ai_knowledge",
        },
        {
          ingredient: "Refined Coconut Oil",
          concern_type: "refined_oil",
          concern_level: "moderate",
          score_penalty: 8,
          why_flagged:
            "Coconut oil is over 80% saturated fat, and the refined form has been bleached and deodorised, removing the polyphenols of the cold-pressed version.",
          health_effects: "Raises LDL cholesterol more than most plant oils.",
          moderation_guidance:
            "Traditional in parts of India and fine in normal cooking quantities; less good as a bulk fat in a packaged product.",
          better_alternative: "Groundnut, mustard or rice bran oil",
          who_should_limit: ["Heart condition"],
          source: "ai_knowledge",
        },
      ],
      threshold_flags: [],
      positive_notes: [],
      sugar_alias_count: 2,
      sugar_aliases_found: ["Maltodextrin", "Glucose Syrup Solids"],
      is_ultra_processed: false,
      ingredient_order_note: null,
      moderation_advice: "",
      nutritional_concerns_not_in_database: [
        "Sago Pearls",
        "Hydrolysed Vegetable Protein",
        "Condensed Milk Solids",
        "Refined Coconut Oil",
      ],
    },
    overall_assessment: { safety_score: 88, compliance_score: 82, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "caution",
  },

  "6": {
    product_info: { name: "Soft Centre Fruit Candy", net_weight: "120 g", mrp: "Rs. 50" },
    ingredient_analysis: [
      ing("Sugar"),
      ing("Liquid Glucose"),
      ing("Invert Sugar"),
      ing("Dextrose"),
      ing("Edible Vegetable Oil"),
      ing("Gelling Agent (INS 440)"),
      ing("Acidity Regulator (INS 330)"),
      ing("Permitted Synthetic Food Colour (INS 122)", "harmful"),
      ing("Artificial Flavouring Substances", "caution"),
    ],
    legal_metrology_compliance: COMPLIANT,
    dosage_analysis: { additive_count: { colors: 1, emulsifiers: 1, total: 3 }, limit_checks: [], cumulative_risk: "medium", combination_warnings: [] },
    nutritional_analysis: {
      nutrition_score: 35,
      // No nutrition panel anywhere in the label text.
      nutrition_data_complete: false,
      concerns: [
        rc("Sugar", "added_sugar", "significant", 12),
        rc("Liquid Glucose", "added_sugar", "moderate", 8),
        rc("Invert Sugar", "added_sugar", "moderate", 8),
        rc("Dextrose", "added_sugar", "moderate", 8),
      ],
      threshold_flags: [],
      positive_notes: [],
      sugar_alias_count: 4,
      sugar_aliases_found: ["Sugar", "Liquid Glucose", "Invert Sugar", "Dextrose"],
      is_ultra_processed: false,
      ingredient_order_note: "Sugar is the 1st ingredient.",
      moderation_advice: "Nutritional values not visible — scan the nutrition panel for a complete assessment.",
      nutritional_concerns_not_in_database: [],
    },
    overall_assessment: { safety_score: 55, compliance_score: 82, safety_status: "ok", compliance_status: "ok", summary: "", recommendation: "" },
    verdict: "caution",
  },
};

function buildFrom(caseId: string, category: string): ProductAnalysis {
  const f = FIXTURES[caseId];
  return enrichAnalysis(
    normalizeAnalysis({
      verdict_reason: "",
      key_findings: [],
      dosage_analysis: { additive_count: { total: 0 }, limit_checks: [], cumulative_risk: "low", combination_warnings: [] },
      personal_alerts: [],
      banned_ingredients_check: [],
      ingredients_not_in_database: [],
      detected_category: { category },
      ...f,
    }),
    { category },
  );
}

console.log(
  "\nOFFLINE RUN — the model reply is a fixture, not a live call.\n" +
    "This exercises normalizeAnalysis -> enrichAnalysis (all scoring) end to end.\n" +
    "It does NOT verify that Sonnet identifies these ingredients on a real label.",
);

const results: { id: string; passed: number; total: number }[] = [];
for (const c of CASES) {
  banner(c);
  const a = buildFrom(c.id, c.category);
  const r = report(c, a, 0);
  results.push(r);
}

console.log(`\n${"=".repeat(78)}\nSUMMARY (offline)\n${"=".repeat(78)}`);
let p = 0;
let t = 0;
for (const r of results) {
  p += r.passed;
  t += r.total;
  console.log(`  TEST ${r.id.padEnd(3)}: ${r.passed}/${r.total} checks passed`);
}
console.log(`  TOTAL   : ${p}/${t}`);
process.exitCode = p === t ? 0 : 1;
