/* eslint-disable no-console */
/**
 * 2026 NUTRIENT-DENSITY RECALIBRATION — the seven acceptance cases.
 *
 * Pure-local: a hand-written model reply is run through the real
 * normalizeAnalysis -> enrichAnalysis path. No API calls, no cost. None of the
 * fixtures supply nutrient_density, so this also exercises the LOCAL density
 * derivation (the model's classification is only a starting point in prod).
 *
 *   A. Durum semolina pasta   -> density 'low',  ~70, "Reasonable choice"
 *   B. Whole wheat pasta      -> density 'high', 88-95   [GUARDRAIL vs A]
 *   C. Maida biscuits         -> density 'empty'/'low', 20-30, 'avoid'
 *   D. Cola 10.6 g/100 ml     -> density 'empty', <=30, 'avoid'/'limit'
 *   E. Plain dahi             -> density 'high', 90+, 'good'
 *   F. Whole wheat atta       -> density 'high', 90+, 'good'
 *   G. White rice             -> density 'low', 65-70, "Reasonable" NOT 'avoid'
 *
 * Run: npx tsx scripts/test-density-recalibration.ts
 */
import { enrichAnalysis } from "@/lib/enrich-analysis";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import type { ProductAnalysis } from "@/types/analysis";

let fails = 0;
const check = (label: string, pass: boolean, detail: string) => {
  if (!pass) fails++;
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}\n         ${detail}`);
};

interface Build {
  category?: string;
  name: string;
  netWeight: string;
  ingredients: string[];
  concerns?: Record<string, unknown>[];
  flags?: { nutrient: string; value_per_100: number; unit?: string }[];
  safety: number;
  compliance: number;
  additiveTotal?: number;
}

const rc = (
  ingredient: string,
  concern_type: string,
  concern_level: string,
  score_penalty: number,
) => ({
  ingredient,
  concern_type,
  concern_level,
  score_penalty,
  why_flagged: "",
  health_effects: "",
  moderation_guidance: "",
  better_alternative: "",
  who_should_limit: [],
  source: "reference_database",
});

function run(b: Build): ProductAnalysis {
  return enrichAnalysis(
    normalizeAnalysis({
      product_info: { name: b.name, net_weight: b.netWeight },
      detected_category: { category: b.category ?? "food_and_beverages" },
      verdict: "safe",
      verdict_reason: "",
      key_findings: [],
      legal_metrology_compliance: {
        mrp: { present: true, value: "Rs 50", compliant: true, issue: null, status: "present" },
      },
      ingredient_analysis: b.ingredients.map((name) => ({
        name,
        safety_status: "safe",
        source: "reference_database",
        personal_flags: [],
      })),
      dosage_analysis: {
        additive_count: { total: b.additiveTotal ?? 0 },
        limit_checks: [],
        cumulative_risk: "low",
        combination_warnings: [],
      },
      nutritional_analysis: {
        nutrition_score: 88,
        nutrition_data_complete: true,
        // deliberately omitted: nutrient_density / density_note
        concerns: b.concerns ?? [],
        threshold_flags: (b.flags ?? []).map((f) => ({
          ...f,
          unit: f.unit ?? "g",
          level: "low",
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
        safety_score: b.safety,
        compliance_score: b.compliance,
        safety_status: "ok",
        compliance_status: "ok",
        summary: "",
        recommendation: "",
      },
      banned_ingredients_check: [],
      ingredients_not_in_database: [],
    }),
    { category: b.category ?? "food_and_beverages" },
  );
}

/** Mirror of safeVerdictWording() in app/scan/page.tsx for reporting. */
function wording(a: ProductAnalysis): string {
  if (a.verdict !== "safe") return `(verdict ${a.verdict})`;
  const n = a.overall_assessment?.nutrition_score;
  if (n == null) return "Safe to consume";
  return n <= 75 ? "Reasonable choice" : "Good choice";
}

function dump(tag: string, a: ProductAnalysis) {
  const oa = a.overall_assessment;
  const n = a.nutritional_analysis!;
  console.log(
    `   ${tag}  nutrition=${oa.nutrition_score}  density=${n.nutrient_density}  verdict=${a.verdict} (${wording(a)})  overall=${oa.overall_score}`,
  );
  console.log(`         density_note: ${n.density_note}`);
  console.log(
    `         concerns: ${n.concerns.map((c) => `${c.ingredient}:${c.concern_level}/${c.score_penalty}`).join(", ") || "(none)"}`,
  );
}

const results: { id: string; nutrition: number | null; density: string; verdict: string; wording: string; overall: number | null }[] = [];
const record = (id: string, a: ProductAnalysis) =>
  results.push({
    id,
    nutrition: a.overall_assessment.nutrition_score ?? null,
    density: a.nutritional_analysis!.nutrient_density,
    verdict: a.verdict,
    wording: wording(a),
    overall: a.overall_assessment.overall_score ?? null,
  });

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("A — Durum wheat semolina pasta (single ingredient)");
console.log("EXPECT density 'low', nutrition ~70 (capped), verdict good / 'Reasonable choice'");
console.log("█".repeat(78));
const A = run({
  name: "Elbow Macaroni Pasta",
  netWeight: "500 g",
  ingredients: ["Durum Wheat Semolina"],
  concerns: [rc("Durum Wheat Semolina", "refined_grain", "moderate", 12)],
  safety: 96,
  compliance: 82,
});
dump("A", A);
record("A", A);
check("A density 'low'", A.nutritional_analysis!.nutrient_density === "low", A.nutritional_analysis!.nutrient_density);
check("A nutrition 66-74 (~70)", (A.overall_assessment.nutrition_score ?? 0) >= 66 && (A.overall_assessment.nutrition_score ?? 0) <= 74, `${A.overall_assessment.nutrition_score}`);
check("A verdict 'safe' with 'Reasonable choice' wording", A.verdict === "safe" && wording(A) === "Reasonable choice", `${A.verdict} / ${wording(A)}`);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("B — Whole wheat pasta (single ingredient, ~8 g fibre)  [GUARDRAIL vs A]");
console.log("EXPECT density 'high', nutrition 88-95, verdict good — clearly ABOVE A");
console.log("█".repeat(78));
const B = run({
  name: "Whole Wheat Fusilli Pasta",
  netWeight: "500 g",
  ingredients: ["Whole Wheat Flour"],
  concerns: [],
  flags: [
    { nutrient: "Fibre", value_per_100: 8 },
    { nutrient: "Sugar", value_per_100: 3 },
    { nutrient: "Saturated fat", value_per_100: 0.4 },
  ],
  safety: 96,
  compliance: 82,
});
dump("B", B);
record("B", B);
check("B density 'high'", B.nutritional_analysis!.nutrient_density === "high", B.nutritional_analysis!.nutrient_density);
check("B nutrition 88-95", (B.overall_assessment.nutrition_score ?? 0) >= 88 && (B.overall_assessment.nutrition_score ?? 0) <= 95, `${B.overall_assessment.nutrition_score}`);
check("B verdict 'safe'", B.verdict === "safe", B.verdict);
check(
  "B clearly outscores A (>= A + 15)",
  (B.overall_assessment.nutrition_score ?? 0) >= (A.overall_assessment.nutrition_score ?? 0) + 15,
  `B=${B.overall_assessment.nutrition_score} vs A=${A.overall_assessment.nutrition_score}`,
);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("C — Maida biscuits with palm oil, sugar aliases, ultra-processed");
console.log("EXPECT density 'low'/'empty', nutrition 20-30, verdict 'avoid'");
console.log("█".repeat(78));
const C = run({
  name: "Cream Biscuits",
  netWeight: "250 g",
  ingredients: [
    "Refined Wheat Flour (Maida)",
    "Sugar",
    "Palm Oil",
    "Invert Sugar",
    "Liquid Glucose",
    "Dextrose",
    "Salt",
    "Raising Agent (INS 503(ii))",
    "Raising Agent (INS 500(ii))",
    "Emulsifier (INS 322)",
    "Artificial Flavouring Substances",
    "Colour (INS 150d)",
  ],
  concerns: [
    rc("Refined Wheat Flour (Maida)", "refined_grain", "significant", 18),
    rc("Sugar", "added_sugar", "significant", 12),
    rc("Palm Oil", "refined_oil", "moderate", 8),
    rc("Invert Sugar", "added_sugar", "moderate", 8),
    rc("Liquid Glucose", "added_sugar", "moderate", 8),
    rc("Dextrose", "added_sugar", "moderate", 8),
  ],
  flags: [
    { nutrient: "Sugar", value_per_100: 24 },
    { nutrient: "Saturated fat", value_per_100: 8 },
    { nutrient: "Total fat", value_per_100: 18 },
    { nutrient: "Sodium", value_per_100: 400, unit: "mg" },
    { nutrient: "Fibre", value_per_100: 1.2 },
  ],
  safety: 78,
  compliance: 82,
  additiveTotal: 4,
});
dump("C", C);
record("C", C);
check("C density 'low' or 'empty'", ["low", "empty"].includes(C.nutritional_analysis!.nutrient_density), C.nutritional_analysis!.nutrient_density);
check("C nutrition 20-30", (C.overall_assessment.nutrition_score ?? 99) >= 20 && (C.overall_assessment.nutrition_score ?? 99) <= 30, `${C.overall_assessment.nutrition_score}`);
check("C verdict 'avoid'", C.verdict === "avoid", C.verdict);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("D — Cola, ~10.6 g sugar per 100 ml");
console.log("EXPECT density 'empty', nutrition <= 30, verdict 'avoid' or 'limit'");
console.log("█".repeat(78));
const D = run({
  name: "Classic Cola",
  netWeight: "750 ml",
  ingredients: ["Carbonated Water", "Sugar", "Acidity Regulator (INS 338)", "Caffeine", "Caramel Colour (INS 150d)"],
  concerns: [rc("Sugar", "added_sugar", "significant", 12)],
  flags: [{ nutrient: "Sugar", value_per_100: 10.6 }],
  safety: 85,
  compliance: 92,
});
dump("D", D);
record("D", D);
check("D density 'empty'", D.nutritional_analysis!.nutrient_density === "empty", D.nutritional_analysis!.nutrient_density);
check("D nutrition <= 30", (D.overall_assessment.nutrition_score ?? 99) <= 30, `${D.overall_assessment.nutrition_score}`);
check("D verdict 'avoid' or 'limit'", D.verdict === "avoid" || D.verdict === "limit", D.verdict);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("E — Plain dahi / curd");
console.log("EXPECT density 'high', nutrition 90+, verdict 'good'");
console.log("█".repeat(78));
const E = run({
  name: "Plain Dahi",
  netWeight: "400 g",
  ingredients: ["Pasteurised Toned Milk", "Milk Solids", "Active Lactic Culture"],
  concerns: [],
  flags: [
    { nutrient: "Sugar", value_per_100: 4.5 },
    { nutrient: "Saturated fat", value_per_100: 1.3 },
    { nutrient: "Sodium", value_per_100: 45, unit: "mg" },
  ],
  safety: 99,
  compliance: 88,
});
dump("E", E);
record("E", E);
check("E density 'high'", E.nutritional_analysis!.nutrient_density === "high", E.nutritional_analysis!.nutrient_density);
check("E nutrition 90+", (E.overall_assessment.nutrition_score ?? 0) >= 90, `${E.overall_assessment.nutrition_score}`);
check("E verdict 'safe'", E.verdict === "safe", E.verdict);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("F — Whole wheat atta");
console.log("EXPECT density 'high', nutrition 90+, verdict 'good'");
console.log("█".repeat(78));
const F = run({
  name: "Whole Wheat Atta",
  netWeight: "1 kg",
  ingredients: ["Whole Wheat"],
  concerns: [],
  flags: [
    { nutrient: "Fibre", value_per_100: 11 },
    { nutrient: "Sugar", value_per_100: 2 },
    { nutrient: "Sodium", value_per_100: 5, unit: "mg" },
  ],
  safety: 98,
  compliance: 85,
});
dump("F", F);
record("F", F);
check("F density 'high'", F.nutritional_analysis!.nutrient_density === "high", F.nutritional_analysis!.nutrient_density);
check("F nutrition 90+", (F.overall_assessment.nutrition_score ?? 0) >= 90, `${F.overall_assessment.nutrition_score}`);
check("F verdict 'safe'", F.verdict === "safe", F.verdict);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "█".repeat(78));
console.log("G — White rice  [SANITY: an ordinary staple, not junk food]");
console.log("EXPECT staple_ingredient, nutrition ~72, NOT 'avoid' — see test-foodtype-recalibration.ts");
console.log("█".repeat(78));
const G = run({
  name: "Sona Masoori Raw Rice",
  netWeight: "5 kg",
  ingredients: ["Polished Rice"],
  concerns: [rc("Polished Rice", "refined_grain", "moderate", 12)],
  safety: 97,
  compliance: 80,
});
dump("G", G);
record("G", G);
check("G classified as a staple ingredient", G.nutritional_analysis!.food_type === "staple_ingredient", `${G.nutritional_analysis!.food_type}`);
check("G nutrition 70-80 (staple scale)", (G.overall_assessment.nutrition_score ?? 0) >= 70 && (G.overall_assessment.nutrition_score ?? 0) <= 80, `${G.overall_assessment.nutrition_score}`);
check("G verdict is NOT 'avoid' / 'limit'", G.verdict === "safe" || G.verdict === "caution", G.verdict);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log("SUMMARY — nutrition_score / nutrient_density / verdict / overall_score");
console.log("=".repeat(78));
for (const r of results) {
  console.log(
    `  ${r.id}  nutrition=${String(r.nutrition).padStart(3)}   density=${r.density.padEnd(8)}   verdict=${r.verdict.padEnd(7)} (${r.wording.padEnd(17)})   overall=${r.overall}`,
  );
}
console.log("=".repeat(78));
console.log(fails === 0 ? "DENSITY RECALIBRATION: ALL CHECKS PASSED" : `DENSITY RECALIBRATION: ${fails} FAILURE(S)`);
process.exitCode = fails ? 1 : 0;
