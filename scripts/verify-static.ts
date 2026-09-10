/* eslint-disable no-console */
/**
 * Pre-deployment static verification: reference data, compact payload sizing,
 * category filtering, and local enrichment. No network, no database.
 * Run: npx tsx scripts/verify-static.ts
 */
import {
  BANNED_INGREDIENTS,
  HARMFUL_ADDITIVES,
  FSSAI_ADDITIVE_LIMITS,
  HEALTHIER_ALTERNATIVES,
  LEGAL_METROLOGY_RULES,
  PRODUCT_CATEGORY_RULES,
  PERSONAL_CARE_BANNED_INGREDIENTS,
  PERSONAL_CARE_HARMFUL_ADDITIVES,
  HOUSEHOLD_PRODUCT_SAFETY,
  buildCompactReference,
} from "@/lib/reference-data";
import { enrichAnalysis } from "@/lib/enrich-analysis";
import { normalizeAnalysis } from "@/lib/analysis-normalize";

let failures = 0;
const bad = (m: string) => {
  failures++;
  console.log(`   ✗ FAIL: ${m}`);
};
const ok = (m: string) => console.log(`   ✓ ${m}`);
const h = (t: string) => console.log(`\n${"=".repeat(72)}\n${t}\n${"=".repeat(72)}`);
const tok = (n: number) => Math.round(n / 4);

// ===========================================================================
h("PART 1 — COST: old full payload vs new compact payload");
// ===========================================================================

// The OLD prompt stringified the whole knowledge base into every request.
const OLD_FULL_PAYLOAD = JSON.stringify({
  legal_metrology: LEGAL_METROLOGY_RULES,
  banned_ingredients: BANNED_INGREDIENTS,
  harmful_additives: HARMFUL_ADDITIVES,
  fssai_additive_limits: FSSAI_ADDITIVE_LIMITS,
  healthier_alternatives: HEALTHIER_ALTERNATIVES,
  product_category_rules: PRODUCT_CATEGORY_RULES,
  personal_care_banned: PERSONAL_CARE_BANNED_INGREDIENTS,
  personal_care_harmful: PERSONAL_CARE_HARMFUL_ADDITIVES,
  household_safety: HOUSEHOLD_PRODUCT_SAFETY,
});

const CATS = [
  "food_and_beverages",
  "personal_care",
  "household_cleaning",
  "baby_product_food",
  "baby_product_care",
  "unknown",
] as const;

console.log(
  `\n  OLD full reference payload : ${OLD_FULL_PAYLOAD.length.toLocaleString()} chars  ~${tok(
    OLD_FULL_PAYLOAD.length,
  ).toLocaleString()} tokens`,
);
console.log("\n  NEW compact payload, per category:");
const sizes: Record<string, number> = {};
for (const c of CATS) {
  const s = JSON.stringify(buildCompactReference(c));
  sizes[c] = s.length;
  const pct = ((s.length / OLD_FULL_PAYLOAD.length) * 100).toFixed(1);
  console.log(
    `    ${c.padEnd(20)} ${String(s.length).padStart(7)} chars  ~${String(
      tok(s.length),
    ).padStart(6)} tokens   (${pct}% of old)`,
  );
}
const worst = Math.max(...Object.values(sizes));
console.log(
  `\n  Worst case (food): ${worst.toLocaleString()} chars ~${tok(worst).toLocaleString()} tokens` +
    `  |  reduction ${(100 - (worst / OLD_FULL_PAYLOAD.length) * 100).toFixed(1)}%`,
);

// --- Q1: which fields are stripped -----------------------------------------
console.log("\n  Fields STRIPPED by buildCompactReference:");
const compactFood = buildCompactReference("food_and_beverages");
const strippedBanned = Object.keys(BANNED_INGREDIENTS[0]).filter(
  (k) => !(k in compactFood.banned_ingredients[0]),
);
const strippedHarm = Object.keys(HARMFUL_ADDITIVES[0]).filter(
  (k) => !(k in compactFood.harmful_additives[0]),
);
const strippedLimits = Object.keys(FSSAI_ADDITIVE_LIMITS[0]).filter(
  (k) => !(k in (compactFood.fssai_limits ?? [{}])[0]),
);
console.log(`    banned_ingredients  drops: ${strippedBanned.join(", ")}`);
console.log(`    harmful_additives   drops: ${strippedHarm.join(", ")}`);
console.log(`    fssai_limits        drops: ${strippedLimits.join(", ")}`);
console.log(
  `    legal_metrology     drops: rule_reference, details, penalty (keeps declaration+requirement)`,
);
console.log(`    HEALTHIER_ALTERNATIVES: not sent at all (local-only)`);

// --- Q3: category filtering / non-overlap -----------------------------------
h("PART 1 Q3 — category filtering must be disjoint");
const food = buildCompactReference("food_and_beverages");
const care = buildCompactReference("personal_care");
const house = buildCompactReference("household_cleaning");

const names = (arr: { name: string }[]) => new Set(arr.map((x) => x.name.toLowerCase()));
const overlapBanned = Array.from(names(food.banned_ingredients)).filter((n) =>
  names(care.banned_ingredients).has(n),
);
const overlapHarm = Array.from(names(food.harmful_additives)).filter((n) =>
  names(care.harmful_additives).has(n),
);

console.log(
  `  food:  banned=${food.banned_ingredients.length} harmful=${food.harmful_additives.length} ` +
    `fssai_limits=${food.fssai_limits?.length ?? 0} legal_metrology=${food.legal_metrology?.length ?? 0} ` +
    `household_safety=${food.household_safety?.length ?? 0}`,
);
console.log(
  `  care:  banned=${care.banned_ingredients.length} harmful=${care.harmful_additives.length} ` +
    `fssai_limits=${care.fssai_limits?.length ?? 0} legal_metrology=${care.legal_metrology?.length ?? 0} ` +
    `household_safety=${care.household_safety?.length ?? 0}`,
);
console.log(
  `  house: banned=${house.banned_ingredients.length} harmful=${house.harmful_additives.length} ` +
    `fssai_limits=${house.fssai_limits?.length ?? 0} legal_metrology=${house.legal_metrology?.length ?? 0} ` +
    `household_safety=${house.household_safety?.length ?? 0}`,
);

if (food.fssai_limits && care.fssai_limits) bad("personal_care received fssai_limits (food-only data leaked)");
else ok("personal_care receives NO fssai_limits");
if (care.legal_metrology) bad("personal_care received the food legal_metrology block");
else ok("personal_care receives NO food legal_metrology block");
if (food.household_safety) bad("food received household_safety");
else ok("food receives NO household_safety");
if (house.fssai_limits) bad("household received fssai_limits");
else ok("household receives NO fssai_limits");
if (overlapBanned.length) bad(`banned lists overlap: ${overlapBanned.slice(0, 5).join(", ")}`);
else ok(`banned lists disjoint (food ${food.banned_ingredients.length} vs care ${care.banned_ingredients.length})`);
if (overlapHarm.length) bad(`harmful lists overlap: ${overlapHarm.slice(0, 5).join(", ")}`);
else ok(`harmful lists disjoint`);
if (!buildCompactReference("baby_product_food").stricter_thresholds_note)
  bad("baby_product_food has no stricter_thresholds_note");
else ok("baby_product_food carries stricter_thresholds_note");
if (!buildCompactReference("baby_product_care").stricter_thresholds_note)
  bad("baby_product_care has no stricter_thresholds_note");
else ok("baby_product_care carries stricter_thresholds_note");
if (buildCompactReference("baby_product_care").fssai_limits)
  bad("baby_product_care received fssai_limits (food data leaked into baby care)");
else ok("baby_product_care receives NO fssai_limits");

// ===========================================================================
h("PART 2 — ENRICHMENT: does quality survive the cost cut?");
// ===========================================================================

const mockClaudeResponse = {
  product_info: { name: "Test Bread", brand: "TestCo" },
  detected_category: { category: "food_and_beverages", confidence: "high" },
  verdict: "avoid",
  verdict_reason: "Contains a banned flour treatment agent.",
  key_findings: ["Contains 1 banned ingredient"],
  legal_metrology_compliance: {},
  // Exactly what the new prompt tells the model to emit: short for
  // reference_database hits, full prose only for ai_knowledge hits.
  ingredient_analysis: [
    {
      name: "Potassium Bromate",
      safety_status: "banned",
      reason: "Banned flour treatment agent",
      health_effects: "",
      who_should_avoid: "",
      banned_in_countries: [],
      healthier_alternative: "",
      source: "reference_database",
      personal_flags: [],
    },
    {
      name: "Tartrazine",
      safety_status: "harmful",
      reason: "Synthetic azo dye",
      health_effects: "",
      who_should_avoid: "",
      banned_in_countries: [],
      healthier_alternative: "",
      source: "reference_database",
      personal_flags: [],
    },
    {
      name: "Propyl Gallate",
      safety_status: "caution",
      reason: "Synthetic antioxidant with endocrine concerns",
      health_effects: "Animal studies suggest possible endocrine disruption at high doses.",
      who_should_avoid: "People with aspirin sensitivity; pregnant women.",
      banned_in_countries: ["Restricted in the EU for some uses"],
      healthier_alternative: "Rosemary extract or mixed tocopherols (vitamin E).",
      source: "ai_knowledge",
      personal_flags: [],
    },
  ],
  overall_assessment: {
    safety_score: 25,
    compliance_score: 60,
    summary: "Contains a banned ingredient.",
    recommendation: "Avoid.",
  },
  dosage_analysis: {},
  personal_alerts: [],
  banned_ingredients_check: [],
  ingredients_not_in_database: [],
};

const enriched = enrichAnalysis(normalizeAnalysis(mockClaudeResponse));
const byName = (n: string) =>
  enriched.ingredient_analysis.find((i) => i.name.toLowerCase() === n.toLowerCase())!;

const show = (label: string, v: unknown) => {
  const s = v == null ? "(null)" : Array.isArray(v) ? (v.length ? v.join(" | ") : "(empty [])") : String(v);
  console.log(`    ${label.padEnd(24)} ${s.length > 150 ? s.slice(0, 150) + " …" : s}`);
  return s;
};
const need = (label: string, v: unknown, ing: string) => {
  const s = show(label, v);
  if (s === "(null)" || s === "(empty [])" || s.trim() === "") bad(`${ing}.${label} is empty after enrichment`);
};

console.log("\n  [1] BANNED — Potassium Bromate (source: reference_database)");
{
  const i = byName("Potassium Bromate");
  need("reason (why_banned)", i.reason, "Potassium Bromate");
  need("health_effects", i.health_effects, "Potassium Bromate");
  show("who_should_avoid", i.who_should_avoid);
  show("banned_in_countries", i.banned_in_countries);
  show("healthier_alternative", i.healthier_alternative);
  const ref = BANNED_INGREDIENTS.find((b) => b.name === "Potassium Bromate");
  if (ref && i.reason !== ref.why_banned) bad("reason is not the FULL why_banned paragraph");
  else ok("reason === full why_banned from reference data");
  if (ref && i.health_effects !== ref.health_effects_detailed) bad("health_effects is not the FULL health_effects_detailed");
  else ok("health_effects === full health_effects_detailed");
}

console.log("\n  [2] HARMFUL ADDITIVE — Tartrazine (source: reference_database)");
{
  const i = byName("Tartrazine");
  need("reason", i.reason, "Tartrazine");
  need("health_effects", i.health_effects, "Tartrazine");
  need("who_should_avoid", i.who_should_avoid, "Tartrazine");
  need("banned_in_countries", i.banned_in_countries, "Tartrazine");
  need("healthier_alternative", i.healthier_alternative, "Tartrazine");
  const ref = HARMFUL_ADDITIVES.find((a) => a.name === "Tartrazine");
  if (ref) {
    if (i.health_effects !== ref.health_effects_detailed) bad("Tartrazine health_effects != health_effects_detailed");
    if (i.who_should_avoid !== ref.who_should_avoid) bad("Tartrazine who_should_avoid mismatch");
    if (JSON.stringify(i.banned_in_countries) !== JSON.stringify(ref.banned_or_restricted_in))
      bad("Tartrazine banned_in_countries != banned_or_restricted_in");
    if (i.healthier_alternative !== ref.healthier_alternative) bad("Tartrazine healthier_alternative mismatch");
    if (!failures) ok("all four long fields match reference data exactly");
  }
}

console.log("\n  [3] AI_KNOWLEDGE — Propyl Gallate (model's own words must survive)");
{
  const i = byName("Propyl Gallate");
  need("reason", i.reason, "Propyl Gallate");
  need("health_effects", i.health_effects, "Propyl Gallate");
  need("who_should_avoid", i.who_should_avoid, "Propyl Gallate");
  need("healthier_alternative", i.healthier_alternative, "Propyl Gallate");
  if (!/endocrine disruption at high doses/.test(i.health_effects ?? ""))
    bad("Propyl Gallate lost Claude's own health_effects text");
  else ok("Claude's own explanation preserved verbatim");
}

console.log("\n  [4] NAME MATCHING — case-insensitive + also_known_as + e_code");
{
  const pb = BANNED_INGREDIENTS.find((b) => b.name === "Potassium Bromate")!;
  console.log(`    reference e_code=${pb.e_code}  also_known_as=[${pb.also_known_as.join(", ")}]`);
  const variants = ["potassium bromate", "POTASSIUM BROMATE", "  Potassium   Bromate ", pb.e_code ?? "E924", ...pb.also_known_as];
  const results = variants.map((v) => {
    const out = enrichAnalysis(
      normalizeAnalysis({
        ...mockClaudeResponse,
        ingredient_analysis: [
          { name: v, safety_status: "banned", reason: "", health_effects: "", who_should_avoid: "",
            banned_in_countries: [], healthier_alternative: "", source: "reference_database", personal_flags: [] },
        ],
      }),
    ).ingredient_analysis[0];
    return { v, resolved: out.reason === pb.why_banned };
  });
  for (const r of results) {
    if (r.resolved) ok(`"${r.v}" → resolves to Potassium Bromate`);
    else bad(`"${r.v}" → did NOT resolve (enrichment miss)`);
  }
}

// ===========================================================================
h("PART 3 (structural) + PART 11 — reference data regression");
// ===========================================================================
console.log(`  PRODUCT_CATEGORY_RULES keys: ${Object.keys(PRODUCT_CATEGORY_RULES).join(", ")}`);
for (const k of ["food_and_beverages", "personal_care", "household_cleaning", "baby_product_food", "baby_product_care"]) {
  if (PRODUCT_CATEGORY_RULES[k]) ok(`PRODUCT_CATEGORY_RULES.${k} present`);
  else bad(`PRODUCT_CATEGORY_RULES.${k} MISSING (no dedicated rule block)`);
}
console.log(`\n  PERSONAL_CARE_BANNED_INGREDIENTS: ${PERSONAL_CARE_BANNED_INGREDIENTS.length} entries`);
console.log(`  PERSONAL_CARE_HARMFUL_ADDITIVES : ${PERSONAL_CARE_HARMFUL_ADDITIVES.length} entries`);
console.log(`  HOUSEHOLD_PRODUCT_SAFETY        : ${HOUSEHOLD_PRODUCT_SAFETY.length} entries`);
console.log(`  BANNED_INGREDIENTS              : ${BANNED_INGREDIENTS.length} entries`);
console.log(`  HARMFUL_ADDITIVES               : ${HARMFUL_ADDITIVES.length} entries`);
console.log(`  FSSAI_ADDITIVE_LIMITS           : ${FSSAI_ADDITIVE_LIMITS.length} entries`);
console.log(`  HEALTHIER_ALTERNATIVES          : ${Object.keys(HEALTHIER_ALTERNATIVES).length} entries`);
if (!PERSONAL_CARE_BANNED_INGREDIENTS.length) bad("PERSONAL_CARE_BANNED_INGREDIENTS empty");
if (!PERSONAL_CARE_HARMFUL_ADDITIVES.length) bad("PERSONAL_CARE_HARMFUL_ADDITIVES empty");
if (!HOUSEHOLD_PRODUCT_SAFETY.length) bad("HOUSEHOLD_PRODUCT_SAFETY empty");

console.log("\n  Spot-check 5 banned ingredients (full detail must survive):");
for (const b of BANNED_INGREDIENTS.slice(0, 5)) {
  const okRow = b.why_banned?.length > 80 && b.health_effects_detailed?.length > 80;
  console.log(`    ${okRow ? "✓" : "✗"} ${b.name.padEnd(28)} why_banned=${b.why_banned?.length ?? 0}ch health_effects_detailed=${b.health_effects_detailed?.length ?? 0}ch`);
  if (!okRow) bad(`${b.name} has thin/missing detail`);
}
console.log("\n  Spot-check 5 harmful additives:");
for (const a of HARMFUL_ADDITIVES.slice(0, 5)) {
  const okRow =
    a.health_effects_detailed?.length > 80 && !!a.who_should_avoid && (a.banned_or_restricted_in?.length ?? 0) >= 0 && !!a.healthier_alternative;
  console.log(
    `    ${okRow ? "✓" : "✗"} ${a.name.padEnd(24)} he=${a.health_effects_detailed?.length ?? 0}ch wsa=${a.who_should_avoid ? "y" : "N"} banned_in=${a.banned_or_restricted_in?.length ?? 0} alt=${a.healthier_alternative ? "y" : "N"}`,
  );
  if (!okRow) bad(`${a.name} missing one of the four long fields`);
}

const decls = Object.keys(LEGAL_METROLOGY_RULES.MANDATORY_DECLARATIONS ?? {});
console.log(`\n  Legal Metrology mandatory declarations: ${decls.length}`);
console.log(`    ${decls.join(", ")}`);
if (decls.length !== 11) bad(`expected 11 mandatory declarations, found ${decls.length}`);
else ok("all 11 declarations present");
for (const [k, d] of Object.entries(LEGAL_METROLOGY_RULES.MANDATORY_DECLARATIONS ?? {})) {
  const dd = d as { rule_reference?: string; requirement?: string; details?: string };
  if (!dd.rule_reference || !dd.requirement || !dd.details) bad(`declaration ${k} missing rule_reference/requirement/details`);
}
const lmKeys = Object.keys(LEGAL_METROLOGY_RULES);
console.log(`  LEGAL_METROLOGY_RULES sections: ${lmKeys.join(", ")}`);
const fontRules = (LEGAL_METROLOGY_RULES as Record<string, unknown>).FONT_SIZE_RULES as
  | { height_table?: unknown[]; [k: string]: unknown }
  | undefined;
if (!fontRules) bad("FONT_SIZE_RULES (Rule 7) missing");
else {
  // The real key is `numeral_height_table`; the three names guessed here never
  // existed, so this check reported a missing table rather than checking one.
  const table = (fontRules.numeral_height_table ??
    fontRules.height_table ??
    fontRules.size_table ??
    fontRules.table) as unknown[] | undefined;
  console.log(`    FONT_SIZE_RULES rows: ${Array.isArray(table) ? table.length : "n/a"} — keys: ${Object.keys(fontRules).join(", ")}`);
  if (Array.isArray(table) && table.length === 4) ok("Rule 7 font-size table has 4 rows");
  else bad(`Rule 7 font-size table not 4 rows (got ${Array.isArray(table) ? table.length : "missing"})`);
}
// The key is PRINCIPAL_DISPLAY_PANEL_RULES — the shorter name never existed.
if (!(LEGAL_METROLOGY_RULES as Record<string, unknown>).PRINCIPAL_DISPLAY_PANEL_RULES)
  bad("PRINCIPAL_DISPLAY_PANEL_RULES missing");
else ok("PRINCIPAL_DISPLAY_PANEL rules present");

// HEALTHIER_ALTERNATIVES coverage: every harmful/banned name must have an entry
const altKeys = new Set(Object.keys(HEALTHIER_ALTERNATIVES).map((k) => k.toLowerCase()));
const needAlt = [...BANNED_INGREDIENTS.map((b) => b.name), ...HARMFUL_ADDITIVES.map((a) => a.name)];
const missingAlt = needAlt.filter((n) => !altKeys.has(n.toLowerCase()));
const orphanAlt = Array.from(altKeys).filter((k) => !needAlt.some((n) => n.toLowerCase() === k));
console.log(`\n  HEALTHIER_ALTERNATIVES coverage: ${needAlt.length - missingAlt.length}/${needAlt.length}`);
if (missingAlt.length) bad(`no alternative for: ${missingAlt.join(", ")}`);
else ok("100% coverage of banned + harmful names");
if (orphanAlt.length) bad(`orphan alternative keys: ${orphanAlt.join(", ")}`);
else ok("zero orphan keys");

// Benzoate + ascorbic acid combination data present?
const benz = FSSAI_ADDITIVE_LIMITS.find((l) => /benzoate/i.test(l.name));
console.log(`\n  Sodium Benzoate in FSSAI_ADDITIVE_LIMITS: ${benz ? `yes (limit ${benz.fssai_max_limit_mg_per_kg} mg/kg, ADI ${benz.adi_mg_per_kg_body_weight ?? "n/a"})` : "NO"}`);
if (!benz) bad("Sodium Benzoate missing from FSSAI_ADDITIVE_LIMITS");

console.log(`\n${"=".repeat(72)}`);
console.log(failures === 0 ? "STATIC VERIFICATION: ALL CHECKS PASSED" : `STATIC VERIFICATION: ${failures} FAILURE(S)`);
console.log("=".repeat(72));
process.exitCode = failures ? 1 : 0;
