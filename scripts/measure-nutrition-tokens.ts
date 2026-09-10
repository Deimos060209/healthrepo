/* eslint-disable no-console */
/**
 * ISSUE 4 — is MAX_OUTPUT_TOKENS = 5500 still necessary now that the
 * nutritional layer is live?
 *
 * Runs the REAL two-block prompt from app/api/analyze/route.ts against a
 * deliberately heavy food label (long ingredient list, sugar split across
 * aliases, a full nutrition panel, additives, a health profile) — the worst
 * case for the nutritional_analysis block — and reports the actual output
 * token count and the per-scan rupee cost.
 *
 * Run: npx tsx scripts/measure-nutrition-tokens.ts
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildCompactReference,
  PRODUCT_CATEGORY_RULES,
} from "@/lib/reference-data";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const src = readFileSync("app/api/analyze/route.ts", "utf8");
const STATIC_SYSTEM = src.match(/const STATIC_SYSTEM = `([\s\S]*?)`;\n/)![1];
const ROUTER_SYSTEM = src.match(
  /const CATEGORY_ROUTER_SYSTEM = `([\s\S]*?)`;\n/,
)![1];
const CURRENT_CAP = Number(
  src.match(/const MAX_OUTPUT_TOKENS = (\d+);/)?.[1] ?? "5500",
);

// USD per million tokens; USD 1 = Rs 88 (same basis as scripts/measure-cost.ts).
const P = { sonnet: { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
const USD_INR = 88;
const rupees = (usd: number) => usd * USD_INR;
const sonnetCost = (u: Anthropic.Usage) =>
  ((u.input_tokens ?? 0) * P.sonnet.in +
    (u.output_tokens ?? 0) * P.sonnet.out +
    (u.cache_creation_input_tokens ?? 0) * P.sonnet.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * P.sonnet.cacheRead) /
  1_000_000;

// A heavy, realistic Indian food label: refined-flour base, sugar under five
// names, palm oil, a big additive list, and a full nutrition panel — every
// nutritional_analysis sub-block (concerns, threshold_flags, aliases,
// positives, primary_concern) is exercised.
const HEAVY_FOOD = `RICH CHOCO-CREAM SANDWICH BISCUITS — PREMIUM PACK.
Ingredients: Refined Wheat Flour (Maida) (54%), Sugar, Edible Vegetable Oil (Palm Oil), Invert Syrup, Liquid Glucose, Dextrose, Cocoa Solids (4.5%), Milk Solids, High Fructose Corn Syrup, Wheat Starch, Iodised Salt, Raising Agents (INS 503(ii), INS 500(ii)), Emulsifiers (INS 322(i) (Soy Lecithin), INS 471, INS 476), Humectant (INS 422), Dough Conditioner (INS 223), Artificial Flavouring Substances (Vanilla, Chocolate), Colour (INS 150d), Antioxidant (INS 319), Salt.
Nutritional Information (approx. per 100 g): Energy 494 kcal; Protein 6.2 g; Carbohydrate 68.4 g, of which Total Sugars 33.1 g, Added Sugars 30.0 g; Total Fat 22.3 g, of which Saturated Fat 11.8 g, Trans Fat 0.3 g; Dietary Fibre 1.6 g; Sodium 415 mg.
Contains wheat, milk and soy. May contain traces of tree nuts and egg.
Allergen advice: For allergens see ingredients in bold.
Veg. Net Wt: 300 g. MRP Rs. 60 (incl. of all taxes). Mfg date: 02/2026. Best before 7 months from manufacture. Batch No: RC-2602-A7. FSSAI Lic. No. 10012045000876. Mktd by: SweetCrust Foods Pvt Ltd, Plot 21, MIDC Industrial Area, Pune 411019, Maharashtra. Consumer care: care@sweetcrust.example, 1800-200-3040. Store in a cool, dry place away from sunlight.`;

const HEALTH_PROFILE_BLOCK = `USER PERSONAL HEALTH PROFILE:
- Allergies: Nuts, Dairy/Lactose
- Dietary preferences: No sugar, No palm oil
- Health conditions: Diabetic, Hypertension (high BP)
- Custom avoid ingredients: high fructose corn syrup, INS 150d`;

async function router(text: string) {
  const m = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: ROUTER_SYSTEM,
    messages: [{ role: "user", content: text.slice(0, 6000) }],
  });
  const raw = m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    usage: m.usage,
    parsed: JSON.parse(
      raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
    ) as { category: string },
  };
}

async function sonnet(cat: string, text: string, withProfile: boolean) {
  const compact = buildCompactReference(cat);
  const rule = PRODUCT_CATEGORY_RULES[cat];
  const block = [
    `ACTIVE CATEGORY: ${cat}`,
    `Regulator: ${rule.regulatory_body}`,
    `Governing act: ${rule.act}`,
    `Consumer complaint portal: ${rule.complaint_portal}`,
    "",
    `Set detected_category.category to "${cat}".`,
    "",
    "===== COMPACT REFERENCE DATA =====",
    JSON.stringify(compact),
  ].join("\n");
  const m = await client.messages
    .stream({
      model: "claude-sonnet-5",
      max_tokens: CURRENT_CAP,
      thinking: { type: "disabled" },
      system: [
        { type: "text", text: STATIC_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: block, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            "Text extracted from a packaged product via OCR follows.",
            "",
            text,
            ...(withProfile ? ["", HEALTH_PROFILE_BLOCK] : []),
          ].join("\n"),
        },
      ],
    })
    .finalMessage();
  const responseText = m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  let parseOk = false;
  try {
    JSON.parse(
      responseText.slice(
        responseText.indexOf("{"),
        responseText.lastIndexOf("}") + 1,
      ),
    );
    parseOk = true;
  } catch {
    parseOk = false;
  }
  return { usage: m.usage, stop: m.stop_reason, parseOk, len: responseText.length };
}

// A realistic, common heavy food label (8 ingredients incl. 3 additives + a
// nutrition panel) — the level of label the app sees every day.
const REALISTIC_FOOD = `CRISPY CORN SNACK. Ingredients: Corn Meal, Palm Oil, Sugar, Salt, Tartrazine (E102), Sodium Benzoate (E211), Ascorbic Acid (E300), Flavour Enhancer (INS 621). Nutritional information per 100g: Energy 520 kcal, Total Fat 28g, Saturated Fat 13g, Sugar 12g, Sodium 780mg, Protein 6g, Dietary Fibre 1.5g. Veg. FSSAI Lic. No. 10012345678901. Net Wt: 60g. MRP Rs. 20 (incl. of all taxes). Mfg: 01/2026. Best before 6 months. Mfd by: Crunchy Foods Pvt Ltd, Pune 411045. Customer care: 1800-111-222. Batch: CF260101.`;

// A mid-heavy label: ~13 ingredients, some additives, full panel.
const MID_FOOD = `MASALA INSTANT NOODLES. Ingredients: Refined Wheat Flour (Maida), Palm Oil, Salt, Wheat Gluten, Thickeners (INS 508, INS 412), Acidity Regulators (INS 501, INS 500), Flavour Enhancers (INS 621, INS 627, INS 631), Onion Powder, Garlic Powder, Sugar, Hydrolysed Vegetable Protein, Turmeric Powder, Chilli Powder, Colour (INS 150d). Nutritional information per 100 g: Energy 452 kcal, Protein 9.1 g, Carbohydrate 61 g, Total Sugars 4 g, Total Fat 18 g, Saturated Fat 9 g, Trans Fat 0.1 g, Dietary Fibre 3 g, Sodium 1420 mg. Veg. Net Wt: 70 g. MRP Rs. 14 (incl. of all taxes). FSSAI Lic. No. 10012099000123. Mfg: 01/2026. Best before 6 months. Mfd by: QuickNoodle Foods Pvt Ltd, Nashik 422007. Consumer care 1800-123-9000. Batch: QN2601.`;

(async () => {
  console.log("═".repeat(74));
  console.log(`FOOD LABEL — output token measurement (cap in code: ${CURRENT_CAP})`);
  console.log("═".repeat(74));

  const r = await router(HEAVY_FOOD);
  console.log(`  router -> ${r.parsed.category}  (in=${r.usage.input_tokens} out=${r.usage.output_tokens})`);
  const cat = "food_and_beverages";

  const runs: { label: string; u: Anthropic.Usage; stop: string | null; ok: boolean; len: number }[] = [];
  const one = async (label: string, text: string, withProfile: boolean) => {
    const s = await sonnet(cat, text, withProfile);
    runs.push({ label, u: s.usage, stop: s.stop, ok: s.parseOk, len: s.len });
    console.log(
      `  ${label.padEnd(34)} OUTPUT=${String(s.usage.output_tokens).padStart(5)} tok  ` +
        `stop=${s.stop}  json=${s.parseOk ? "OK" : "TRUNCATED"}`,
    );
  };
  await one("realistic 8-ingr snack", REALISTIC_FOOD, false);
  await one("realistic 8-ingr + health profile", REALISTIC_FOOD, true);
  await one("mid 15-ingr noodles", MID_FOOD, false);
  await one("mid 15-ingr + health profile", MID_FOOD, true);
  await one("EXTREME 24-ingr biscuit", HEAVY_FOOD, false);
  await one("EXTREME 24-ingr + health profile", HEAVY_FOOD, true);

  const realistic = runs.filter((x) => x.label.startsWith("realistic"));
  const mid = runs.filter((x) => x.label.startsWith("mid"));
  const anyTrunc = runs.filter((x) => x.stop === "max_tokens");
  const realisticWorst = Math.max(...realistic.map((x) => x.u.output_tokens ?? 0));
  const midWorst = Math.max(...mid.map((x) => x.u.output_tokens ?? 0));
  const warm = runs.find((x) => (x.u.cache_read_input_tokens ?? 0) > 0) ?? runs[1];
  const rCost = (r.usage.output_tokens! * 5 + r.usage.input_tokens! * 1) / 1e6;
  const outCostAt = (tok: number) => rupees((tok * P.sonnet.out) / 1e6);

  console.log("\n" + "─".repeat(74));
  console.log(`  realistic 8-ingredient label : ${realisticWorst} output tokens`);
  console.log(`  mid 15-ingredient label      : ${midWorst} output tokens`);
  console.log(`  EXTREME 24-ingredient label  : ${runs.filter(x=>x.label.startsWith("EXTREME")).map(x=>x.u.output_tokens).join(" / ")} (stop=${runs.find(x=>x.label.startsWith("EXTREME"))?.stop})`);
  console.log(`  labels that hit the ${CURRENT_CAP} cap : ${anyTrunc.length}/${runs.length}  [${anyTrunc.map(x=>x.label.trim()).join("; ") || "none"}]`);

  console.log("\n" + "─".repeat(74));
  console.log("  PER-SCAN COST (steady state, warm cache; USD 1 = Rs 88)");
  console.log(`    router (Haiku)     Rs ${rupees(rCost).toFixed(4)}`);
  console.log(`    Sonnet (realistic) Rs ${rupees(sonnetCost(warm.u)).toFixed(4)}   total Rs ${rupees(rCost + sonnetCost(warm.u)).toFixed(4)}`);
  console.log("\n  Output cost of this scan, and of the same scan at other caps:");
  console.log(`    realistic label actual ${realisticWorst} tok -> Rs ${outCostAt(realisticWorst).toFixed(4)} in output`);
  console.log(`    if it ran to a 4000 cap             -> Rs ${outCostAt(4000).toFixed(4)}`);
  console.log(`    if it ran to a 5500 cap             -> Rs ${outCostAt(5500).toFixed(4)}`);
  console.log(
    `\n  max_tokens is a CEILING, billed only for tokens generated. Lowering it\n` +
      `  saves money ONLY on scans that would otherwise stop below the new cap;\n` +
      `  it costs money (a failed/truncated scan) on any that need more.`,
  );
})().catch((e) =>
  console.error("ERR:", e?.status, (e?.message ?? String(e)).slice(0, 500)),
);
