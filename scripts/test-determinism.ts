/* eslint-disable no-console */
/**
 * FIX 9.3 — self-check script. Calls /api/analyze FIVE times with the SAME
 * extracted text and asserts that safety_score, nutrition_score,
 * compliance_score, overall_score and verdict are byte-identical across all
 * five runs.
 *
 * Run against a local production server (npm run build && npm run start --
 * -p 3737), then: npx tsx scripts/test-determinism.ts
 *
 * Why this should now hold (see lib/enrich-analysis.ts and FIX 8/9):
 *   - temperature: 0 on every Anthropic call (router, Sonnet analysis, both
 *     OCR vision tiers) removes random sampling from the model itself.
 *   - safety_score and compliance_score are computed LOCALLY from the
 *     model's classifications (computeSafetyScore / computeComplianceScore)
 *     — identical classifications always produce identical arithmetic.
 *   - nutrition_score is entirely server-computed (lib/enrich-analysis.ts,
 *     unchanged since the original nutrition-v2 work).
 *
 * NOTE: minor variation in the model's own ingredient classifications can
 * still occur even at temperature 0 — that is inherent to the model, not
 * this app. Local scoring absorbs most of that variance (two runs that both
 * call an ingredient "caution" score identically regardless of which
 * sentence the model used to explain it); temperature 0 suppresses the rest.
 * If this script ever reports a genuine score mismatch, that is a real
 * regression worth investigating, not an expected flake.
 */

const BASE = process.env.HR_BASE ?? "http://localhost:3737";
const RUNS = 5;

// A representative food label with a real ingredients list, a nutrition
// panel, and a full Legal Metrology declaration set — enough of every
// dimension (safety / nutrition / compliance) to be worth checking.
const EXTRACTED_TEXT = `CRUNCHY MASALA POTATO CHIPS
Ingredients: Potatoes, Refined Palm Oil, Iodised Salt, Sugar, Spices and Condiments (Turmeric, Red Chilli, Coriander, Cumin), Acidity Regulator (INS 330), Flavour Enhancer (INS 621), Antioxidant (INS 319).
Nutritional Information (per 100g): Energy 540 kcal, Protein 6.5g, Carbohydrate 52g, Total Sugar 2.1g, Total Fat 34g, Saturated Fat 15g, Trans Fat 0.1g, Sodium 650mg, Fibre 3.2g.
Net Weight: 52g
MRP: Rs. 20 (incl. of all taxes)
Best Before: 4 months from packaging
Mfg Date: 03/2026
Batch No: CMP2603A
Manufactured by: Golden Harvest Snacks Pvt Ltd, Plot 12, Industrial Area Phase 2, Chandigarh 160002
FSSAI Lic No: 12345678901234
Customer Care: 1800-000-1111, care@goldenharvest.example
Country of Origin: India`;

interface Result {
  run: number;
  safety_score: number | null;
  nutrition_score: number | null;
  compliance_score: number | null;
  overall_score: number | null;
  verdict: string | null;
}

async function runOnce(run: number): Promise<Result> {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ extractedText: EXTRACTED_TEXT }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.analysis) {
    throw new Error(
      `run ${run}: /api/analyze failed (status ${res.status}): ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  const a = data.analysis;
  const oa = a.overall_assessment ?? {};
  return {
    run,
    safety_score: oa.safety_score ?? null,
    nutrition_score: oa.nutrition_score ?? null,
    compliance_score: oa.compliance_score ?? null,
    overall_score: oa.overall_score ?? null,
    verdict: a.verdict ?? null,
  };
}

async function main() {
  console.log(`[determinism] ${RUNS} calls to ${BASE}/api/analyze with identical text...`);
  const results: Result[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = await runOnce(i);
    console.log(`  run ${i}:`, r);
    results.push(r);
  }

  const first = results[0];
  const fields: (keyof Result)[] = [
    "safety_score",
    "nutrition_score",
    "compliance_score",
    "overall_score",
    "verdict",
  ];

  const mismatches: string[] = [];
  for (const field of fields) {
    const values = results.map((r) => r[field]);
    const allSame = values.every((v) => v === first[field]);
    if (!allSame) {
      mismatches.push(`${field}: ${JSON.stringify(values)}`);
    }
  }

  console.log("");
  if (mismatches.length === 0) {
    console.log(
      `PASS — all ${RUNS} runs produced byte-identical safety_score, nutrition_score, compliance_score, overall_score and verdict.`,
    );
    process.exit(0);
  } else {
    console.error(`FAIL — ${mismatches.length} field(s) differed across runs:`);
    for (const m of mismatches) console.error("  " + m);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[determinism] script error:", err);
  process.exit(1);
});
