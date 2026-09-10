/* eslint-disable no-console */
/**
 * PART 10 — generate PDFs with deliberately long values in every field, for a
 * FOOD product and a PERSONAL CARE product, then verify against the ACTUAL
 * BYTES of the produced file: inflate every FlateDecode content stream, read
 * the real text-showing operators, and check both the content rules and that
 * no glyph is painted outside the page margins.
 *
 * (jsPDF defines `text` as an own property of each instance, so there is no
 * prototype to hook — parsing the output is the only faithful check.)
 *
 * Run: npx tsx scripts/test-pdf.ts
 */
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import type { ProductAnalysis } from "@/types/analysis";

(globalThis as unknown as { window: unknown }).window = globalThis;

const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const MARGIN = 40;

interface Shown { text: string; x: number; y: number; size: number; font: string }

/** Inflate every FlateDecode stream in the PDF and concatenate the readable ones. */
function contentStreams(pdf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = pdf.indexOf("stream", i);
    if (s === -1) break;
    let b = s + 6;
    if (pdf[b] === 0x0d) b++;
    if (pdf[b] === 0x0a) b++;
    const e = pdf.indexOf("endstream", b);
    if (e === -1) break;
    const raw = pdf.subarray(b, e);
    try {
      out.push(inflateSync(raw).toString("latin1"));
    } catch {
      out.push(raw.toString("latin1")); // not compressed
    }
    i = e + 9;
  }
  return out.join("\n");
}

/** Un-escape a PDF literal string. */
function unescapePdf(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g) => {
    if (g === "n") return "\n";
    if (g === "r") return "\r";
    if (g === "t") return "\t";
    if (g === "b") return "\b";
    if (g === "f") return "\f";
    if (g === "(" || g === ")" || g === "\\") return g;
    return String.fromCharCode(parseInt(g, 8));
  });
}

/**
 * Walk the content stream tracking the text matrix / line matrix and the
 * current font, collecting every string actually painted.
 */
function extractShown(stream: string): Shown[] {
  const shown: Shown[] = [];
  let x = 0, y = 0, size = 0, font = "";
  // Tokenise on the operators we care about.
  const re =
    /\/(F\d+)\s+([\d.]+)\s+Tf|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|([-\d.]+)\s+([-\d.]+)\s+Td|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    if (m[1]) {
      font = m[1];
      size = parseFloat(m[2]);
    } else if (m[7] !== undefined) {
      x = parseFloat(m[7]);
      y = parseFloat(m[8]);
    } else if (m[9] !== undefined) {
      x = parseFloat(m[9]);
      y = parseFloat(m[10]);
    } else if (m[11] !== undefined) {
      shown.push({ text: unescapePdf(m[11]), x, y, size, font });
    }
  }
  return shown;
}

const LONG =
  "Supercalifragilistic Extra Long Value That Absolutely Will Not Fit In A Narrow Half Width Column " +
  "and keeps going far past any reasonable boundary — ₹1,23,456.78 per 100 g, unit price ₹0.20/g — note ①🜲";

function build(
  category: string, regulator: string, act: string, portal: string,
  ingredients: ProductAnalysis["ingredient_analysis"],
): ProductAnalysis {
  const compliance: ProductAnalysis["legal_metrology_compliance"] = {};
  ["manufacturer_info", "generic_name", "net_quantity", "manufacture_date",
   "best_before_use_by", "mrp", "unit_sale_price", "consumer_care",
   "country_of_origin", "fssai_license"].forEach((k, i) => {
    compliance[k] = {
      present: false, value: LONG, compliant: false, issue: LONG,
      status: i < 2 ? "missing" : i < 6 ? "not_visible" : i < 8 ? "present" : "not_applicable",
    };
  });
  return {
    product_info: {
      name: LONG, brand: LONG, category: LONG, net_weight: LONG, mrp: "₹89.00",
      manufacture_date: LONG, expiry_date: LONG, manufacturer_address: `${LONG} ${LONG}`,
      fssai_license: LONG, batch_number: LONG, customer_care: LONG, country_of_origin: LONG,
    },
    detected_category: {
      category: category as never, confidence: "low", signals_found: [LONG],
      regulatory_body: regulator, applicable_act: act, complaint_portal: portal,
    },
    verdict: "avoid", verdict_reason: LONG, key_findings: [LONG, LONG],
    legal_metrology_compliance: compliance,
    ingredient_analysis: ingredients,
    dosage_analysis: {
      additive_count: { preservatives: 3, colors: 2, sweeteners: 1, antioxidants: 0, emulsifiers: 4, flavor_enhancers: 2, total: 12 },
      limit_checks: [{ name: LONG, fssai_limit: LONG, declared_quantity_if_available: LONG, status: "exceeds_limit", note: LONG }],
      cumulative_risk: "high", daily_intake_warning: LONG, combination_warnings: [LONG, LONG],
    },
    // Food only — mirrors the route, which omits the key for non-food.
    nutritional_analysis: category.startsWith("food") || category.startsWith("baby_product_food")
      ? {
          nutrition_score: 31,
          nutrition_data_complete: false,
          food_type: "processed_product",
          food_type_reason: `Food type reason stress string ${LONG}`,
          nutrient_density: "low",
          density_note: `Density note stress string ${LONG}`,
          primary_concern: {
            nutrient_or_ingredient: "Sugar",
            level: "high",
            penalty: 30,
            explanation: `Primary concern stress string ${LONG}`,
          },
          concerns: [
            {
              ingredient: LONG,
              concern_type: "refined_grain",
              concern_level: "significant",
              why_flagged: LONG,
              health_effects: `${LONG} ${LONG}`,
              moderation_guidance: LONG,
              who_should_limit: ["Diabetic ".repeat(12), "Weight management"],
              better_alternative: LONG,
              score_penalty: 12,
              source: "reference_database",
            },
            {
              ingredient: "Sugar",
              concern_type: "added_sugar",
              concern_level: "moderate",
              why_flagged: LONG,
              health_effects: LONG,
              moderation_guidance: LONG,
              who_should_limit: [],
              better_alternative: LONG,
              score_penalty: 8,
              source: "ai_knowledge",
            },
          ],
          threshold_flags: [
            { nutrient: "Sugar", value_per_100: 68, unit: "g", level: "high", penalty: 15, reference: LONG },
            { nutrient: "Fibre", value_per_100: 9, unit: "g", level: "high", penalty: -5, reference: LONG },
          ],
          positive_notes: [LONG, LONG],
          sugar_alias_count: 4,
          sugar_aliases_found: ["Sugar", "Invert Sugar", "Liquid Glucose", "Dextrose"],
          is_ultra_processed: true,
          ingredient_order_note: LONG,
          moderation_advice: `${LONG} ${LONG}`,
          nutritional_concerns_not_in_database: ["Sugar"],
        }
      : null,
    personal_alerts: [{ reason: LONG, severity: "critical", ingredient: LONG }],
    overall_assessment: {
      safety_score: 42, compliance_score: 30, safety_status: "ok",
      compliance_status: "ok", summary: `${LONG} ${LONG}`, recommendation: LONG,
    },
    banned_ingredients_check: [], ingredients_not_in_database: [],
  };
}

const ing = (name: string, status: ProductAnalysis["ingredient_analysis"][0]["safety_status"]) => ({
  name, safety_status: status, reason: LONG, health_effects: LONG,
  who_should_avoid: LONG, banned_in_countries: ["Country ".repeat(15)],
  healthier_alternative: LONG, source: "reference_database" as const,
  personal_flags: [{ reason: LONG, severity: "critical" as const, ingredient: name }],
});

let fails = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`    ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const { generateReport } = await import("@/lib/pdf-generator");
  const { jsPDF } = await import("jspdf");
  // A scratch doc purely for Helvetica metrics, so widths match what jsPDF drew.
  const metrics = new jsPDF({ unit: "pt", format: "a4" });
  const widthOf = (s: Shown) => {
    metrics.setFont("helvetica", s.font === "F2" || s.font === "F4" ? "bold" : "normal");
    metrics.setFontSize(s.size || 9);
    return metrics.getTextWidth(s.text);
  };

  async function render(a: ProductAnalysis) {
    const buf = Buffer.from(await (await generateReport({ analysis: a, download: false })).arrayBuffer());
    const shown = extractShown(contentStreams(buf));
    return { buf, shown, txt: shown.map((s) => s.text).join("\n") };
  }

  function geometry(shown: Shown[], label: string) {
    const bad: string[] = [];
    for (const s of shown) {
      if (!s.text.trim()) continue;
      const w = widthOf(s);
      // jsPDF emits centred/right text already resolved to a left origin.
      if (s.x < MARGIN - 2 || s.x + w > PAGE_W - MARGIN + 2 || s.y < 8 || s.y > PAGE_H - 8) {
        bad.push(`x=${s.x.toFixed(1)} w=${w.toFixed(1)} right=${(s.x + w).toFixed(1)} y=${s.y.toFixed(1)} :: ${JSON.stringify(s.text.slice(0, 44))}`);
      }
    }
    check(`no glyph outside the page margins (${shown.length} strings painted)`, bad.length === 0, bad.length ? `${bad.length} violations` : "");
    bad.slice(0, 6).forEach((b) => console.log(`         ${label} ${b}`));
  }

  const cases: [string, ProductAnalysis, RegExp][] = [
    ["FOOD", build("food_and_beverages", "FSSAI (Food Safety and Standards Authority of India)", "Food Safety and Standards Act, 2006", "https://foscos.fssai.gov.in/consumergrievance", [ing("Tartrazine", "harmful"), ing("Potassium Bromate", "banned"), ing("Water", "safe")]), /not safe for consumption/i],
    ["PERSONAL CARE", build("personal_care", "CDSCO (Central Drugs Standard Control Organisation) and BIS", "Drugs and Cosmetics Act, 1940", "https://cdsco.gov.in/opencms/opencms/en/consumer-corner/", [ing("Methylparaben", "banned"), ing("Parfum", "harmful"), ing("Glycerin", "safe")]), /skin irritation|dermal absorption/i],
  ];

  for (const [label, a, riskRe] of cases) {
    const { buf, shown, txt } = await render(a);
    console.log(`\n  ${label}  (${buf.length} bytes)`);
    check('rupee rendered as "Rs."', /Rs\.\s?89/.test(txt), (txt.match(/Rs\.\s?89[^\s]*/) ?? ["NOT FOUND"])[0]);
    check("no raw ₹ in the painted text", !txt.includes("₹"));
    check("category-appropriate risk wording", riskRe.test(txt), (txt.match(riskRe) ?? ["none"])[0]);
    check("correct regulator printed", txt.includes(a.detected_category.regulatory_body.slice(0, 18)));
    check("personal health flags present", /CRITICAL/.test(txt));

    // STEP 9 — the nutrition section exists for food and NOT for personal care.
    if (label === "FOOD") {
      check("nutritional quality section rendered", /NUTRITIONAL QUALITY/i.test(txt));
      check("nutrition score printed", /31\/100/.test(txt));
      check("ultra-processed banner", /Ultra-processed food/i.test(txt));
      check("sugar alias callout", /listed under 4 different names/i.test(txt));
      check("threshold reading printed", /Sugar[\s\S]{0,60}68 g/.test(txt), (txt.match(/Sugar[\s\S]{0,40}68 g/) ?? ["none"])[0].replace(/\n/g, " "));
      check("panel-not-visible note", /Nutrition panel not visible/i.test(txt));
      check("concern explanation printed", /How much is fine/i.test(txt));
      check("better alternative printed", /Better alternative/i.test(txt));
      check("three scores in the overall block", /Nutrition score/.test(txt) && /Safety score/.test(txt) && /Compliance score/.test(txt));
    } else {
      check("NO nutrition section for personal care", !/NUTRITIONAL QUALITY/i.test(txt));
      check("no nutrition score bar for personal care", !/Nutrition score/i.test(txt));
    }

    geometry(shown, label);
  }

  const { txt: t2 } = await render({
    ...cases[0][1],
    overall_assessment: { safety_score: null, compliance_score: null, safety_status: "insufficient_data", compliance_status: "insufficient_data", summary: LONG, recommendation: LONG },
  });
  console.log("\n  INSUFFICIENT_DATA");
  check('"Insufficient data" line printed', /Insufficient data/.test(t2));
  check("no NN/100 score printed", !/\b\d{1,3}\/100\b/.test(t2), (t2.match(/\b\d{1,3}\/100\b/) ?? ["none"])[0]);

  const { txt: t3 } = await render(cases[0][1]);
  const viol = (t3.match(/Specific violations:[\s\S]{0,1200}/) ?? [""])[0];
  console.log("\n  VIOLATIONS LIST (fixture: 2 missing, 4 not_visible)");
  check("lists the genuinely-missing declarations", /Manufacturer name|Generic/.test(viol));
  check("omits not_visible declarations", !/Best before \/ use by|Month & year of manufacture/.test(viol));

  console.log("\n  NOT-A-PACKAGED-PRODUCT");
  try {
    await generateReport({ analysis: { ...cases[0][1], product_info: { ...cases[0][1].product_info, name: null, brand: null }, ingredient_analysis: [], legal_metrology_compliance: {}, overall_assessment: { safety_score: null, compliance_score: null, summary: "", recommendation: "" } }, download: false });
    check("PDF refused", false, "a PDF was generated");
  } catch (e) {
    check("PDF refused", true, (e as Error).message.slice(0, 55));
  }

  console.log(`\n${"=".repeat(66)}`);
  console.log(fails === 0 ? "PDF: ALL CHECKS PASSED" : `PDF: ${fails} FAILURE(S)`);
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
