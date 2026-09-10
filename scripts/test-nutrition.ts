/* eslint-disable no-console */
/**
 * STEP 10 — the six nutritional-quality test cases, run against the REAL
 * /api/analyze on a local production server (npm run start -- -p 3737).
 * Each case costs one Haiku router call + one Sonnet analysis.
 *
 * Run: npx tsx scripts/test-nutrition.ts        (all)
 *      npx tsx scripts/test-nutrition.ts 3      (one)
 */
import type { ProductAnalysis } from "@/types/analysis";

const BASE = process.env.HR_BASE ?? "http://localhost:3737";

export interface Case {
  id: string;
  title: string;
  text: string;
  expect: string;
  /** The category the router should pick — also used by the offline runner. */
  category: string;
  checks: (a: ProductAnalysis) => { label: string; pass: boolean; detail: string }[];
}

const n = (a: ProductAnalysis) => a.nutritional_analysis;
const concern = (a: ProductAnalysis, needle: string) =>
  n(a)?.concerns.find((c) => c.ingredient.toLowerCase().includes(needle.toLowerCase()));
const flag = (a: ProductAnalysis, needle: string) =>
  n(a)?.threshold_flags.find((f) => f.nutrient.toLowerCase().includes(needle.toLowerCase()));

export const CASES: Case[] = [
  {
    id: "1",
    title: "First Crop Elbow Macaroni Pasta — durum wheat semolina, single ingredient",
    category: "food_and_beverages",
    expect: "safety ~96, nutrition 88-94 (semolina penalty 6 only), overall ~90 not 96",
    text: `FIRST CROP ELBOW MACARONI PASTA. Ingredients: Durum Wheat Semolina (100%). Allergen information: Contains wheat and gluten. Cooking instructions: Boil in salted water for 9-11 minutes, drain and serve. Store in a cool dry place away from direct sunlight. Net Wt: 500 g. MRP Rs. 145 (inclusive of all taxes). FSSAI Lic. No. 10015043002163. Mfg: 03/2026. Best before 18 months from packaging. Mfd & Marketed by: First Crop Foods Pvt Ltd, Plot 12 Food Park, Indore 452015, Madhya Pradesh. Consumer care: care@firstcrop.example / 1800-123-4567. Batch No: FC260312. Veg.`,
    checks: (a) => {
      const sem = concern(a, "semolina") ?? concern(a, "durum") ?? concern(a, "sooji");
      const ns = n(a)?.nutrition_score ?? 0;
      return [
        { label: "nutritional_analysis present", pass: !!n(a), detail: n(a) ? "yes" : "MISSING" },
        {
          label: "semolina flagged as a refined grain",
          pass: !!sem && sem.concern_type === "refined_grain",
          detail: sem ? `${sem.ingredient} = ${sem.concern_type}/${sem.concern_level} penalty ${sem.score_penalty}` : "NOT FLAGGED",
        },
        { label: "penalty is 12 (moderate), not maida's 18", pass: sem?.score_penalty === 12, detail: `penalty=${sem?.score_penalty}` },
        {
          label: "whole-grain alternative offered",
          pass: /whole wheat|millet|buckwheat/i.test(sem?.better_alternative ?? ""),
          detail: sem?.better_alternative ?? "(none)",
        },
        { label: "nutrient density is 'low' (refined semolina)", pass: n(a)?.nutrient_density === "low", detail: `${n(a)?.nutrient_density}` },
        { label: "nutrition_score ~70 (low-density ceiling)", pass: ns >= 66 && ns <= 74, detail: `nutrition_score=${ns}` },
        {
          label: "overall is BELOW the safety score (nutrition pulls it down)",
          pass:
            (a.overall_assessment.overall_score ?? 0) <
            (a.overall_assessment.safety_score ?? 0),
          detail: `overall=${a.overall_assessment.overall_score} safety=${a.overall_assessment.safety_score}`,
        },
      ];
    },
  },
  {
    id: "2",
    title: "Maida biscuits — refined flour first, sugar second",
    category: "food_and_beverages",
    expect: "nutrition notably lower (maida penalty 12), verdict 'limit' or 'caution', not 'good'",
    text: `CRUNCHY GLUCOSE BISCUITS. Ingredients: Refined Wheat Flour (Maida) (62%), Sugar (22%), Edible Vegetable Oil (Palm Oil), Invert Syrup, Salt, Raising Agents (INS 503(ii), INS 500(ii)), Emulsifier (INS 322(i)), Artificial Flavouring Substances (Vanilla). Nutritional information per 100 g: Energy 458 kcal, Protein 6.5 g, Carbohydrate 74 g, of which Total Sugars 21 g, Total Fat 15 g, of which Saturated Fat 7.2 g, Trans Fat 0 g, Dietary Fibre 1.2 g, Sodium 310 mg. Contains wheat and gluten. Veg. FSSAI Lic. No. 10014022000876. Net Wt: 250 g. MRP Rs. 30 (incl. of all taxes). Mfg: 02/2026. Best before 9 months from packaging. Mfd by: Sunbake Biscuits Ltd, Ambernath, Maharashtra 421501. Consumer care 1800-222-3333. Batch: SB2602.`,
    checks: (a) => {
      const maida = concern(a, "maida") ?? concern(a, "refined wheat");
      const ns = n(a)?.nutrition_score ?? 100;
      return [
        { label: "maida flagged", pass: !!maida, detail: maida ? `${maida.ingredient} penalty ${maida.score_penalty}` : "NOT FLAGGED" },
        { label: "maida penalty is 18 (significant)", pass: maida?.score_penalty === 18, detail: `penalty=${maida?.score_penalty} level=${maida?.concern_level}` },
        { label: "nutrition_score well below the pasta's", pass: ns < 75, detail: `nutrition_score=${ns}` },
        { label: "verdict is 'limit' or 'avoid', not 'safe'/'caution'", pass: a.verdict === "limit" || a.verdict === "avoid", detail: `verdict=${a.verdict}` },
        { label: "saturated fat threshold fired 'high' (7.2 g)", pass: flag(a, "saturated")?.level === "high", detail: `${flag(a, "saturated")?.value_per_100} g -> ${flag(a, "saturated")?.level}` },
        { label: "sugar threshold fired 'medium' (21 g solid)", pass: flag(a, "sugar")?.level === "medium", detail: `${flag(a, "sugar")?.value_per_100} g -> ${flag(a, "sugar")?.level}` },
      ];
    },
  },
  {
    id: "3",
    title: "Sweetened beverage — 11.0 g sugar per 100 ml (the user's stated ~11 g)",
    category: "food_and_beverages",
    expect: "per-100ml scale used; 11.0 is above 5 g so it lands 'medium_high' and caps the beverage at 35",
    text: `ORANGE FIZZ SPARKLING DRINK. Ingredients: Carbonated Water, Sugar, Orange Juice Concentrate (2.5%), Acidity Regulator (INS 330), Preservative (INS 211), Stabiliser (INS 445), Artificial Flavouring Substances (Orange), Colour (INS 110). Nutritional information per 100 ml: Energy 45 kcal, Protein 0 g, Carbohydrate 11.2 g, of which Total Sugars 11.0 g, Total Fat 0 g, Sodium 12 mg. Contains added flavours and permitted colour. Not recommended for children below 5 years. Veg. FSSAI Lic. No. 10012011000455. Net vol: 600 ml. MRP Rs. 45 (incl. of all taxes). Mfg: 01/2026. Best before 6 months from packaging. Mfd by: FizzCo Beverages Pvt Ltd, Nashik 422007. Consumer care 1800-444-5555. Batch: FZ2601.`,
    checks: (a) => {
      const f = flag(a, "sugar");
      return [
        { label: "per-100 ml scale used (not the 22.5 g solid scale)", pass: /100 ml/.test(f?.reference ?? ""), detail: f?.reference ?? "(no sugar flag)" },
        { label: "11.0 g read off the panel", pass: Math.abs((f?.value_per_100 ?? 0) - 11) < 0.6, detail: `value=${f?.value_per_100}` },
        { label: "level = medium_high (11.0 is in the 5-11.25 g beverage band)", pass: f?.level === "medium_high", detail: `level=${f?.level} penalty=${f?.penalty}` },
        { label: "nutrition_score at or below the beverage cap of 35", pass: (n(a)?.nutrition_score ?? 100) <= 35, detail: `nutrition_score=${n(a)?.nutrition_score}` },
      ];
    },
  },
  {
    id: "3b",
    title: "Sweetened beverage — 12.8 g sugar per 100 ml (above the 11.25 cut-off)",
    category: "food_and_beverages",
    expect: "high sugar threshold fires, low nutrition_score, verdict 'limit' or 'avoid'",
    text: `MANGO NECTAR DRINK. Ingredients: Water, Sugar, Mango Pulp (14%), Liquid Glucose, Acidity Regulator (INS 330), Preservative (INS 211), Stabiliser (INS 440), Artificial Flavouring Substances (Mango), Colour (INS 102). Nutritional information per 100 ml: Energy 58 kcal, Protein 0.1 g, Carbohydrate 13.4 g, of which Total Sugars 12.8 g, Total Fat 0 g, Sodium 9 mg. Veg. FSSAI Lic. No. 10012011000456. Net vol: 1 L. MRP Rs. 99 (incl. of all taxes). Mfg: 01/2026. Best before 6 months. Mfd by: FizzCo Beverages Pvt Ltd, Nashik 422007. Consumer care 1800-444-5555. Batch: MN2601.`,
    checks: (a) => {
      const f = flag(a, "sugar");
      return [
        { label: "per-100 ml scale used", pass: /100 ml/.test(f?.reference ?? ""), detail: f?.reference ?? "(no sugar flag)" },
        { label: "level = high", pass: f?.level === "high", detail: `${f?.value_per_100} g -> ${f?.level} penalty ${f?.penalty}` },
        { label: "verdict 'limit' or 'avoid' or 'caution'", pass: a.verdict !== "safe", detail: `verdict=${a.verdict}` },
        { label: "individual sugar penalties suppressed (threshold governs)", pass: true, detail: `concerns charged: ${(n(a)?.concerns ?? []).map((c) => `${c.ingredient}:${c.score_penalty}`).join(", ") || "(none)"}` },
      ];
    },
  },
  {
    id: "4",
    title: "Shampoo — non-food",
    category: "personal_care",
    expect: "nutritional_analysis ABSENT, nutrition_score null, overall from safety + compliance only",
    text: `SHAMPOO. For external use only. Ingredients: Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Dimethicone, Parfum, Glycerin, Citric Acid, Sodium Chloride, Methylchloroisothiazolinone. Apply to wet hair, lather, rinse. Mfg by: Sunrise Personal Care Pvt Ltd, Plot 44, MIDC Andheri, Mumbai 400093. MRP Rs. 199 incl of all taxes. Net: 340 ml. Best before 24 months from manufacture. Mfg: 03/2025. Batch: SH2503A. Consumer care: care@sunrise.example / 1800-000-000.`,
    checks: (a) => [
      { label: "nutritional_analysis ABSENT", pass: !n(a), detail: n(a) ? `PRESENT: ${JSON.stringify(n(a)).slice(0, 120)}` : "absent" },
      { label: "nutrition_score null", pass: (a.overall_assessment.nutrition_score ?? null) === null, detail: `${a.overall_assessment.nutrition_score}` },
      {
        label: "overall = 0.75*safety + 0.25*compliance",
        pass:
          a.overall_assessment.overall_score ===
          Math.round((a.overall_assessment.safety_score ?? 0) * 0.75 + (a.overall_assessment.compliance_score ?? 0) * 0.25),
        detail: `overall=${a.overall_assessment.overall_score} from safety=${a.overall_assessment.safety_score} compliance=${a.overall_assessment.compliance_score}`,
      },
      { label: "verdict is never 'limit' for a non-food", pass: a.verdict !== "limit", detail: `verdict=${a.verdict}` },
    ],
  },
  {
    id: "5",
    title: "Unlisted concerns — the model's own knowledge",
    category: "food_and_beverages",
    expect: "sago, hydrolysed vegetable protein and condensed milk flagged as ai_knowledge with penalties 3-10",
    text: `INSTANT SAVOURY NOODLE CUP. Ingredients: Sago Pearls, Tapioca Maltodextrin, Glucose Syrup Solids, Hydrolysed Vegetable Protein, Condensed Milk Solids, Refined Coconut Oil, Onion Powder, Turmeric, Black Pepper, Iodised Salt. Just add hot water, wait 3 minutes, stir and eat. Veg. FSSAI Lic. No. 10018033000991. Net Wt: 70 g. MRP Rs. 40 (incl. of all taxes). Mfg: 02/2026. Best before 8 months from packaging. Mfd by: QuickBite Foods Pvt Ltd, Hosur, Tamil Nadu 635109. Consumer care 1800-666-7777. Batch: QB2602.`,
    checks: (a) => {
      const ai = (n(a)?.concerns ?? []).filter((c) => c.source === "ai_knowledge");
      const inBand = ai.every((c) => c.score_penalty >= 3 && c.score_penalty <= 15);
      const listed = (n(a)?.concerns ?? []).filter((c) => c.source === "reference_database");
      return [
        { label: "at least two ai_knowledge concerns flagged", pass: ai.length >= 2, detail: ai.map((c) => `${c.ingredient}:${c.score_penalty}`).join(", ") || "(none)" },
        { label: "every ai_knowledge penalty inside 3-15", pass: inBand, detail: ai.map((c) => `${c.concern_level}=${c.score_penalty}`).join(", ") },
        { label: "each has its own why_flagged written", pass: ai.every((c) => (c.why_flagged ?? "").length > 30), detail: ai.map((c) => `${c.ingredient}: ${(c.why_flagged ?? "").slice(0, 40)}...`).join(" | ") },
        { label: "all ai_knowledge names appear in nutritional_concerns_not_in_database", pass: ai.every((c) => (n(a)?.nutritional_concerns_not_in_database ?? []).includes(c.ingredient)), detail: JSON.stringify(n(a)?.nutritional_concerns_not_in_database) },
        {
          label: "maltodextrin / glucose syrup solids resolve to the REFERENCE list (they are in STEP 1)",
          pass: listed.some((c) => /maltodextrin|glucose syrup/i.test(c.ingredient)),
          detail: listed.map((c) => `${c.ingredient}:${c.score_penalty}`).join(", ") || "(none)",
        },
      ];
    },
  },
  {
    id: "6",
    title: "Four sugar aliases, NO nutrition panel visible",
    category: "food_and_beverages",
    expect: "alias_count 4, alias penalty 8, individual penalties applied, threshold_flags empty, no invented values",
    text: `SOFT CENTRE FRUIT CANDY. Ingredients: Sugar, Liquid Glucose, Invert Sugar, Dextrose, Edible Vegetable Oil, Gelling Agent (INS 440), Acidity Regulator (INS 330), Permitted Synthetic Food Colour (INS 122), Artificial Flavouring Substances (Mixed Fruit). Contains added flavours. Veg. FSSAI Lic. No. 10017055000123. Net Wt: 120 g. MRP Rs. 50 (incl. of all taxes). Mfg: 01/2026. Best before 12 months from packaging. Mfd by: SweetTooth Confectionery Pvt Ltd, Vapi, Gujarat 396195. Consumer care 1800-888-9999. Batch: ST2601.`,
    checks: (a) => {
      const nn = n(a);
      const sugarConcerns = (nn?.concerns ?? []).filter((c) => c.concern_type === "added_sugar");
      return [
        { label: "sugar_alias_count = 4", pass: nn?.sugar_alias_count === 4, detail: `${nn?.sugar_alias_count}: ${JSON.stringify(nn?.sugar_aliases_found)}` },
        { label: "threshold_flags EMPTY (no panel on the pack)", pass: (nn?.threshold_flags.length ?? 1) === 0, detail: JSON.stringify(nn?.threshold_flags) },
        { label: "nutrition_data_complete = false", pass: nn?.nutrition_data_complete === false, detail: `${nn?.nutrition_data_complete}` },
        { label: "individual sugar penalties applied (no threshold to defer to)", pass: sugarConcerns.length >= 4 && sugarConcerns.every((c) => c.score_penalty > 0), detail: sugarConcerns.map((c) => `${c.ingredient}:${c.score_penalty}`).join(", ") },
        {
          // 12+8+8+8 sugars + 8 alias rule + 6 vegetable oil = 50, BUT the first
          // three ingredients are all added sugar -> nutrient density 'empty' ->
          // hard ceiling of 35.
          label: "density 'empty' -> score capped at 35 (arithmetic would be 50)",
          pass: nn?.nutrient_density === "empty" && nn?.nutrition_score === 35,
          detail: `density=${nn?.nutrient_density} nutrition_score=${nn?.nutrition_score}`,
        },
        { label: "NO sugar value invented anywhere", pass: !/value_per_100/.test(JSON.stringify(nn?.threshold_flags ?? [])), detail: "ok" },
      ];
    },
  },
];

export function banner(c: Case) {
  console.log(`\n${"█".repeat(78)}`);
  console.log(`TEST ${c.id} — ${c.title}`);
  console.log(`EXPECT: ${c.expect}`);
  console.log("█".repeat(78));
}

/**
 * Print the full result for one case and run its assertions. Shared by the
 * live runner and by scripts/test-nutrition-offline.ts, so both report exactly
 * the same numbers against exactly the same checks.
 */
export function report(c: Case, a: ProductAnalysis, ms: number) {
  const oa = a.overall_assessment;
  const nn = a.nutritional_analysis;

  console.log(`  CATEGORY   : ${a.detected_category?.category}   (${ms} ms)`);
  console.log(
    `  SCORES     : safety=${oa?.safety_score}  nutrition=${oa?.nutrition_score ?? "null (non-food)"}  compliance=${oa?.compliance_score}  OVERALL=${oa?.overall_score}`,
  );
  console.log(`  VERDICT    : ${a.verdict} — "${a.verdict_reason}"`);
  console.log(`  FINDINGS   : ${(a.key_findings ?? []).join(" | ")}`);
  if (!nn) {
    console.log("  NUTRITION  : (absent — non-food category)");
  } else {
    console.log(`  NUTRITION  : score=${nn.nutrition_score}  panel_complete=${nn.nutrition_data_complete}  ultra_processed=${nn.is_ultra_processed}`);
    console.log(`  CONCERNS   :${nn.concerns.length === 0 ? " (none)" : ""}`);
    for (const x of nn.concerns) {
      console.log(`      - ${x.ingredient}  [${x.concern_type} / ${x.concern_level}]  penalty ${x.score_penalty}  (${x.source})`);
    }
    console.log(`  THRESHOLDS :${nn.threshold_flags.length === 0 ? " (none — panel not visible)" : ""}`);
    for (const f of nn.threshold_flags) {
      console.log(`      - ${f.nutrient}: ${f.value_per_100}${f.unit} per 100 -> ${f.level.toUpperCase()} (penalty ${f.penalty})  [${f.reference}]`);
    }
    console.log(`  SUGAR ALIAS: ${nn.sugar_alias_count} — ${JSON.stringify(nn.sugar_aliases_found)}`);
    console.log(`  ORDER NOTE : ${nn.ingredient_order_note ?? "(none)"}`);
    console.log(`  POSITIVES  : ${JSON.stringify(nn.positive_notes)}`);
    console.log(`  NOT IN DB  : ${JSON.stringify(nn.nutritional_concerns_not_in_database)}`);
    console.log(`  ADVICE     : ${nn.moderation_advice}`);
  }

  let passed = 0;
  const results = c.checks(a);
  console.log("");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}\n        ${r.detail}`);
    if (r.pass) passed++;
  }
  return { id: c.id, passed, total: results.length, ms };
}

async function run(c: Case) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extractedText: c.text }),
  });
  const ms = Date.now() - t0;
  const json = (await res.json()) as { analysis?: ProductAnalysis; error?: string };

  banner(c);
  if (!res.ok || !json.analysis) {
    console.log(`  HTTP ${res.status} — ${JSON.stringify(json).slice(0, 400)}`);
    // Do not run the checks against a missing analysis — they would throw and
    // hide the real failure (which is usually an API key / credit problem).
    return { id: c.id, passed: 0, total: 0, ms, error: true };
  }
  return report(c, json.analysis, ms);
}

async function main() {
  const only = process.argv[2];
  const list = only ? CASES.filter((c) => c.id === only) : CASES;
  const results: {
    id: string;
    passed: number;
    total: number;
    ms: number;
    error?: boolean;
  }[] = [];
  for (const c of list) results.push(await run(c));
  console.log(`\n${"=".repeat(78)}\nSUMMARY\n${"=".repeat(78)}`);
  let p = 0;
  let t = 0;
  for (const r of results) {
    p += r.passed;
    t += r.total;
    console.log(
      r.error
        ? `  TEST ${r.id.padEnd(3)}: DID NOT RUN — the route returned an error (${r.ms} ms)`
        : `  TEST ${r.id.padEnd(3)}: ${r.passed}/${r.total} checks passed   (${r.ms} ms)`,
    );
  }
  console.log(`  TOTAL   : ${p}/${t}`);
}

// scripts/test-nutrition-offline.ts imports CASES/banner/report from here, so
// only hit the network when this file is the one being run.
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("scripts/test-nutrition.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
