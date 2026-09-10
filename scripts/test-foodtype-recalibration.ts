/* eslint-disable no-console */
/**
 * 2026 FOOD-TYPE RESTRUCTURE — the fourteen acceptance cases.
 *
 * Pure-local: a hand-written model reply is run through the real
 * normalizeAnalysis -> enrichAnalysis path. No API calls. No fixture supplies
 * food_type or nutrient_density, so this also exercises the LOCAL classifiers.
 *
 * Run: npx tsx scripts/test-foodtype-recalibration.ts
 */
import { enrichAnalysis } from "@/lib/enrich-analysis";
import { normalizeAnalysis } from "@/lib/analysis-normalize";
import type { ProductAnalysis } from "@/types/analysis";

let fails = 0;
const problems: string[] = [];
const check = (id: string, label: string, pass: boolean, detail: string) => {
  if (!pass) {
    fails++;
    problems.push(`${id}: ${label} — ${detail}`);
  }
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}\n         ${detail}`);
};

interface Build {
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
      detected_category: { category: "food_and_beverages" },
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
        nutrition_score: 50,
        nutrition_data_complete: true,
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
    { category: "food_and_beverages" },
  );
}

/** Verdict display wording, mirroring app/scan/page.tsx verdictDisplay(). */
function wording(a: ProductAnalysis): string {
  const n = a.nutritional_analysis;
  const s = a.overall_assessment?.nutrition_score;
  if (!n || s == null) return a.verdict;
  if (n.food_type === "staple_ingredient") {
    const sparing =
      n.nutrient_density === "empty" ||
      /\b(oil|ghee|sugar|jaggery|gur|salt|namak|honey|syrup)\b/i.test(a.product_info?.name ?? "");
    if (sparing) return "Use sparingly";
    return s >= 75 ? "Good staple" : "Fine staple — a less refined option is more nutritious";
  }
  if (a.verdict === "safe") return s >= 76 ? "Good choice" : "Reasonable choice";
  return a.verdict;
}

const rows: string[] = [];
function report(id: string, a: ProductAnalysis) {
  const n = a.nutritional_analysis!;
  const oa = a.overall_assessment;
  console.log(
    `   food_type=${n.food_type}  density=${n.nutrient_density}  nutrition=${n.nutrition_score}  verdict=${a.verdict}  overall=${oa.overall_score}`,
  );
  console.log(`   positives: ${n.positive_notes.join(" | ") || "(none)"}`);
  console.log(`   concerns : ${n.concerns.map((c) => `${c.ingredient}:${c.concern_level}/${c.score_penalty}`).join(", ") || "(none)"}`);
  console.log(`   advice   : ${n.moderation_advice}`);
  rows.push(
    `  ${id.padEnd(2)} ${(a.product_info?.name ?? "").padEnd(30)} type=${n.food_type.padEnd(20)} density=${n.nutrient_density.padEnd(8)} score=${String(n.nutrition_score).padStart(3)}  verdict=${a.verdict.padEnd(7)} (${wording(a)})`,
  );
}

function head(id: string, title: string, expect: string) {
  console.log("\n" + "█".repeat(78));
  console.log(`${id} — ${title}`);
  console.log(`EXPECT ${expect}`);
  console.log("█".repeat(78));
}

// ═══════════════════════════ STAPLES ═══════════════════════════
head("A", "Whole wheat atta", "92-98, 'Good staple', food_type staple");
const A = run({
  name: "Whole Wheat Atta",
  netWeight: "1 kg",
  ingredients: ["Whole Wheat"],
  flags: [
    { nutrient: "Fibre", value_per_100: 11 },
    { nutrient: "Protein", value_per_100: 12 },
  ],
  safety: 98,
  compliance: 85,
});
report("A", A);
check("A", "food_type staple_ingredient", A.nutritional_analysis!.food_type === "staple_ingredient", A.nutritional_analysis!.food_type);
check("A", "nutrition 92-98", inRange(A, 92, 98), score(A));
check("A", "verdict safe / 'Good staple'", A.verdict === "safe" && wording(A) === "Good staple", `${A.verdict} / ${wording(A)}`);

head("B", "Brown rice", "88-95, 'Good staple'");
const B = run({
  name: "Organic Brown Rice",
  netWeight: "1 kg",
  ingredients: ["Brown Rice"],
  flags: [
    { nutrient: "Fibre", value_per_100: 3.5 },
    { nutrient: "Protein", value_per_100: 8 },
  ],
  safety: 97,
  compliance: 82,
});
report("B", B);
check("B", "food_type staple", B.nutritional_analysis!.food_type === "staple_ingredient", B.nutritional_analysis!.food_type);
check("B", "nutrition 88-95", inRange(B, 88, 95), score(B));
check("B", "verdict safe", B.verdict === "safe", B.verdict);

head("C", "White rice", "72-80, 'Fine staple', NOT unhealthy, NOT avoid");
const C = run({
  name: "Sona Masoori Raw Rice",
  netWeight: "5 kg",
  ingredients: ["Polished Rice"],
  concerns: [rc("Polished Rice", "refined_grain", "moderate", 12)],
  flags: [{ nutrient: "Protein", value_per_100: 7 }],
  safety: 97,
  compliance: 80,
});
report("C", C);
check("C", "food_type staple", C.nutritional_analysis!.food_type === "staple_ingredient", C.nutritional_analysis!.food_type);
check("C", "nutrition 72-80", inRange(C, 72, 80), score(C));
check("C", "verdict NOT avoid/limit", C.verdict === "safe" || C.verdict === "caution", C.verdict);
check("C", "reads as 'Fine staple'", wording(C).startsWith("Fine staple"), wording(C));

head("D", "Durum wheat semolina pasta", "72-80, similar band to white rice");
const D = run({
  name: "Elbow Macaroni Pasta",
  netWeight: "500 g",
  ingredients: ["Durum Wheat Semolina"],
  concerns: [rc("Durum Wheat Semolina", "refined_grain", "moderate", 12)],
  flags: [{ nutrient: "Protein", value_per_100: 13 }],
  safety: 96,
  compliance: 82,
});
report("D", D);
check("D", "food_type staple", D.nutritional_analysis!.food_type === "staple_ingredient", D.nutritional_analysis!.food_type);
check("D", "nutrition 72-80", inRange(D, 72, 80), score(D));
check("D", "within 8 pts of white rice", Math.abs((score2(D)) - score2(C)) <= 8, `D=${score2(D)} C=${score2(C)}`);

head("E", "Maida sold as flour", "62-70, 'Fine staple' + whole-wheat suggestion");
const E = run({
  name: "Fine Maida Flour",
  netWeight: "1 kg",
  ingredients: ["Refined Wheat Flour"],
  concerns: [rc("Refined Wheat Flour", "refined_grain", "significant", 18)],
  flags: [{ nutrient: "Protein", value_per_100: 10 }],
  safety: 95,
  compliance: 80,
});
report("E", E);
check("E", "food_type staple", E.nutritional_analysis!.food_type === "staple_ingredient", E.nutritional_analysis!.food_type);
check("E", "nutrition 62-70", inRange(E, 62, 70), score(E));
check("E", "verdict NOT avoid/limit", E.verdict === "safe" || E.verdict === "caution", E.verdict);

head("F", "Toor / chana dal", "92-98 (legume + protein + fibre bonuses)");
const F = run({
  name: "Toor Dal (Split Pigeon Peas)",
  netWeight: "1 kg",
  ingredients: ["Toor Dal"],
  flags: [
    { nutrient: "Protein", value_per_100: 22 },
    { nutrient: "Fibre", value_per_100: 15 },
  ],
  safety: 97,
  compliance: 82,
});
report("F", F);
check("F", "food_type staple", F.nutritional_analysis!.food_type === "staple_ingredient", F.nutritional_analysis!.food_type);
check("F", "nutrition 92-98", inRange(F, 92, 98), score(F));
check("F", "legume + protein bonuses fired", F.nutritional_analysis!.positive_notes.some((p) => /legume|pulse/i.test(p)) && F.nutritional_analysis!.positive_notes.some((p) => /protein/i.test(p)), F.nutritional_analysis!.positive_notes.join(" | "));

head("G", "Cold-pressed mustard oil", "60-70, 'Use sparingly'");
const G = run({
  name: "Cold-pressed Mustard Oil",
  netWeight: "1 L",
  ingredients: ["Mustard Oil"],
  flags: [
    { nutrient: "Total fat", value_per_100: 100 },
    { nutrient: "Saturated fat", value_per_100: 12 },
  ],
  safety: 92,
  compliance: 80,
});
report("G", G);
check("G", "food_type staple", G.nutritional_analysis!.food_type === "staple_ingredient", G.nutritional_analysis!.food_type);
check("G", "nutrition 60-70", inRange(G, 60, 70), score(G));
check("G", "reads as 'Use sparingly'", wording(G) === "Use sparingly", wording(G));

head("H", "Plain sugar", "capped at 40, 'Use sparingly'");
const H = run({
  name: "Sugar",
  netWeight: "1 kg",
  ingredients: ["Sugar"],
  concerns: [rc("Sugar", "added_sugar", "significant", 12)],
  safety: 95,
  compliance: 80,
});
report("H", H);
check("H", "food_type staple", H.nutritional_analysis!.food_type === "staple_ingredient", H.nutritional_analysis!.food_type);
check("H", "nutrition <= 40", (score2(H)) <= 40, score(H));
check("H", "reads as 'Use sparingly'", wording(H) === "Use sparingly", wording(H));

// ═══════════════════════ MINIMALLY PROCESSED ═══════════════════════
head("I", "Plain dahi, no added sugar", "90+, minimally_processed");
const I = run({
  name: "Plain Dahi",
  netWeight: "400 g",
  ingredients: ["Pasteurised Toned Milk", "Milk Solids", "Active Lactic Culture"],
  flags: [
    { nutrient: "Sugar", value_per_100: 4.5 },
    { nutrient: "Saturated fat", value_per_100: 1.3 },
    { nutrient: "Protein", value_per_100: 3.5 },
    { nutrient: "Sodium", value_per_100: 45, unit: "mg" },
  ],
  safety: 99,
  compliance: 88,
});
report("I", I);
check("I", "food_type minimally_processed", I.nutritional_analysis!.food_type === "minimally_processed", I.nutritional_analysis!.food_type);
check("I", "nutrition 90+", score2(I) >= 90, score(I));
check("I", "verdict safe", I.verdict === "safe", I.verdict);

head("J", "Roasted makhana / plain roasted nuts", "85+, minimally_processed");
const J = run({
  name: "Roasted Makhana",
  netWeight: "100 g",
  ingredients: ["Fox Nuts (Makhana)", "Rock Salt"],
  flags: [
    { nutrient: "Protein", value_per_100: 9 },
    { nutrient: "Fibre", value_per_100: 7 },
    { nutrient: "Sodium", value_per_100: 220, unit: "mg" },
  ],
  safety: 95,
  compliance: 82,
});
report("J", J);
check("J", "food_type minimally_processed", J.nutritional_analysis!.food_type === "minimally_processed", J.nutritional_analysis!.food_type);
check("J", "nutrition 85+", score2(J) >= 85, score(J));

// ═══════════════════════ PROCESSED PRODUCTS ═══════════════════════
head("K", "Maida biscuits, palm oil, sugar aliases, ultra-processed", "20-32, 'avoid'");
const K = run({
  name: "Cream Biscuits",
  netWeight: "250 g",
  ingredients: [
    "Refined Wheat Flour (Maida)", "Sugar", "Palm Oil", "Invert Sugar", "Liquid Glucose",
    "Dextrose", "Salt", "Raising Agent (INS 503(ii))", "Raising Agent (INS 500(ii))",
    "Emulsifier (INS 322)", "Artificial Flavouring Substances", "Colour (INS 150d)",
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
  ],
  safety: 78,
  compliance: 82,
  additiveTotal: 4,
});
report("K", K);
check("K", "food_type processed_product", K.nutritional_analysis!.food_type === "processed_product", K.nutritional_analysis!.food_type);
check("K", "nutrition 20-32", inRange(K, 20, 32), score(K));
check("K", "verdict 'avoid'", K.verdict === "avoid", K.verdict);

head("L", "Cola ~10.6 g sugar / 100 ml", "<= 30, 'avoid' or 'limit'");
const L = run({
  name: "Classic Cola",
  netWeight: "750 ml",
  ingredients: ["Carbonated Water", "Sugar", "Acidity Regulator (INS 338)", "Caffeine", "Caramel Colour (INS 150d)"],
  concerns: [rc("Sugar", "added_sugar", "significant", 12)],
  flags: [{ nutrient: "Sugar", value_per_100: 10.6 }],
  safety: 85,
  compliance: 92,
});
report("L", L);
check("L", "food_type processed_product", L.nutritional_analysis!.food_type === "processed_product", L.nutritional_analysis!.food_type);
check("L", "nutrition <= 30", score2(L) <= 30, score(L));
check("L", "verdict 'avoid' or 'limit'", L.verdict === "avoid" || L.verdict === "limit", L.verdict);

head("M", "Instant noodles — maida, palm oil, high sodium", "25-40, 'limit' or 'avoid'");
const M = run({
  name: "Masala Instant Noodles",
  netWeight: "70 g",
  ingredients: [
    "Refined Wheat Flour (Maida)", "Palm Oil", "Salt", "Wheat Gluten", "Thickener (INS 508)",
    "Acidity Regulator (INS 501)", "Flavour Enhancer (INS 621)", "Onion Powder", "Garlic Powder",
    "Sugar", "Hydrolysed Vegetable Protein", "Colour (INS 150d)",
  ],
  concerns: [
    rc("Refined Wheat Flour (Maida)", "refined_grain", "significant", 18),
    rc("Palm Oil", "refined_oil", "moderate", 8),
    rc("Sugar", "added_sugar", "moderate", 8),
  ],
  flags: [
    { nutrient: "Sodium", value_per_100: 1400, unit: "mg" },
    { nutrient: "Saturated fat", value_per_100: 9 },
    { nutrient: "Total fat", value_per_100: 18 },
  ],
  safety: 74,
  compliance: 80,
  additiveTotal: 5,
});
report("M", M);
check("M", "food_type processed_product", M.nutritional_analysis!.food_type === "processed_product", M.nutritional_analysis!.food_type);
check("M", "nutrition 25-40", inRange(M, 25, 40), score(M));
check("M", "verdict 'limit' or 'avoid'", M.verdict === "limit" || M.verdict === "avoid", M.verdict);

head("N", "Whole wheat digestive biscuit, moderate sugar", "55-70, 'caution'");
const N = run({
  name: "Digestive Whole Wheat Biscuits",
  netWeight: "200 g",
  ingredients: [
    "Whole Wheat Flour", "Sugar", "Edible Vegetable Oil (Palm)", "Invert Syrup",
    "Raising Agents (INS 500(ii), INS 503(ii))", "Salt", "Emulsifier (INS 322)",
  ],
  concerns: [
    rc("Sugar", "added_sugar", "moderate", 8),
    rc("Edible Vegetable Oil (Palm)", "refined_oil", "moderate", 8),
  ],
  flags: [
    { nutrient: "Sugar", value_per_100: 20 },
    { nutrient: "Saturated fat", value_per_100: 4 },
    { nutrient: "Total fat", value_per_100: 16 },
    { nutrient: "Fibre", value_per_100: 5 },
  ],
  safety: 82,
  compliance: 80,
  additiveTotal: 2,
});
report("N", N);
check("N", "food_type processed_product", N.nutritional_analysis!.food_type === "processed_product", N.nutritional_analysis!.food_type);
check("N", "nutrition 55-70", inRange(N, 55, 70), score(N));
check("N", "verdict 'caution'", N.verdict === "caution", N.verdict);

// ═══════════════════════ CRITICAL CHECKS ═══════════════════════
console.log("\n" + "═".repeat(78));
console.log("CRITICAL CHECKS");
console.log("═".repeat(78));
check("crit", "C and D land in a similar band (<= 8 apart)", Math.abs(score2(C) - score2(D)) <= 8, `C=${score2(C)} D=${score2(D)}`);
check("crit", "A and B clearly outscore C and D (min gap 12)", Math.min(score2(A), score2(B)) - Math.max(score2(C), score2(D)) >= 12, `A=${score2(A)} B=${score2(B)} vs C=${score2(C)} D=${score2(D)}`);
check("crit", "F (dal) scores near the top (>= 90)", score2(F) >= 90, `F=${score2(F)}`);
check("crit", "K, L, M all stay low (<= 40)", score2(K) <= 40 && score2(L) <= 40 && score2(M) <= 40, `K=${score2(K)} L=${score2(L)} M=${score2(M)}`);
const stapleScores: [string, number][] = [["A", score2(A)], ["B", score2(B)], ["C", score2(C)], ["D", score2(D)], ["E", score2(E)], ["F", score2(F)], ["G", score2(G)]];
const belowFloor = stapleScores.filter(([, s]) => s < 60);
check("crit", "no staple except sugar/oil scores below 60", belowFloor.length === 0, belowFloor.map(([id, s]) => `${id}=${s}`).join(", ") || "all >= 60");

console.log("\n" + "═".repeat(78));
console.log("SUMMARY — food_type / nutrient_density / nutrition_score / verdict");
console.log("═".repeat(78));
for (const r of rows) console.log(r);
console.log("═".repeat(78));
if (fails === 0) {
  console.log("FOOD-TYPE RESTRUCTURE: ALL CHECKS PASSED");
} else {
  console.log(`FOOD-TYPE RESTRUCTURE: ${fails} FAILURE(S)`);
  for (const p of problems) console.log(`  - ${p}`);
}
process.exitCode = fails ? 1 : 0;

function score2(a: ProductAnalysis): number {
  return a.overall_assessment?.nutrition_score ?? 0;
}
function score(a: ProductAnalysis): string {
  return `nutrition=${a.overall_assessment?.nutrition_score}`;
}
function inRange(a: ProductAnalysis, lo: number, hi: number): boolean {
  const s = score2(a);
  return s >= lo && s <= hi;
}
