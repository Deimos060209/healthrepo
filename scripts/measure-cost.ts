/* eslint-disable no-console */
/**
 * Measure the ACTUAL per-scan token usage and rupee cost of the two-step
 * pipeline, and exercise the not-a-packaged-product hard gate.
 * Run: npx tsx scripts/measure-cost.ts
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { buildCompactReference, PRODUCT_CATEGORY_RULES } from "@/lib/reference-data";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const src = readFileSync("app/api/analyze/route.ts", "utf8");
const STATIC_SYSTEM = src.match(/const STATIC_SYSTEM = `([\s\S]*?)`;\n/)![1];
const ROUTER_SYSTEM = src.match(/const CATEGORY_ROUTER_SYSTEM = `([\s\S]*?)`;\n/)![1];

// USD per million tokens.
const P = {
  sonnet: { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};
const USD_INR = 88;
const rupees = (usd: number) => usd * USD_INR;

type U = Anthropic.Usage;
const cost = (u: U, p: typeof P.sonnet) =>
  ((u.input_tokens ?? 0) * p.in +
    (u.output_tokens ?? 0) * p.out +
    (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead) / 1_000_000;

const FOOD = `CRISPY CORN SNACK. Ingredients: Corn Meal, Palm Oil, Sugar, Salt, Tartrazine (E102), Sodium Benzoate (E211), Ascorbic Acid (E300), Flavour Enhancer (INS 621). Nutritional information per 100g: Energy 520 kcal, Total Fat 28g, Sugar 12g, Sodium 780mg. Veg. FSSAI Lic. No. 10012345678901. Net Wt: 60g. MRP Rs. 20 (incl. of all taxes). Mfg: 01/2026. Best before 6 months. Mfd by: Crunchy Foods Pvt Ltd, Pune 411045. Customer care: 1800-111-222. Batch: CF260101.`;
const APPLE = `a red apple on a wooden table`;

async function router(text: string) {
  const m = await client.messages.create({
    model: "claude-haiku-4-5-20251001", max_tokens: 200,
    system: ROUTER_SYSTEM, messages: [{ role: "user", content: text.slice(0, 6000) }],
  });
  const raw = m.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
  return { usage: m.usage, parsed: JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) };
}

async function sonnet(cat: string, text: string) {
  const compact = buildCompactReference(cat);
  const rule = PRODUCT_CATEGORY_RULES[cat];
  const block = [`ACTIVE CATEGORY: ${cat}`, `Regulator: ${rule.regulatory_body}`, `Governing act: ${rule.act}`,
    `Consumer complaint portal: ${rule.complaint_portal}`, "", `Set detected_category.category to "${cat}".`, "",
    "===== COMPACT REFERENCE DATA =====", JSON.stringify(compact)].join("\n");
  const m = await client.messages.stream({
    model: "claude-sonnet-5", max_tokens: 4000, thinking: { type: "disabled" },
    system: [{ type: "text", text: STATIC_SYSTEM, cache_control: { type: "ephemeral" } },
             { type: "text", text: block, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Text extracted from a packaged product via OCR follows.\n\n${text}` }],
  }).finalMessage();
  return m.usage;
}

(async () => {
  console.log("═".repeat(70));
  console.log("HALLUCINATION GATE — Haiku router on a photo of a plain apple");
  console.log("═".repeat(70));
  const apple = await router(APPLE);
  console.log(`  category  : ${apple.parsed.category}`);
  console.log(`  detected  : "${apple.parsed.detected}"`);
  console.log(`  confidence: ${apple.parsed.confidence}`);
  console.log(`  ${apple.parsed.category === "not_a_packaged_product" ? "✓ GATE FIRES — Sonnet is never called" : "✗ GATE FAILED"}`);
  console.log(`  router cost for the rejected scan: Rs ${rupees(cost(apple.usage as U, P.haiku)).toFixed(4)}`);

  console.log(`\n${"═".repeat(70)}`);
  console.log("PER-SCAN COST — real food label, two-step pipeline");
  console.log("═".repeat(70));
  const r = await router(FOOD);
  console.log(`  STEP A (Haiku router) -> ${r.parsed.category}`);
  console.log(`    usage: in=${r.usage.input_tokens} out=${r.usage.output_tokens}`);
  const rCost = cost(r.usage as U, P.haiku);

  console.log("\n  STEP B run 1 (COLD — writes the cache):");
  const u1 = await sonnet("food_and_beverages", FOOD);
  console.log(`    in=${u1.input_tokens} cache_write=${u1.cache_creation_input_tokens} cache_read=${u1.cache_read_input_tokens} out=${u1.output_tokens}`);
  const c1 = cost(u1 as U, P.sonnet);

  console.log("\n  STEP B run 2 (WARM — reads the cache; the steady state):");
  const u2 = await sonnet("food_and_beverages", FOOD);
  console.log(`    in=${u2.input_tokens} cache_write=${u2.cache_creation_input_tokens} cache_read=${u2.cache_read_input_tokens} out=${u2.output_tokens}`);
  const c2 = cost(u2 as U, P.sonnet);

  // OLD pipeline: no router, full 31.7k-token reference in every request,
  // no caching, thinking on, max_tokens 8000.
  const OLD_IN = 31761 + 2900 + 200;
  const OLD_OUT = 5000;
  const oldCost = (OLD_IN * P.sonnet.in + OLD_OUT * P.sonnet.out) / 1_000_000;

  console.log(`\n${"═".repeat(70)}`);
  console.log("COST PER SCAN (Rs, at $/MTok Sonnet 3/15, Haiku 1/5, USD 1 = Rs 88)");
  console.log("═".repeat(70));
  console.log(`  BEFORE (full reference, no cache, no router, ~${OLD_IN} in / ${OLD_OUT} out)`);
  console.log(`     Rs ${rupees(oldCost).toFixed(3)}   ($${oldCost.toFixed(4)})`);
  console.log(`  NOW  cold cache : Rs ${rupees(rCost + c1).toFixed(3)}   (router Rs ${rupees(rCost).toFixed(4)} + Sonnet Rs ${rupees(c1).toFixed(3)})`);
  console.log(`  NOW  warm cache : Rs ${rupees(rCost + c2).toFixed(3)}   (router Rs ${rupees(rCost).toFixed(4)} + Sonnet Rs ${rupees(c2).toFixed(3)})   <-- steady state`);
  console.log(`  reduction vs before: ${(100 - ((rCost + c2) / oldCost) * 100).toFixed(1)}%`);
  console.log(`\n  NOTE: the pre-fix build ALSO burned ~2,500 thinking tokens per scan`);
  console.log(`        (billed as output) and then returned a 502, so the real`);
  console.log(`        pre-fix cost was ~Rs ${rupees(rCost + c2 + (2500 * P.sonnet.out) / 1e6).toFixed(3)} per scan for ZERO usable output.`);
})().catch((e) => console.error("ERR:", e.status, e.message?.slice(0, 400)));
