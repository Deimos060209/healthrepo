/* eslint-disable no-console */
import type { ProductAnalysis } from "@/types/analysis";
const BASE = "http://localhost:3737";
const text = `SWEET DELIGHT DESSERT MIX. Ingredients: Wheat Flour, High Fructose Corn Syrup, Almond Extract, Aspartame (E951), Tartrazine (E102), Milk Solids, Salt, Artificial Flavour. Contains: Tree Nuts, Milk. Phenylketonurics: contains phenylalanine. Nutritional info per 100g: Energy 480 kcal, Sugar 44g, Protein 6g. Veg. FSSAI Lic. No. 10099887766554. Net Wt: 200g. MRP Rs. 120 incl of all taxes. Mfg 01/2026. Best before 9 months. Mfd by Sweet Delight Foods Pvt Ltd, Indore 452001. Consumer care 1800-777-888. Batch SD2601.`;
const profile = {
  allergies: ["Tree nuts (almonds, cashews, walnuts)"],
  dietary_preferences: ["No artificial colours"],
  health_conditions: ["Type 2 diabetes", "Phenylketonuria (PKU)"],
  custom_avoid_ingredients: [],
};
(async () => {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extractedText: text, userHealthProfile: profile }),
  });
  const j = await res.json() as { analysis?: ProductAnalysis; error?: string };
  if (!j.analysis) { console.log("HTTP", res.status, JSON.stringify(j).slice(0,300)); return; }
  const a = j.analysis;
  const flags = [
    ...(a.personal_alerts ?? []).map(f => ({ ing: f.ingredient ?? "(product-level)", ...f })),
    ...(a.ingredient_analysis ?? []).flatMap(i => (i.personal_flags ?? []).map(f => ({ ing: f.ingredient ?? i.name, ...f }))),
  ];
  console.log(`verdict=${a.verdict}  safety=${a.overall_assessment.safety_score}  personal flags=${flags.length}\n`);
  for (const f of flags) console.log(`  [${String(f.severity).toUpperCase().padEnd(8)}] ${String(f.ing).padEnd(28)} ${f.reason}`);
  const find = (re: RegExp) => flags.find(f => re.test(String(f.ing)) || re.test(f.reason));
  const expect: [string, RegExp, string][] = [
    ["nut allergy + Almond Extract", /almond|tree nut/i, "critical"],
    ["diabetes + HFCS",              /high fructose|hfcs/i, "critical"],
    ["no artificial colours + Tartrazine", /tartrazine|e102|colour|color/i, "warning"],
    ["PKU + Aspartame",              /aspartame|phenylalanin/i, "critical"],
  ];
  console.log();
  let f = 0;
  for (const [label, re, want] of expect) {
    const hit = find(re);
    const ok = !!hit && (hit.severity === want || (want === "warning" && hit.severity === "critical"));
    if (!ok) f++;
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(38)} expected ${want.padEnd(8)} got ${hit ? hit.severity : "NO FLAG"}`);
  }
  console.log(`\n${f === 0 ? "PERSONAL PROFILE: ALL 4 CONFLICTS DETECTED" : `PERSONAL PROFILE: ${f} MISSED`}`);
})();
