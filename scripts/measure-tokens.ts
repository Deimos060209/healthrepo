/**
 * Rough before/after of the /api/analyze system-prompt reference payload.
 * Run: npx --yes tsx scripts/measure-tokens.ts
 *
 * Token estimate uses ~3.7 chars/token, a reasonable average for dense JSON.
 */
import {
  BANNED_INGREDIENTS,
  HARMFUL_ADDITIVES,
  FSSAI_ADDITIVE_LIMITS,
  LEGAL_METROLOGY_RULES,
  PRODUCT_CATEGORIES,
  HEALTHIER_ALTERNATIVES,
  REFERENCE_METADATA,
  PRODUCT_CATEGORY_RULES,
  PERSONAL_CARE_BANNED_INGREDIENTS,
  PERSONAL_CARE_HARMFUL_ADDITIVES,
  HOUSEHOLD_PRODUCT_SAFETY,
  buildCompactReference,
} from "../lib/reference-data";

const est = (s: string) => Math.round(s.length / 3.7);
const row = (label: string, s: string) =>
  console.log(
    `${label.padEnd(34)} ${String(s.length).padStart(7)} chars   ~${String(
      est(s),
    ).padStart(6)} tokens`,
  );

// OLD: the entire knowledge base, stringified into the prompt on every call.
const oldBlock = [
  JSON.stringify(BANNED_INGREDIENTS),
  JSON.stringify(HARMFUL_ADDITIVES),
  JSON.stringify(PRODUCT_CATEGORY_RULES),
  JSON.stringify(PERSONAL_CARE_BANNED_INGREDIENTS),
  JSON.stringify(PERSONAL_CARE_HARMFUL_ADDITIVES),
  JSON.stringify(HOUSEHOLD_PRODUCT_SAFETY),
  JSON.stringify(FSSAI_ADDITIVE_LIMITS),
  JSON.stringify(LEGAL_METROLOGY_RULES),
  JSON.stringify(HEALTHIER_ALTERNATIVES),
  JSON.stringify(PRODUCT_CATEGORIES),
  JSON.stringify(REFERENCE_METADATA),
].join("\n");

console.log("\n=== OLD: full reference block (sent on EVERY scan) ===");
row("full knowledge base", oldBlock);

console.log("\n=== NEW: buildCompactReference(category) ===");
for (const c of [
  "food_and_beverages",
  "personal_care",
  "household_cleaning",
  "baby_product_food",
  "baby_product_care",
]) {
  row(c, JSON.stringify(buildCompactReference(c)));
}

const worst = Math.max(
  ...[
    "food_and_beverages",
    "personal_care",
    "household_cleaning",
    "baby_product_food",
    "baby_product_care",
  ].map((c) => est(JSON.stringify(buildCompactReference(c)))),
);
console.log(
  `\nReduction: ~${est(oldBlock)} -> ~${worst} tokens  (${(
    (1 - worst / est(oldBlock)) *
    100
  ).toFixed(1)}% smaller, worst category)`,
);
