/* eslint-disable no-console */
/**
 * Reproduce the "Partial scan on every scan" bug against the REAL route.
 *
 * Working tree == origin/main == the deployed commit (git diff is empty), so
 * calling the actual POST handler here exercises byte-identical code to Vercel.
 * It fires the same Haiku router + Sonnet analysis + normalize + enrich, and
 * the ANALYZE_DEBUG line the route now logs prints for each scan.
 *
 * Two realistic single-photo labels (a milk carton back panel, a chocolate
 * wrapper). ~Rs 6-7 each.
 *
 * Run: npx tsx scripts/debug-partial-scan.ts
 */
import { readFileSync } from "node:fs";

// Load .env.local into process.env BEFORE importing the route (lib/claude.ts
// throws at module scope without ANTHROPIC_API_KEY).
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

const MILK_CARTON = `NUTRITION INFORMATION
Serving size 200 ml. Servings per pack 5.
Per 100 ml: Energy 67 kcal, Protein 3.2 g, Carbohydrate 4.8 g (Total Sugars 4.8 g, Added Sugars 0 g), Fat 4.1 g (Saturated Fat 2.7 g, Trans Fat 0 g), Cholesterol 11 mg, Calcium 120 mg.
INGREDIENTS: Toned Milk.
ALLERGEN INFORMATION: Contains Milk.
Toned Milk conforming to FSSAI standards. Fat 3.0% min, SNF 8.5% min.
Store below 4 degrees C. Keep refrigerated. Consume within 2 days of opening.
Shake well before use. Not for medicinal use.
A product of Amul - GCMMF Ltd.
FSSAI Lic. No. 10714043000123.
Customer care: 1800 258 3333, wecare@amul.coop
Marketed by: Gujarat Cooperative Milk Marketing Federation Ltd, Anand 388001, Gujarat.`;

const CHOCOLATE = `DAIRY MILK CHOCOLATE
INGREDIENTS: Sugar, Milk Solids (24%), Cocoa Butter, Cocoa Solids, Emulsifiers (442, 476), Raising Agent (500(ii)), Flavours (Vanilla, Ethyl Vanillin). Contains added Natural (Vanilla) and Nature-identical (Ethyl Vanillin) Flavouring Substances.
ALLERGENS: Contains Milk and Soya. May contain Nuts and Wheat.
NUTRITIONAL INFORMATION (Approximate Values per 100 g): Energy 549 kcal, Protein 7.3 g, Carbohydrate 59.2 g (of which Total Sugars 56.9 g, Added Sugars 51.4 g), Total Fat 30.6 g (of which Saturated Fat 18.9 g, Trans Fat 0.2 g), Sodium 87 mg.
Best before 8 months from packaging. See base of pack for lot number and best-before date.
Store in a cool, dry and hygienic place away from direct sunlight and strong odours.
VEGETARIAN.
Manufactured and Marketed by Mondelez India Foods Private Limited, Unit V, Induri, Talegaon Dabhade, Pune 410507.
FSSAI Lic. No. 10012011000234.`;

async function scan(
  POST: (req: Request) => Promise<Response>,
  label: string,
  text: string,
) {
  console.log("\n" + "=".repeat(80));
  console.log(`SCAN: ${label}   (extracted text ${text.length} chars)`);
  console.log("=".repeat(80));
  const req = new Request("http://local/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ extractedText: text }),
  });
  const res = await POST(req);
  const body = (await res.json()) as Record<string, unknown>;
  console.log(`\nHTTP ${res.status}`);
  if (res.status !== 200) {
    console.log("BODY:", JSON.stringify(body, null, 2));
    return;
  }
  const a = body.analysis as {
    overall_assessment?: Record<string, unknown>;
    verdict?: string;
    ingredient_analysis?: unknown[];
    nutritional_analysis?: { nutrition_score?: number | null } | null;
    legal_metrology_compliance?: Record<string, { status?: string }>;
  };
  const oa = a.overall_assessment ?? {};
  const lmc = a.legal_metrology_compliance ?? {};
  const byStatus: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(lmc)) {
    (byStatus[v?.status ?? "(none)"] ||= []).push(k);
  }
  console.log("\n  CLIENT-FACING RESULT:");
  console.log(`    verdict          : ${a.verdict}`);
  console.log(`    safety_score     : ${oa.safety_score}   status: ${oa.safety_status}`);
  console.log(`    compliance_score : ${oa.compliance_score}   status: ${oa.compliance_status}`);
  console.log(`    nutrition_score  : ${a.nutritional_analysis?.nutrition_score ?? "n/a"}`);
  console.log(`    overall_score    : ${oa.overall_score}`);
  console.log(`    ingredient_count : ${a.ingredient_analysis?.length ?? 0}`);
  console.log("\n  legal_metrology_compliance status breakdown:");
  for (const [status, keys] of Object.entries(byStatus)) {
    console.log(`    ${status.padEnd(16)} (${keys.length}): ${keys.join(", ")}`);
  }
  const insufficient =
    !oa ||
    oa.safety_score == null ||
    oa.compliance_score == null ||
    oa.safety_status === "insufficient_data" ||
    oa.compliance_status === "insufficient_data";
  console.log(
    `\n  >>> isInsufficientData() -> ${insufficient}  ${
      insufficient ? "==> SHOWS 'Partial scan — we could only read part of this label'" : "==> shows full results"
    }`,
  );
}

(async () => {
  const { POST } = (await import("@/app/api/analyze/route")) as {
    POST: (req: Request) => Promise<Response>;
  };
  await scan(POST, "Milk carton (single back-panel photo)", MILK_CARTON);
  await scan(POST, "Chocolate wrapper (single photo)", CHOCOLATE);
})().catch((e) => {
  console.error("ERR:", (e as Error).stack ?? e);
  process.exit(1);
});
