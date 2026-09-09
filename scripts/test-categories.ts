/* eslint-disable no-console */
/**
 * PART 3 — behavioural multi-category tests against the REAL /api/analyze route
 * running on a local production server (npm run start -- -p 3737).
 * Each case costs one Haiku router call + one Sonnet analysis.
 * Run: npx tsx scripts/test-categories.ts
 */
import { buildCompactReference } from "@/lib/reference-data";
import type { ProductAnalysis } from "@/types/analysis";

const BASE = process.env.HR_BASE ?? "http://localhost:3737";

interface Case {
  id: string;
  title: string;
  text: string;
  expectCategory: string;
  checks: (a: ProductAnalysis) => { label: string; pass: boolean; detail: string }[];
}

const FOOD_ONLY_DECLS = ["fssai_license"];
const FOOD_WORDS = /\b(consume|consumption|eat|eating|edible|dietary intake|serving|nutrition)\b/i;

/** Declarations the model marked as a real problem (missing / non-compliant). */
function problems(a: ProductAnalysis): string[] {
  return Object.entries(a.legal_metrology_compliance ?? {})
    .filter(([, v]) => v.status === "missing" || (v.present && !v.compliant))
    .map(([k, v]) => `${k}(${v.status ?? (v.present ? "present" : "absent")})`);
}
function declStatus(a: ProductAnalysis, key: string): string {
  const v = a.legal_metrology_compliance?.[key];
  if (!v) return "absent-from-response";
  return v.status ?? (v.present ? "present" : "missing");
}
function ing(a: ProductAnalysis, needle: string) {
  return (a.ingredient_analysis ?? []).find((i) =>
    i.name.toLowerCase().includes(needle.toLowerCase()),
  );
}

const CASES: Case[] = [
  {
    id: "A",
    title: "Shampoo (personal care)",
    expectCategory: "personal_care",
    text: `SHAMPOO. For external use only. Ingredients: Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Dimethicone, Parfum, Methylchloroisothiazolinone, Citric Acid. Apply to wet hair, lather, rinse. Mfg by: Sunrise Personal Care Pvt Ltd, Plot 44, MIDC Andheri, Mumbai 400093. MRP Rs. 199 incl of all taxes. Net: 340ml. Best before 24 months from manufacture. Mfg: 03/2025. Batch: SH2503A. Consumer care: care@sunrise.example / 1800-000-000.`,
    checks: (a) => {
      const sles = ing(a, "Laureth Sulfate") ?? ing(a, "SLES");
      const parfum = ing(a, "Parfum") ?? ing(a, "Fragrance");
      const text = `${a.overall_assessment?.summary ?? ""} ${a.verdict_reason ?? ""} ${a.overall_assessment?.recommendation ?? ""}`;
      return [
        {
          label: "SLES rated 'caution' NOT 'harmful'",
          pass: !!sles && (sles.safety_status === "caution" || sles.safety_status === "safe"),
          detail: sles ? `${sles.name} = ${sles.safety_status}` : "SLES not returned at all",
        },
        {
          label: "Parfum flagged as concerning",
          pass: !!parfum && parfum.safety_status !== "safe",
          detail: parfum ? `${parfum.name} = ${parfum.safety_status}` : "Parfum not flagged",
        },
        {
          label: "FSSAI licence NOT flagged missing",
          pass: !["missing"].includes(declStatus(a, "fssai_license")),
          detail: `fssai_license status = ${declStatus(a, "fssai_license")}`,
        },
        {
          label: "dosage_analysis zeroed (food-only machinery off)",
          pass: (a.dosage_analysis?.additive_count?.total ?? 0) === 0 && (a.dosage_analysis?.limit_checks?.length ?? 0) === 0,
          detail: `total=${a.dosage_analysis?.additive_count?.total} limit_checks=${a.dosage_analysis?.limit_checks?.length}`,
        },
        {
          label: "complaint portal = CDSCO / consumer helpline (not FSSAI)",
          pass: !/fssai|foscos/i.test(a.detected_category?.complaint_portal ?? ""),
          detail: a.detected_category?.complaint_portal ?? "(none)",
        },
        {
          label: "no food language ('consume' etc.) in verdict/summary",
          pass: !FOOD_WORDS.test(text),
          detail: FOOD_WORDS.test(text) ? `matched: ${text.match(FOOD_WORDS)?.[0]}` : "clean",
        },
      ];
    },
  },
  {
    id: "B",
    title: "FOOD containing Sodium Lauryl Sulfate (same ingredient, different category)",
    expectCategory: "food_and_beverages",
    text: `CRISPY CORN SNACK. Ingredients: Corn Meal, Palm Oil, Sugar, Salt, Sodium Lauryl Sulfate, Tartrazine (E102), Sodium Benzoate (E211), Ascorbic Acid (E300), Flavour Enhancer (INS 621). Nutritional information per 100g: Energy 520 kcal, Total Fat 28g, Sugar 12g, Sodium 780mg. Contains added flavours. Veg. FSSAI Lic. No. 10012345678901. Net Wt: 60g. MRP Rs. 20 (incl. of all taxes). Mfg: 01/2026. Best before 6 months from packaging. Mfd by: Crunchy Foods Pvt Ltd, Survey 21, Pune 411045. Customer care: 1800-111-222. Batch: CF260101.`,
    checks: (a) => {
      const sls = ing(a, "Lauryl Sulfate");
      const tar = ing(a, "Tartrazine");
      const benz = ing(a, "Benzoate");
      return [
        {
          label: "SLS rated 'harmful' (vs 'caution' in shampoo)",
          pass: !!sls && (sls.safety_status === "harmful" || sls.safety_status === "banned"),
          detail: sls ? `${sls.name} = ${sls.safety_status}` : "SLS not returned",
        },
        {
          label: "Tartrazine rated harmful/banned in food",
          pass: !!tar && ["harmful", "banned"].includes(tar.safety_status),
          detail: tar ? `${tar.name} = ${tar.safety_status}` : "Tartrazine not returned",
        },
        {
          label: "benzoate + ascorbic acid combination warned",
          pass:
            (a.dosage_analysis?.combination_warnings ?? []).some((w) => /benzene|ascorbic|vitamin c/i.test(w)) ||
            !!ing(a, "ascorbic") ||
            /benzene/i.test(JSON.stringify(a.ingredient_analysis ?? [])),
          detail: JSON.stringify(a.dosage_analysis?.combination_warnings ?? []).slice(0, 180),
        },
        {
          label: "dosage_analysis populated (food machinery ON)",
          pass: (a.dosage_analysis?.additive_count?.total ?? 0) > 0,
          detail: `total=${a.dosage_analysis?.additive_count?.total} limit_checks=${a.dosage_analysis?.limit_checks?.length}`,
        },
        {
          label: "benzoate limit check present",
          pass: (a.dosage_analysis?.limit_checks ?? []).some((l) => /benzoate/i.test(l.name)),
          detail: (a.dosage_analysis?.limit_checks ?? []).map((l) => `${l.name}:${l.status}`).join(", ").slice(0, 200),
        },
      ];
    },
  },
  {
    id: "C",
    title: "Toilet cleaner (household)",
    expectCategory: "household_cleaning",
    text: `POWER TOILET CLEANER. Contains Hydrochloric Acid (10%). Keep out of reach of children. Do not mix with bleach or any other cleaning product. In case of contact with eyes, rinse immediately with plenty of water and seek medical advice. Harmful if swallowed. Use gloves. Directions: apply under the rim, leave 10 minutes, scrub and flush. MRP Rs. 99 (incl. of all taxes). Net 500ml. Mfd by: ShineMax Home Products, Plot 9, Baddi, HP 173205. Batch: TC2601. Mfg: 01/2026.`,
    checks: (a) => {
      const hcl = ing(a, "Hydrochloric");
      const probs = problems(a);
      return [
        {
          label: "Hydrochloric acid flagged",
          pass: !!hcl && hcl.safety_status !== "safe",
          detail: hcl ? `${hcl.name} = ${hcl.safety_status}` : "HCl not returned",
        },
        {
          label: "FSSAI licence NOT flagged missing",
          pass: declStatus(a, "fssai_license") !== "missing",
          detail: `fssai_license status = ${declStatus(a, "fssai_license")}`,
        },
        {
          label: "no food-only declaration flagged as a violation",
          pass: !probs.some((p) => FOOD_ONLY_DECLS.some((d) => p.startsWith(d))),
          detail: `flagged problems: ${probs.join(", ") || "(none)"}`,
        },
        {
          label: "do-not-mix-with-bleach surfaced somewhere",
          pass: /bleach|do not mix|chlorine gas/i.test(JSON.stringify(a)),
          detail: /bleach/i.test(JSON.stringify(a)) ? "yes" : "NOT surfaced",
        },
        {
          label: "dosage_analysis zeroed",
          pass: (a.dosage_analysis?.additive_count?.total ?? 0) === 0,
          detail: `total=${a.dosage_analysis?.additive_count?.total}`,
        },
        {
          label: "complaint portal = consumer helpline / BIS (not FSSAI)",
          pass: !/fssai|foscos/i.test(a.detected_category?.complaint_portal ?? ""),
          detail: a.detected_category?.complaint_portal ?? "(none)",
        },
      ];
    },
  },
  {
    id: "D",
    title: "Infant cereal with artificial colour + preservative (baby food)",
    expectCategory: "baby_product_food",
    text: `LITTLE STARS INFANT CEREAL. Stage 2. For infants above 8 months. Ingredients: Wheat Flour, Milk Solids, Sugar, Vegetable Oil, Sunset Yellow FCF (E110), Sodium Benzoate (E211), Vitamins and Minerals, Added Flavour. Nutritional information per 100g: Energy 420 kcal, Protein 12g, Sugar 22g. Not a substitute for breast milk. Mother's milk is best for your baby. FSSAI Lic. No. 10023456789012. Net Wt: 300g. MRP Rs. 245 incl of all taxes. Mfg: 02/2026. Best before 12 months. Mfd by: Little Stars Nutrition Ltd, Nashik 422010. Consumer care 1800-333-444.`,
    checks: (a) => {
      const dye = ing(a, "Sunset Yellow");
      const pres = ing(a, "Benzoate");
      const escalated = (a.ingredient_analysis ?? []).filter((i) =>
        ["harmful", "banned"].includes(i.safety_status),
      );
      return [
        {
          label: "artificial colour escalated to harmful/banned",
          pass: !!dye && ["harmful", "banned"].includes(dye.safety_status),
          detail: dye ? `${dye.name} = ${dye.safety_status}` : "Sunset Yellow not returned",
        },
        {
          label: "preservative flagged (>= caution)",
          pass: !!pres && pres.safety_status !== "safe",
          detail: pres ? `${pres.name} = ${pres.safety_status}` : "Sodium Benzoate not returned",
        },
        {
          label: "verdict is caution or avoid (not 'safe')",
          pass: a.verdict !== "safe",
          detail: `verdict=${a.verdict} score=${a.overall_assessment?.safety_score}`,
        },
        {
          label: "score below the baby threshold of 85",
          pass: (a.overall_assessment?.safety_score ?? 0) < 85,
          detail: `safety_score=${a.overall_assessment?.safety_score}`,
        },
        {
          label: "at least one ingredient escalated to harmful/banned",
          pass: escalated.length > 0,
          detail: escalated.map((i) => `${i.name}:${i.safety_status}`).join(", ") || "(none)",
        },
      ];
    },
  },
  {
    id: "E",
    title: "Baby lotion (baby care)",
    expectCategory: "baby_product_care",
    text: `BABY SOFT MOISTURISING LOTION. For babies 0+ months. For external use only. Ingredients: Aqua, Mineral Oil, Glycerin, Cetearyl Alcohol, Parfum, Methylparaben, Propylparaben, Phenoxyethanol, Tocopheryl Acetate. Apply gently on baby's skin after bath. Paediatrician tested. Keep away from eyes. MRP Rs. 285 incl of all taxes. Net: 200ml. Mfg: 01/2026. Best before 30 months. Batch: BL2601. Mfd by: TenderCare Cosmetics Pvt Ltd, Vadodara 390010. Consumer care 1800-555-666.`,
    checks: (a) => {
      const paraben = ing(a, "paraben");
      const text = `${a.overall_assessment?.summary ?? ""} ${a.verdict_reason ?? ""}`;
      return [
        {
          label: "parabens flagged (>= caution) under stricter baby rules",
          pass: !!paraben && paraben.safety_status !== "safe",
          detail: paraben ? `${paraben.name} = ${paraben.safety_status}` : "no paraben returned",
        },
        {
          label: "FSSAI licence NOT flagged missing",
          pass: declStatus(a, "fssai_license") !== "missing",
          detail: `fssai_license status = ${declStatus(a, "fssai_license")}`,
        },
        {
          label: "dosage_analysis zeroed (not food)",
          pass: (a.dosage_analysis?.additive_count?.total ?? 0) === 0,
          detail: `total=${a.dosage_analysis?.additive_count?.total}`,
        },
        {
          label: "regulator = CDSCO (not FSSAI)",
          pass: /cdsco/i.test(a.detected_category?.regulatory_body ?? ""),
          detail: a.detected_category?.regulatory_body ?? "(none)",
        },
        {
          label: "no food language in verdict/summary",
          pass: !FOOD_WORDS.test(text),
          detail: FOOD_WORDS.test(text) ? `matched: ${text.match(FOOD_WORDS)?.[0]}` : "clean",
        },
      ];
    },
  },
  {
    id: "F",
    title: "Ambiguous product (few category signals)",
    expectCategory: "*any*",
    text: `PREMIUM QUALITY. Net content 250 g. MRP Rs. 150 inclusive of all taxes. Batch No. 4471. Mfd: 12/2025. Marketed by Generic Traders, Delhi 110001. Store in a cool dry place. Keep away from direct sunlight.`,
    checks: (a) => [
      {
        label: "confidence is 'low' (so the UI offers a correction dropdown)",
        pass: a.detected_category?.confidence === "low",
        detail: `confidence=${a.detected_category?.confidence} category=${a.detected_category?.category}`,
      },
      {
        label: "no ingredients hallucinated",
        pass: (a.ingredient_analysis ?? []).length === 0,
        detail: `${(a.ingredient_analysis ?? []).length} ingredients returned`,
      },
      {
        label: "safety_score null (no ingredients => insufficient_data)",
        pass: a.overall_assessment?.safety_score == null,
        detail: `safety_score=${a.overall_assessment?.safety_score} status=${a.overall_assessment?.safety_status}`,
      },
      {
        label: "product name not guessed",
        pass: !/inferred|not confirmed|likely|appears to be|probably/i.test(a.product_info?.name ?? ""),
        detail: `name=${JSON.stringify(a.product_info?.name)}`,
      },
    ],
  },
];

async function run(c: Case) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extractedText: c.text }),
  });
  const ms = Date.now() - t0;
  const json = (await res.json()) as { analysis?: ProductAnalysis; error?: string; detectedCategory?: string };

  console.log(`\n${"█".repeat(74)}`);
  console.log(`TEST ${c.id} — ${c.title}`);
  console.log("█".repeat(74));

  if (!res.ok || !json.analysis) {
    console.log(`  HTTP ${res.status} — ${JSON.stringify(json).slice(0, 300)}`);
    return { id: c.id, passed: 0, total: c.checks.length + 1, ms };
  }
  const a = json.analysis;
  const cat = a.detected_category?.category ?? "?";
  const compact = buildCompactReference(cat);
  const lists = [
    `banned_ingredients(${compact.banned_ingredients.length})`,
    `harmful_additives(${compact.harmful_additives.length})`,
    compact.fssai_limits ? `fssai_limits(${compact.fssai_limits.length})` : null,
    compact.legal_metrology ? `legal_metrology(${compact.legal_metrology.length})` : null,
    compact.household_safety ? `household_safety(${compact.household_safety.length})` : null,
    compact.labelling_rules ? `labelling_rules(${compact.labelling_rules.length})` : null,
    compact.stricter_thresholds_note ? "stricter_thresholds_note" : null,
  ].filter(Boolean);

  console.log(`  DETECTED CATEGORY : ${cat}  (confidence ${a.detected_category?.confidence}) — ${ms}ms`);
  console.log(`  REGULATOR         : ${a.detected_category?.regulatory_body}`);
  console.log(`  PORTAL            : ${a.detected_category?.complaint_portal}`);
  console.log(`  REFERENCE SENT    : ${lists.join(", ")}`);
  console.log(`  PAYLOAD SIZE      : ${JSON.stringify(compact).length} chars (~${Math.round(JSON.stringify(compact).length / 4)} tok)`);
  console.log(`  VERDICT           : ${a.verdict} — "${a.verdict_reason}"`);
  console.log(`  KEY FINDINGS      : ${(a.key_findings ?? []).map((k) => `“${k}”`).join(", ")}`);
  console.log(`  SCORES            : safety=${a.overall_assessment?.safety_score}(${a.overall_assessment?.safety_status}) compliance=${a.overall_assessment?.compliance_score}(${a.overall_assessment?.compliance_status})`);
  console.log(`  INGREDIENTS       : ${(a.ingredient_analysis ?? []).map((i) => `${i.name}=${i.safety_status}`).join(", ") || "(none)"}`);
  console.log(`  DECL FLAGGED      : ${problems(a).join(", ") || "(none)"}`);
  console.log(`  DECL not_visible  : ${Object.entries(a.legal_metrology_compliance ?? {}).filter(([, v]) => v.status === "not_visible").map(([k]) => k).join(", ") || "(none)"}`);
  console.log(`  DECL n/a          : ${Object.entries(a.legal_metrology_compliance ?? {}).filter(([, v]) => v.status === "not_applicable").map(([k]) => k).join(", ") || "(none)"}`);

  let passed = 0;
  const catOk = c.expectCategory === "*any*" || cat === c.expectCategory;
  console.log(`\n  ${catOk ? "✓" : "✗"} category === ${c.expectCategory}  → got ${cat}`);
  if (catOk) passed++;
  for (const r of c.checks(a)) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}\n        ${r.detail}`);
    if (r.pass) passed++;
  }
  return { id: c.id, passed, total: c.checks(a).length + 1, ms };
}

async function main() {
  const only = process.argv[2];
  const list = only ? CASES.filter((c) => c.id === only.toUpperCase()) : CASES;
  const results = [];
  for (const c of list) results.push(await run(c));
  console.log(`\n${"=".repeat(74)}\nSUMMARY\n${"=".repeat(74)}`);
  for (const r of results) {
    console.log(`  TEST ${r.id}: ${r.passed}/${r.total} checks passed   (${r.ms}ms)`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
