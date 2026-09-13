/**
 * HealthRepo PDF report generator.
 *
 * Builds a professional, multi-page safety report from a ProductAnalysis
 * (the payload returned by /api/analyze). Uses jsPDF for the crisp,
 * text-selectable document body and html2canvas only to rasterise the
 * product photo so it embeds cleanly regardless of source format.
 *
 * `generateReport(...)` returns the PDF Blob and, unless `download: false`,
 * also triggers a browser download.
 */

import type { jsPDF as JsPDF } from "jspdf";
import { HEALTHIER_ALTERNATIVES } from "@/lib/reference-data";
import {
  resolveCategory,
  ingredientRiskPhrase,
  verdictLabel,
} from "@/lib/product-category";
import type {
  ProductAnalysis,
  IngredientAnalysis,
  ComplianceItem,
  SafetyStatus,
  NutritionalConcernLevel,
  Verdict,
} from "@/types/analysis";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateReportInput {
  analysis: ProductAnalysis;
  /** object URL / data URL / remote URL of the product photo. */
  imageUrl?: string | null;
  /** When the scan happened. Defaults to now. */
  scannedAt?: string | Date;
  /** If the scan was saved, its Supabase id (printed as a reference). */
  scanId?: string | null;
  /** Download filename without extension. */
  fileName?: string;
  /** Set false to only return the Blob without downloading. */
  download?: boolean;
}

/**
 * Generate the safety report PDF.
 *
 * @param data Either a bare {@link ProductAnalysis} or a {@link GenerateReportInput}.
 * @returns the PDF as a Blob (also downloaded unless `download: false`).
 */
export async function generateReport(
  data: ProductAnalysis | GenerateReportInput,
): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("generateReport() must run in the browser.");
  }

  const input: GenerateReportInput =
    "analysis" in data ? data : { analysis: data };
  const a = input.analysis;
  if (!a || typeof a !== "object" || !a.overall_assessment) {
    throw new Error("generateReport(): a valid `analysis` object is required.");
  }

  // BUG 4c — a photo that was not a packaged product never gets a report.
  if (looksNotAPackagedProduct(a)) {
    throw new Error(
      "generateReport(): this scan is not a packaged product — no report generated.",
    );
  }

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  // Every string written to the PDF is routed through sanitizeForPdf() so
  // characters with no WinAnsi glyph (₹, arrows, …) never reach Helvetica.
  installTextSanitizer(doc);
  const R = new Layout(doc);

  const scannedAt = input.scannedAt ? new Date(input.scannedAt) : new Date();
  const image = input.imageUrl ? await rasterizeImage(input.imageUrl) : null;

  drawHeader(R, a, scannedAt, input.scanId ?? null, image);
  drawProductInfo(R, a);
  drawPersonalAlerts(R, a);
  drawCompliance(R, a);
  drawIngredients(R, a);
  drawNutrition(R, a);
  drawDosage(R, a);
  drawAlternatives(R, a);
  drawOverall(R, a);
  drawActions(R, a);
  drawFooters(R);

  const blob = doc.output("blob");
  if (input.download !== false) {
    triggerDownload(blob, `${input.fileName ?? defaultFileName(a, scannedAt)}.pdf`);
  }
  return blob;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const TEAL: RGB = [13, 148, 136]; // #0D9488
const TEAL_DARK: RGB = [15, 118, 110];
const RED: RGB = [220, 38, 38]; // red-600
const RED_DARK: RGB = [153, 27, 27]; // red-800 (banned)
const AMBER: RGB = [217, 119, 6]; // amber-600 (readable)
const ORANGE: RGB = [194, 65, 12]; // orange-700 (nutrition: 'significant')
const GREEN: RGB = [22, 163, 74]; // green-600
const INK: RGB = [39, 39, 42];
const MUTED: RGB = [113, 113, 122];
const LINE: RGB = [224, 224, 228];
const ZEBRA: RGB = [250, 250, 251];
const TINT_GREEN: RGB = [220, 252, 231];
const TINT_AMBER: RGB = [254, 243, 199];
const TINT_ORANGE: RGB = [255, 237, 213];
const TINT_RED: RGB = [254, 226, 226];
const TINT_ZINC: RGB = [244, 244, 245];

const fill = (d: JsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const stroke = (d: JsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const ink = (d: JsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);

// ---------------------------------------------------------------------------
// Text sanitisation (BUG 1)
//
// jsPDF's built-in Helvetica uses WinAnsi (CP1252) encoding. Any character
// outside that set renders as garbage — most visibly ₹ (U+20B9) showing up
// as "¹". sanitizeForPdf() maps the common offenders to ASCII and drops
// anything else to a safe fallback. installTextSanitizer() wraps the four
// jsPDF entry points that take strings so EVERY piece of text is cleaned,
// no matter which section wrote it.
// ---------------------------------------------------------------------------

/** Unicode code points that CP1252 *can* represent in its 0x80–0x9F range. */
const CP1252_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0xff || CP1252_EXTRA.has(cp)) {
      out += ch;
      continue;
    }
    // Strip accents / decompose; keep it only if the result is pure Latin-1.
    const ascii = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += ascii && /^[\x00-\xff]+$/.test(ascii) ? ascii : "?";
  }
  return out;
}

export function sanitizeForPdf(text: unknown): string {
  if (text == null) return "";
  const s = String(text)
    .replace(/[₹₨]/g, "Rs. ") // ₹ rupee, ₨ old rupee sign
    .replace(/[→➡]/g, "->")
    .replace(/←/g, "<-")
    .replace(/[≥≧]/g, ">=")
    .replace(/[≤≦]/g, "<=")
    .replace(/≠/g, "!=")
    .replace(/[​-‍⁠﻿]/g, "") // zero-width joiners/spaces
    .replace(/[ -   　]/g, " "); // exotic spaces
  return toWinAnsi(s);
}

function installTextSanitizer(doc: JsPDF): void {
  const rawText = doc.text.bind(doc);
  doc.text = function (t: string | string[], x: number, y: number, ...rest: unknown[]) {
    const clean = Array.isArray(t) ? t.map(sanitizeForPdf) : sanitizeForPdf(t);
    return (rawText as (...a: unknown[]) => JsPDF)(clean, x, y, ...rest);
  } as typeof doc.text;

  const rawSplit = doc.splitTextToSize.bind(doc);
  doc.splitTextToSize = function (t: string, len: number, ...rest: unknown[]) {
    return (rawSplit as (...a: unknown[]) => string[])(sanitizeForPdf(t), len, ...rest);
  } as typeof doc.splitTextToSize;

  const rawWidth = doc.getTextWidth.bind(doc);
  doc.getTextWidth = function (t: string) {
    return (rawWidth as (s: string) => number)(sanitizeForPdf(t));
  } as typeof doc.getTextWidth;

  const rawLink = doc.textWithLink.bind(doc);
  doc.textWithLink = function (t: string, x: number, y: number, options: unknown) {
    return (rawLink as (...a: unknown[]) => number)(
      sanitizeForPdf(t),
      x,
      y,
      options,
    );
  } as typeof doc.textWithLink;
}

/**
 * Clamp a wrapped-text block to `max` lines, ending the last kept line with
 * an ellipsis when content was dropped. Never returns an empty array.
 */
function clampLines(lines: string[], max: number): string[] {
  if (lines.length === 0) return ["—"];
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const trimmed = kept[max - 1].replace(/\s+\S*$/, "").trimEnd();
  kept[max - 1] = `${trimmed || kept[max - 1]}…`;
  return kept;
}

/** True when a mandatory declaration is genuinely absent (not merely un-photographed). */
function isGenuinelyMissing(i: ComplianceItem): boolean {
  if (i.status) return i.status === "missing";
  return !i.present && !isNotApplicable(i);
}

/**
 * BUG 4c — refuse to build a report for a photo that was not a packaged
 * product: an empty analysis (no ingredients, no declarations, no scores,
 * no identity) or a category the router flagged as not-a-product.
 */
function looksNotAPackagedProduct(a: ProductAnalysis): boolean {
  const cat = String(a.detected_category?.category ?? "");
  if (/not[_\s-]?a[_\s-]?packaged|not[_\s-]?a[_\s-]?product/i.test(cat)) return true;
  const noIngredients = (a.ingredient_analysis ?? []).length === 0;
  const noCompliance =
    Object.keys(a.legal_metrology_compliance ?? {}).length === 0;
  const noScores =
    a.overall_assessment?.safety_score == null &&
    a.overall_assessment?.compliance_score == null;
  const noIdentity = !a.product_info?.name && !a.product_info?.brand;
  return noIngredients && noCompliance && noScores && noIdentity;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n || 0)));

const fmt = (v?: string | null) =>
  v != null && String(v).trim() ? String(v).trim() : "—";

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const DECLARATION_LABELS: Record<string, string> = {
  manufacturer_info: "Manufacturer name & address",
  generic_name: "Generic / common name",
  net_quantity: "Net quantity",
  manufacture_date: "Month & year of manufacture",
  best_before_use_by: "Best before / use by date",
  mrp: "MRP (incl. of all taxes)",
  unit_sale_price: "Unit sale price",
  consumer_care: "Consumer care details",
  country_of_origin: "Country of origin",
  fssai_license: "FSSAI licence number",
  dimensions_if_applicable: "Dimensions (if applicable)",
};
const declLabel = (k: string) => DECLARATION_LABELS[k] ?? titleCase(k);

const isNotApplicable = (i: ComplianceItem) =>
  !i.present && i.compliant && /not applicable/i.test(i.issue ?? "");

function statusStyle(s: SafetyStatus): { label: string; color: RGB; tint: RGB } {
  switch (s) {
    case "safe":
      return { label: "SAFE", color: GREEN, tint: TINT_GREEN };
    case "caution":
      return { label: "CAUTION", color: AMBER, tint: TINT_AMBER };
    case "harmful":
      return { label: "HARMFUL", color: RED, tint: TINT_RED };
    case "banned":
      return { label: "BANNED", color: RED_DARK, tint: TINT_RED };
    default:
      return { label: "UNKNOWN", color: MUTED, tint: TINT_ZINC };
  }
}

const CONCERN_TYPE_LABEL: Record<string, string> = {
  refined_grain: "Refined grain",
  added_sugar: "Added sugar",
  refined_oil: "Refined oil",
  high_sodium: "High sodium",
  saturated_fat: "Saturated fat",
  trans_fat: "Trans fat",
  processed_protein: "Processed meat",
  low_nutrient_density: "Low nutrient density",
};

function concernStyle(level: NutritionalConcernLevel): {
  label: string;
  color: RGB;
  tint: RGB;
} {
  switch (level) {
    case "significant":
      return { label: "Significant", color: ORANGE, tint: TINT_ORANGE };
    case "moderate":
      return { label: "Moderate", color: AMBER, tint: TINT_AMBER };
    default:
      return { label: "Mild", color: MUTED, tint: TINT_ZINC };
  }
}

function scoreBand(score: number): { word: string; rgb: RGB } {
  const s = clamp(score);
  if (s >= 80) return { word: "Safe", rgb: GREEN };
  if (s >= 50) return { word: "Caution", rgb: AMBER };
  return { word: "Unsafe", rgb: RED };
}

/** The big banner line, keyed off the verdict rather than the safety score — v.text is legacy/unused since FIX 6, v.rgb still used for colour. */
const VERDICT_TEXT: Record<Verdict, { text: string; rgb: RGB }> = {
  safe: { text: "SAFE TO CONSUME", rgb: GREEN },
  caution: { text: "CONSUME WITH CAUTION", rgb: AMBER },
  limit: { text: "OKAY OCCASIONALLY - NOT AN EVERYDAY CHOICE", rgb: ORANGE },
  avoid: { text: "AVOID THIS PRODUCT", rgb: RED },
};

function complianceVerdict(a: ProductAnalysis): {
  key: "compliant" | "partial" | "non_compliant" | "unknown";
  text: string;
  color: RGB;
} {
  // Declarations that were simply not photographed ('not_visible') are not
  // failures — exclude them from the verdict denominator entirely.
  const items = Object.values(a.legal_metrology_compliance ?? {}).filter(
    (v) => !isNotApplicable(v) && v.status !== "not_visible",
  );
  if (items.length === 0)
    return { key: "unknown", text: "COMPLIANCE NOT ASSESSED", color: MUTED };
  // "ok_inferred" (e.g. country of origin resolved from an Indian address) is a
  // pass — compliant, just not explicitly declared.
  const pass = items.filter(
    (v) => (v.present && v.compliant) || v.status === "ok_inferred",
  ).length;
  if (pass === items.length)
    return { key: "compliant", text: "COMPLIANT", color: GREEN };
  if (pass === 0)
    return { key: "non_compliant", text: "NON-COMPLIANT", color: RED };
  return { key: "partial", text: "PARTIALLY COMPLIANT", color: AMBER };
}

function ingredientCounts(list: IngredientAnalysis[]): Record<SafetyStatus, number> {
  const c: Record<SafetyStatus, number> = {
    safe: 0,
    caution: 0,
    harmful: 0,
    banned: 0,
    unknown: 0,
  };
  for (const ing of list) c[ing.safety_status] = (c[ing.safety_status] ?? 0) + 1;
  return c;
}

function referenceFor(name: string) {
  if (HEALTHIER_ALTERNATIVES[name]) return HEALTHIER_ALTERNATIVES[name];
  const key = Object.keys(HEALTHIER_ALTERNATIVES).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? HEALTHIER_ALTERNATIVES[key] : undefined;
}

function splitAlternatives(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[;,]|\bor\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultFileName(a: ProductAnalysis, when: Date): string {
  const slug = (a.product_info?.name ?? "product")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const d = when.toISOString().slice(0, 10).replace(/-/g, "");
  return `healthrepo-${slug || "report"}-${d}`;
}

// ---------------------------------------------------------------------------
// Layout engine
// ---------------------------------------------------------------------------

interface Cell {
  text: string;
  textColor?: RGB;
  fillColor?: RGB;
  bold?: boolean;
}
interface Column {
  header: string;
  /** relative weight */
  w: number;
  align?: "left" | "center";
}

class Layout {
  readonly doc: JsPDF;
  readonly pageW: number;
  readonly pageH: number;
  readonly margin = 40;
  /** content must stop above this to leave room for the footer */
  readonly bottom: number;
  y: number;

  constructor(doc: JsPDF) {
    this.doc = doc;
    this.pageW = doc.internal.pageSize.getWidth();
    this.pageH = doc.internal.pageSize.getHeight();
    // Keep clear of the fixed footer block (rule + 2 credit lines + 2
    // disclaimer lines drawn from pageH - margin - 34). BUG 5.
    this.bottom = this.pageH - this.margin - 52;
    this.y = this.margin;
  }

  get contentW() {
    return this.pageW - this.margin * 2;
  }

  addPage() {
    this.doc.addPage();
    this.y = this.margin;
  }

  ensure(h: number) {
    if (this.y + h > this.bottom) this.addPage();
  }

  gap(h = 8) {
    this.y += h;
  }

  heading(text: string) {
    this.ensure(38);
    this.gap(8);
    ink(this.doc, TEAL_DARK);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(13);
    this.doc.text(text.toUpperCase(), this.margin, this.y + 10, {
      maxWidth: this.contentW,
    });
    this.y += 15;
    stroke(this.doc, TEAL);
    this.doc.setLineWidth(1);
    this.doc.line(this.margin, this.y, this.margin + this.contentW, this.y);
    this.y += 12;
  }

  paragraph(
    text: string,
    opts: { size?: number; color?: RGB; bold?: boolean; gapAfter?: number } = {},
  ) {
    const size = opts.size ?? 9.5;
    const lineH = size * 1.4;
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    ink(this.doc, opts.color ?? INK);
    for (const ln of this.doc.splitTextToSize(text, this.contentW) as string[]) {
      this.ensure(lineH);
      this.doc.text(ln, this.margin, this.y + size * 0.9);
      this.y += lineH;
    }
    this.gap(opts.gapAfter ?? 4);
  }

  labelledParagraph(label: string, value: string, valueColor: RGB = INK) {
    this.ensure(24);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    ink(this.doc, TEAL_DARK);
    this.doc.text(label, this.margin, this.y + 8);
    this.y += 12;
    this.paragraph(value, { size: 9, color: valueColor, gapAfter: 6 });
  }

  chip(text: string, x: number, y: number, color: RGB, tint: RGB): number {
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(7);
    const w = this.doc.getTextWidth(text) + 10;
    fill(this.doc, tint);
    this.doc.roundedRect(x, y - 1, w, 12, 2, 2, "F");
    ink(this.doc, color);
    this.doc.text(text, x + 5, y + 7.5);
    return w;
  }

  bigVerdict(text: string, color: RGB) {
    this.gap(6);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(17);
    ink(this.doc, color);
    const maxW = this.contentW - 20;
    const lines = this.doc.splitTextToSize(text, maxW) as string[];
    const lineH = 22;
    this.ensure(lines.length * lineH + 8);
    lines.forEach((ln, i) => {
      this.doc.text(ln, this.margin + this.contentW / 2, this.y + 14 + i * lineH, {
        align: "center",
        maxWidth: maxW,
      });
    });
    this.y += lines.length * lineH + 8;
  }

  /** BUG 4a — printed instead of a score bar when the label was only partly readable. */
  insufficientScore(label: string) {
    this.ensure(24);
    ink(this.doc, INK);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.doc.text(label, this.margin, this.y + 9);
    ink(this.doc, MUTED);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
    this.doc.text(
      "Insufficient data — partial label only",
      this.margin + 118,
      this.y + 9,
      { maxWidth: this.contentW - 118 },
    );
    this.y += 20;
  }

  scoreBar(label: string, score: number) {
    const s = clamp(score);
    this.ensure(26);
    ink(this.doc, INK);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.doc.text(label, this.margin, this.y + 9);
    const barX = this.margin + 118;
    const barW = this.contentW - 118 - 78;
    const barH = 10;
    const by = this.y + 2;
    fill(this.doc, [234, 234, 238]);
    this.doc.roundedRect(barX, by, barW, barH, 3, 3, "F");
    const band = scoreBand(s);
    fill(this.doc, band.rgb);
    this.doc.roundedRect(barX, by, Math.max(6, (barW * s) / 100), barH, 3, 3, "F");
    ink(this.doc, band.rgb);
    this.doc.setFontSize(9.5);
    this.doc.text(`${s}/100  ${band.word}`, barX + barW + 8, this.y + 9);
    this.y += 20;
  }

  bullets(items: string[], color: RGB = INK) {
    const lineH = 12.6;
    const maxLines = Math.max(3, Math.floor((this.bottom - this.margin) / lineH));
    for (const it of items) {
      const lines = clampLines(
        this.doc.splitTextToSize(it, this.contentW - 14) as string[],
        maxLines,
      );
      this.ensure(lines.length * lineH);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(9);
      ink(this.doc, color);
      this.doc.text("•", this.margin + 2, this.y + 8);
      lines.forEach((ln, i) => {
        this.doc.text(ln, this.margin + 14, this.y + 8 + i * lineH);
      });
      this.y += lines.length * lineH + 3;
    }
    this.gap(2);
  }

  table(columns: Column[], rows: Cell[][]) {
    const totalW = columns.reduce((s, c) => s + c.w, 0);
    const colW = columns.map((c) => (c.w / totalW) * this.contentW);
    const padX = 5;
    const padY = 5;
    const lineH = 11;
    const headerH = 19;

    const drawHeaderRow = () => {
      fill(this.doc, TEAL);
      this.doc.rect(this.margin, this.y, this.contentW, headerH, "F");
      ink(this.doc, [255, 255, 255]);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(8);
      let cx = this.margin;
      columns.forEach((c, i) => {
        const tx = c.align === "center" ? cx + colW[i] / 2 : cx + padX;
        this.doc.text(c.header.toUpperCase(), tx, this.y + 12, {
          align: c.align === "center" ? "center" : "left",
          maxWidth: colW[i] - padX * 2,
        });
        cx += colW[i];
      });
      this.y += headerH;
    };

    this.ensure(headerH + 22);
    drawHeaderRow();
    this.doc.setFontSize(8);

    const bodyH = this.bottom - this.margin - headerH;
    const maxCellLines = Math.max(3, Math.floor((bodyH - padY * 2) / lineH));

    rows.forEach((row, ri) => {
      // BUG 5 — cap each cell so a single row can never be taller than the
      // page body (which would force it to overflow or split across pages).
      const wrapped = row.map((cell, i) =>
        clampLines(
          this.doc.splitTextToSize(cell.text || "—", colW[i] - padX * 2) as string[],
          maxCellLines,
        ),
      );
      const rowH = Math.max(
        18,
        ...wrapped.map((l) => l.length * lineH + padY * 2),
      );

      if (this.y + rowH > this.bottom) {
        this.addPage();
        drawHeaderRow();
        this.doc.setFontSize(8);
      }

      let cx = this.margin;
      row.forEach((cell, i) => {
        const bg = cell.fillColor ?? (ri % 2 ? ZEBRA : null);
        if (bg) {
          fill(this.doc, bg);
          this.doc.rect(cx, this.y, colW[i], rowH, "F");
        }
        cx += colW[i];
      });

      stroke(this.doc, LINE);
      this.doc.setLineWidth(0.5);
      this.doc.rect(this.margin, this.y, this.contentW, rowH);
      cx = this.margin;
      columns.forEach((_, i) => {
        if (i > 0) this.doc.line(cx, this.y, cx, this.y + rowH);
        cx += colW[i];
      });

      cx = this.margin;
      row.forEach((cell, i) => {
        this.doc.setFont("helvetica", cell.bold ? "bold" : "normal");
        ink(this.doc, cell.textColor ?? INK);
        const centered = columns[i].align === "center";
        let ty = this.y + padY + 8;
        for (const ln of wrapped[i]) {
          this.doc.text(ln, centered ? cx + colW[i] / 2 : cx + padX, ty, {
            align: centered ? "center" : "left",
          });
          ty += lineH;
        }
        cx += colW[i];
      });

      this.y += rowH;
    });

    this.gap(8);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function drawHeader(
  R: Layout,
  a: ProductAnalysis,
  scannedAt: Date,
  scanId: string | null,
  image: RasterImage | null,
) {
  const { doc, margin, pageW } = R;
  const cat = resolveCategory(a.detected_category);

  ink(doc, TEAL);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("HealthRepo Safety Report", margin, margin + 10);

  ink(doc, MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Scan date: ${scannedAt.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    })}`,
    margin,
    margin + 28,
  );
  doc.text(
    `Product category: ${cat.label}  ·  Regulatory body: ${cat.regulatoryBody}`,
    margin,
    margin + 40,
  );
  if (scanId) doc.text(`Report ID: ${scanId}`, margin, margin + 52);

  // Bottom of the text column (last baseline + a little descender room).
  const textBlockBottom = margin + (scanId ? 52 : 40) + 6;

  // BUG 3 — the divider must clear BOTH the text block and the photo. Draw
  // the photo first so we know its real height, then place the rule below
  // whichever is lower, with >= 8pt of breathing room.
  let imageBottom = 0;
  if (image) {
    try {
      const maxW = 92;
      const maxH = 92;
      let w = maxW;
      let h = (image.height / image.width) * maxW;
      if (h > maxH) {
        h = maxH;
        w = (image.width / image.height) * maxH;
      }
      const iy = margin - 4;
      stroke(doc, LINE);
      doc.setLineWidth(0.5);
      doc.rect(pageW - margin - w, iy, w, h);
      doc.addImage(image.dataUrl, "PNG", pageW - margin - w, iy, w, h);
      imageBottom = iy + h;
    } catch {
      /* embedding failed — carry on without the photo */
      imageBottom = 0;
    }
  }

  R.y = Math.max(textBlockBottom, imageBottom) + 10;
  fill(doc, TEAL);
  doc.rect(margin, R.y, R.contentW, 2, "F");
  R.y += 14;
}

function drawProductInfo(R: Layout, a: ProductAnalysis) {
  const p = a.product_info ?? ({} as ProductAnalysis["product_info"]);
  const cat = resolveCategory(a.detected_category);
  R.heading("Product Information");

  const pairs: [string, string][] = [
    ["Product name", fmt(p.name)],
    ["Brand", fmt(p.brand)],
    ["Category", p.category ? titleCase(p.category) : "—"],
    ["MRP", fmt(p.mrp)],
    ["Net weight", fmt(p.net_weight)],
    ["Manufacture date", fmt(p.manufacture_date)],
    ["Expiry / best before", fmt(p.expiry_date)],
    ["FSSAI licence no.", fmt(p.fssai_license)],
    ["Batch no.", fmt(p.batch_number)],
    ["Country of origin", fmt(p.country_of_origin)],
  ];

  // BUG 2 — each value wraps inside its half-width column and is capped at
  // two lines (ellipsis on overflow) so nothing runs off the page or bleeds
  // into the adjacent column. Row height follows the taller of the two cells.
  const colW = R.contentW / 2;
  const valW = colW - 12;
  for (let i = 0; i < pairs.length; i += 2) {
    const cells = [pairs[i], pairs[i + 1]].filter(Boolean) as [string, string][];
    const wrapped = cells.map(([, value]) =>
      clampLines(R.doc.splitTextToSize(value || "—", valW) as string[], 2),
    );
    const maxLines = Math.max(1, ...wrapped.map((w) => w.length));
    const rowH = 12 + maxLines * 11 + 6;
    R.ensure(rowH);
    cells.forEach(([label], c) => {
      const x = R.margin + c * colW;
      ink(R.doc, MUTED);
      R.doc.setFont("helvetica", "bold");
      R.doc.setFontSize(7);
      R.doc.text(label.toUpperCase(), x, R.y + 7);
      ink(R.doc, INK);
      R.doc.setFont("helvetica", "normal");
      R.doc.setFontSize(9.5);
      wrapped[c].forEach((ln, li) => {
        R.doc.text(ln, x, R.y + 18 + li * 11);
      });
    });
    R.y += rowH;
  }

  R.gap(6);
  R.labelledParagraph("Manufacturer / packer & address", fmt(p.manufacturer_address));
  R.labelledParagraph("Consumer care", fmt(p.customer_care));
  R.labelledParagraph(
    "Regulations applied",
    `${cat.label} — assessed under ${cat.act}, regulated by ${cat.regulatoryBody}.`,
    TEAL_DARK,
  );
}

function drawPersonalAlerts(R: Layout, a: ProductAnalysis) {
  // Product-level alerts + every ingredient's own personal flags.
  const flags = [
    ...(a.personal_alerts ?? []).map((f) => ({
      label: f.ingredient ?? null,
      reason: f.reason,
      severity: f.severity,
    })),
    ...(a.ingredient_analysis ?? []).flatMap((ing) =>
      (ing.personal_flags ?? []).map((f) => ({
        label: f.ingredient ?? ing.name,
        reason: f.reason,
        severity: f.severity,
      })),
    ),
  ].filter((f) => f.reason && f.reason.trim());

  // Nothing to say -> omit the section entirely (user has no profile / no conflicts).
  if (flags.length === 0) return;

  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  flags.sort((x, y) => (rank[x.severity] ?? 3) - (rank[y.severity] ?? 3));

  R.heading("Personalized Health Alerts");
  R.paragraph(
    "Based on your health profile, the following ingredients require your attention:",
    { gapAfter: 4 },
  );

  const lines = flags.map((f) => {
    const tag =
      f.severity === "critical"
        ? "[CRITICAL] "
        : f.severity === "warning"
          ? "[WARNING] "
          : "[INFO] ";
    return `${tag}${f.label ? `${f.label} — ` : ""}${f.reason}`;
  });
  R.bullets(lines, INK);

  R.paragraph(
    "This personalized section is based on the health profile you configured in HealthRepo.",
    { size: 8, color: MUTED, gapAfter: 6 },
  );
}

function drawCompliance(R: Layout, a: ProductAnalysis) {
  R.heading("Legal Metrology Compliance");

  const entries = Object.entries(a.legal_metrology_compliance ?? {});
  if (entries.length === 0) {
    R.paragraph(
      "No Legal Metrology declarations could be assessed from the scanned text.",
      { color: MUTED },
    );
  } else {
    const rows: Cell[][] = entries.map(([key, item]) => {
      const notVisible = item.status === "not_visible";
      const okInferred = item.status === "ok_inferred";
      const s = isNotApplicable(item)
        ? { label: "N/A", color: MUTED, tint: TINT_ZINC }
        : notVisible
          ? { label: "NOT VISIBLE", color: MUTED, tint: TINT_ZINC }
          : okInferred
            ? { label: "OK (INFERRED)", color: GREEN, tint: TINT_GREEN }
            : item.present && item.compliant
              ? { label: "OK", color: GREEN, tint: TINT_GREEN }
              : item.present
                ? { label: "ISSUE", color: AMBER, tint: TINT_AMBER }
                : { label: "MISSING", color: RED, tint: TINT_RED };
      const issueText = isNotApplicable(item)
        ? "Not applicable"
        : notVisible
          ? "This part of the label was not captured"
          : okInferred
            ? fmt(item.note ?? item.issue)
            : fmt(item.issue);
      return [
        { text: declLabel(key), bold: true },
        {
          text: s.label,
          textColor: s.color,
          fillColor: s.tint,
          bold: true,
        },
        { text: fmt(item.value) },
        {
          text: issueText,
          textColor:
            item.issue && !isNotApplicable(item) && !notVisible && !okInferred
              ? AMBER
              : INK,
        },
      ];
    });

    R.table(
      [
        { header: "Declaration", w: 26 },
        { header: "Status", w: 13, align: "center" },
        { header: "Value found", w: 33 },
        { header: "Issue", w: 28 },
      ],
      rows,
    );
  }

  const verdict = complianceVerdict(a);
  const cScore = a.overall_assessment?.compliance_score;
  const cInsufficient =
    cScore == null ||
    a.overall_assessment?.compliance_status === "insufficient_data";
  // BUG 4a — never print a fabricated score for a partial label.
  R.bigVerdict(
    cInsufficient ? verdict.text : `${verdict.text}  ·  ${clamp(cScore as number)}/100`,
    verdict.color,
  );
  if (cInsufficient) {
    R.paragraph("Insufficient data — partial label only", {
      size: 9,
      color: MUTED,
      gapAfter: 4,
    });
  }

  if (verdict.key === "non_compliant" || verdict.key === "partial") {
    // BUG 4b — list only genuinely missing declarations, never 'not_visible' ones.
    const violations = Object.entries(a.legal_metrology_compliance ?? {})
      .filter(([, v]) => isGenuinelyMissing(v) || (v.present && !v.compliant))
      .map(
        ([k, v]) =>
          `${declLabel(k)} — ${
            v.issue ?? (v.present ? "present but not compliant" : "missing from the label")
          }`,
      );
    if (violations.length) {
      R.paragraph("Specific violations:", { bold: true, color: RED, gapAfter: 2 });
      R.bullets(violations, INK);
    }
  }
}

function drawIngredients(R: Layout, a: ProductAnalysis) {
  const list = a.ingredient_analysis ?? [];
  const catId = a.detected_category?.category;
  R.heading("Ingredient Safety Analysis");

  const counts = ingredientCounts(list);
  R.ensure(18);
  {
    const parts: [string, RGB][] = [
      [`${counts.safe} safe`, GREEN],
      [`${counts.caution} caution`, AMBER],
      [`${counts.harmful} harmful`, RED],
      [`${counts.banned} banned`, RED_DARK],
    ];
    if (counts.unknown) parts.push([`${counts.unknown} unknown`, MUTED]);
    let x = R.margin;
    R.doc.setFont("helvetica", "bold");
    R.doc.setFontSize(10);
    parts.forEach(([t, c], i) => {
      ink(R.doc, c);
      R.doc.text(t, x, R.y + 8);
      x += R.doc.getTextWidth(t);
      if (i < parts.length - 1) {
        ink(R.doc, MUTED);
        R.doc.text("   •   ", x, R.y + 8);
        x += R.doc.getTextWidth("   •   ");
      }
    });
    R.y += 20;
  }

  if (list.length === 0) {
    R.paragraph("No individual ingredients were identified in the scanned text.", {
      color: MUTED,
    });
    return;
  }

  const concerning = list.filter((i) => i.safety_status !== "safe");
  const safe = list.filter((i) => i.safety_status === "safe");

  if (concerning.length) {
    R.paragraph("Ingredients of concern", { bold: true, color: RED_DARK, gapAfter: 4 });
    for (const ing of concerning) {
      const st = statusStyle(ing.safety_status);
      R.ensure(34);
      R.gap(2);
      R.doc.setFont("helvetica", "bold");
      R.doc.setFontSize(11);
      ink(R.doc, st.color);
      R.doc.text(ing.name, R.margin, R.y + 9);
      const nameW = R.doc.getTextWidth(ing.name);
      R.chip(st.label, R.margin + nameW + 8, R.y, st.color, st.tint);
      R.y += 18;

      const phrase = ingredientRiskPhrase(catId, ing.safety_status);
      if (phrase)
        R.paragraph(phrase, { size: 9, bold: true, color: st.color, gapAfter: 4 });

      if (ing.reason) R.labelledParagraph("Why this is concerning:", ing.reason);
      if (ing.health_effects)
        R.labelledParagraph("Health effects:", ing.health_effects);
      if (ing.who_should_avoid)
        R.labelledParagraph("Who should avoid:", ing.who_should_avoid);
      if (ing.banned_in_countries?.length)
        R.labelledParagraph("Banned in:", ing.banned_in_countries.join(", "));
      if (ing.healthier_alternative)
        R.labelledParagraph(
          "Healthier alternative:",
          ing.healthier_alternative,
          GREEN,
        );

      R.gap(2);
      stroke(R.doc, LINE);
      R.doc.setLineWidth(0.5);
      R.doc.line(R.margin, R.y, R.margin + R.contentW, R.y);
      R.gap(8);
    }
  }

  if (safe.length) {
    R.gap(4);
    R.paragraph("Ingredients rated safe", { bold: true, color: GREEN, gapAfter: 4 });
    R.table(
      [
        { header: "Ingredient", w: 34 },
        { header: "Status", w: 16, align: "center" },
        { header: "Note", w: 50 },
      ],
      safe.map((ing) => [
        { text: ing.name, bold: true },
        { text: "SAFE", textColor: GREEN, fillColor: TINT_GREEN, bold: true },
        { text: fmt(ing.reason) },
      ]),
    );
  }
}

/**
 * STEP 9 — nutritional quality. Skipped entirely for non-food products, where
 * `nutritional_analysis` is absent by design. Every string goes through the
 * Layout helpers, so it is sanitised and wrapped like everything else.
 */
function drawNutrition(R: Layout, a: ProductAnalysis) {
  const n = a.nutritional_analysis;
  if (!n) return; // non-food: the section does not exist

  R.heading("Nutritional Quality");

  R.paragraph(
    "This is a separate dimension from safety. Every ingredient below is legal and additive-free — the concern is dietary quality, not danger.",
    { size: 8.5, color: MUTED, gapAfter: 6 },
  );

  // A null safety score means the ingredients could not be read, so nutrition
  // cannot be scored either — belt and braces alongside the same rule in
  // lib/enrich-analysis.ts, since stored rows also reach this generator.
  const ingredientsUnreadable =
    a.overall_assessment?.safety_score == null ||
    a.overall_assessment?.safety_status === "insufficient_data";
  if (n.nutrition_score == null || ingredientsUnreadable)
    R.insufficientScore("Nutrition score");
  else R.scoreBar("Nutrition score", n.nutrition_score);

  if (!ingredientsUnreadable) {
    const FOOD_TYPE_LABEL: Record<string, string> = {
      staple_ingredient: "Staple ingredient — scored on the gentler cooking-input scale",
      minimally_processed: "Minimally processed whole food",
      processed_product: "Processed product — strict scoring applies",
    };
    R.paragraph(FOOD_TYPE_LABEL[n.food_type] ?? "Processed product", {
      bold: true,
      color: n.food_type === "processed_product" ? MUTED : GREEN,
      gapAfter: 2,
    });

    const DENSITY_LABEL: Record<string, string> = {
      high: "High nutrient density",
      moderate: "Moderate nutrient density",
      low: "Low nutrient density",
      empty: "Empty — negligible nutrition",
    };
    R.paragraph(
      DENSITY_LABEL[n.nutrient_density] ?? "Nutrient density: not assessed",
      {
        bold: true,
        color: n.nutrient_density === "high" ? GREEN : ORANGE,
        gapAfter: 2,
      },
    );
    if (n.density_note && n.food_type !== "staple_ingredient") {
      R.paragraph(n.density_note, { size: 9, color: MUTED, gapAfter: 6 });
    }
  }

  if (n.primary_concern && !ingredientsUnreadable) {
    R.paragraph(`Primary concern: ${n.primary_concern.explanation}`, {
      bold: true,
      color: ORANGE,
      gapAfter: 6,
    });
  }

  if (!n.nutrition_data_complete) {
    R.paragraph(
      "Nutrition panel not visible — the values per 100 g/ml could not be read, so this assessment is based on the ingredients list alone. Scan the back of the pack for a complete assessment.",
      { size: 9, color: AMBER, gapAfter: 6 },
    );
  }

  if (n.is_ultra_processed) {
    R.paragraph("Ultra-processed food", { bold: true, color: AMBER, gapAfter: 2 });
    R.paragraph(
      "Diets high in ultra-processed foods are associated with obesity, cardiovascular disease and type 2 diabetes regardless of individual ingredient safety.",
      { size: 9, gapAfter: 6 },
    );
  }

  if (n.sugar_alias_count >= 3) {
    R.paragraph(
      `Sugar is listed under ${n.sugar_alias_count} different names`,
      { bold: true, color: AMBER, gapAfter: 2 },
    );
    R.paragraph(
      "This product lists sugar under multiple names, which makes the total sugar content appear lower in the ingredients order than it actually is.",
      { size: 9, gapAfter: 2 },
    );
    R.paragraph(`Names found: ${n.sugar_aliases_found.join(", ")}`, {
      size: 9,
      color: MUTED,
      gapAfter: 6,
    });
  }

  if (n.ingredient_order_note) {
    R.paragraph(n.ingredient_order_note, { size: 9, gapAfter: 6 });
  }

  // ---- Nutrition panel readings ----
  if (n.threshold_flags.length) {
    R.paragraph("Nutrition panel", { bold: true, gapAfter: 2 });
    R.table(
      [
        { header: "Nutrient", w: 22 },
        { header: "Per 100 g / ml", w: 20, align: "center" },
        { header: "Level", w: 16, align: "center" },
        { header: "Reference band", w: 42 },
      ],
      n.threshold_flags.map((f) => {
        const bonus = f.penalty < 0;
        const s = bonus
          ? { label: "GOOD", color: GREEN, tint: TINT_GREEN }
          : f.level === "very_high"
            ? { label: "VERY HIGH", color: RED, tint: TINT_RED }
            : f.level === "high"
              ? { label: "HIGH", color: RED, tint: TINT_RED }
              : f.level === "medium_high"
                ? { label: "MEDIUM-HIGH", color: AMBER, tint: TINT_AMBER }
                : f.level === "medium"
                  ? { label: "MEDIUM", color: AMBER, tint: TINT_AMBER }
                  : { label: "LOW", color: GREEN, tint: TINT_GREEN };
        return [
          { text: f.nutrient, bold: true },
          { text: `${f.value_per_100} ${f.unit}` },
          { text: s.label, textColor: s.color, fillColor: s.tint, bold: true },
          { text: fmt(f.reference) },
        ] as Cell[];
      }),
    );
  }

  // ---- Each flagged concern, in full ----
  if (n.concerns.length === 0) {
    R.paragraph("No nutritional concerns were found in the ingredients list.", {
      color: MUTED,
      gapAfter: 6,
    });
  } else {
    R.paragraph(`Flagged ingredients (${n.concerns.length})`, {
      bold: true,
      gapAfter: 4,
    });
    for (const c of n.concerns) {
      const style = concernStyle(c.concern_level);
      R.ensure(46);
      // Name + level chip on one line.
      R.doc.setFont("helvetica", "bold");
      R.doc.setFontSize(10);
      ink(R.doc, INK);
      const nameLines = clampLines(
        R.doc.splitTextToSize(c.ingredient, R.contentW - 120) as string[],
        2,
      );
      nameLines.forEach((ln, i) => {
        R.doc.text(ln, R.margin, R.y + 9 + i * 12);
      });
      R.chip(
        `${style.label} · ${CONCERN_TYPE_LABEL[c.concern_type] ?? c.concern_type}`.toUpperCase(),
        R.margin + R.contentW - 118,
        R.y + 1,
        style.color,
        style.tint,
      );
      R.y += nameLines.length * 12 + 4;

      if (c.why_flagged) R.paragraph(c.why_flagged, { size: 9, gapAfter: 3 });
      if (c.health_effects) R.labelledParagraph("What it does", c.health_effects);
      if (c.moderation_guidance)
        R.labelledParagraph("How much is fine", c.moderation_guidance);
      if (c.who_should_limit.length)
        R.labelledParagraph(
          "Who should limit it",
          c.who_should_limit.join(", "),
        );
      if (c.better_alternative)
        R.labelledParagraph("Better alternative", c.better_alternative, GREEN);
      R.gap(4);
    }
  }

  if (n.positive_notes.length) {
    R.paragraph("Positives", { bold: true, color: GREEN, gapAfter: 2 });
    R.bullets(n.positive_notes, INK);
  }

  if (n.moderation_advice) {
    R.paragraph("In practice", { bold: true, gapAfter: 2 });
    R.paragraph(n.moderation_advice, { size: 9, gapAfter: 6 });
  }
}

function drawDosage(R: Layout, a: ProductAnalysis) {
  const d = a.dosage_analysis;
  R.heading("Additive Dosage Analysis");

  if (!d) {
    R.paragraph("No additive dosage data was recorded for this scan.", {
      color: MUTED,
    });
    return;
  }

  const c = d.additive_count;
  R.table(
    [
      { header: "Additive type", w: 60 },
      { header: "Count", w: 20, align: "center" },
    ],
    (
      [
        ["Preservatives", c.preservatives],
        ["Colours", c.colors],
        ["Sweeteners", c.sweeteners],
        ["Antioxidants", c.antioxidants],
        ["Emulsifiers", c.emulsifiers],
        ["Flavour enhancers", c.flavor_enhancers],
        ["Total additives", c.total],
      ] as [string, number][]
    ).map(([label, n], i) => {
      const isTotal = i === 6;
      return [
        { text: label, bold: isTotal },
        { text: String(n), bold: isTotal },
      ] as Cell[];
    }),
  );

  if (d.limit_checks.length) {
    const rows: Cell[][] = d.limit_checks.map((lc) => {
      const s =
        lc.status === "within_limit"
          ? { label: "WITHIN LIMIT", color: GREEN, tint: TINT_GREEN }
          : lc.status === "exceeds_limit"
            ? { label: "EXCEEDS LIMIT", color: RED, tint: TINT_RED }
            : { label: "NOT DECLARED", color: AMBER, tint: TINT_AMBER };
      return [
        { text: lc.name, bold: true },
        { text: s.label, textColor: s.color, fillColor: s.tint, bold: true },
        { text: fmt(lc.fssai_limit) },
        { text: fmt(lc.declared_quantity_if_available) },
        { text: fmt(lc.note) },
      ];
    });
    R.table(
      [
        { header: "Additive", w: 22 },
        { header: "Status", w: 16, align: "center" },
        { header: "FSSAI limit", w: 20 },
        { header: "Declared", w: 15 },
        { header: "Note", w: 27 },
      ],
      rows,
    );
  } else {
    R.paragraph("No additive-specific FSSAI limit checks were returned.", {
      color: MUTED,
    });
  }

  const riskColor =
    d.cumulative_risk === "high"
      ? RED
      : d.cumulative_risk === "medium"
        ? AMBER
        : GREEN;
  R.bigVerdict(
    `OVERALL ADDITIVE LOAD: ${d.cumulative_risk.toUpperCase()}`,
    riskColor,
  );

  if (d.daily_intake_warning) {
    R.paragraph("Daily intake guidance", { bold: true, gapAfter: 2 });
    R.paragraph(d.daily_intake_warning, { gapAfter: 6 });
  }

  if (d.combination_warnings.length) {
    R.paragraph("Combination warnings", {
      bold: true,
      color: RED,
      gapAfter: 2,
    });
    R.bullets(d.combination_warnings, INK);
  }
}

function drawAlternatives(R: Layout, a: ProductAnalysis) {
  R.heading("Healthier Alternatives");

  const targets = (a.ingredient_analysis ?? []).filter(
    (i) => i.safety_status === "harmful" || i.safety_status === "banned",
  );

  if (targets.length === 0) {
    R.paragraph("No harmful or banned ingredients were found in this product.", {
      color: MUTED,
    });
    return;
  }

  const rows: Cell[][] = targets.map((ing) => {
    const ref = referenceFor(ing.name);
    const alts = ref?.alternatives ?? splitAlternatives(ing.healthier_alternative);
    return [
      { text: ing.name, textColor: RED, bold: true },
      { text: alts.length ? alts.join(", ") : "—", textColor: GREEN },
      {
        text:
          ref?.what_to_look_for_on_label ??
          "Check the ingredients list and pick a product that does not name this additive.",
      },
    ];
  });

  R.table(
    [
      { header: "Harmful ingredient", w: 24 },
      { header: "Recommended alternative", w: 34 },
      { header: "What to look for on labels", w: 42 },
    ],
    rows,
  );
}

function drawOverall(R: Layout, a: ProductAnalysis) {
  const oa = a.overall_assessment;
  R.heading("Overall Assessment");

  // BUG 4a — a null score means the label was only partly readable. Show the
  // honest "insufficient data" line rather than a made-up bar at 0.
  const safetyInsufficient =
    oa?.safety_score == null || oa?.safety_status === "insufficient_data";
  const complianceInsufficient =
    oa?.compliance_score == null || oa?.compliance_status === "insufficient_data";

  if (safetyInsufficient) R.insufficientScore("Safety score");
  else R.scoreBar("Safety score", oa.safety_score as number);

  // Nutrition is a food-only dimension — absent, not zero, for everything else.
  if (a.nutritional_analysis) {
    if (a.nutritional_analysis.nutrition_score == null || safetyInsufficient)
      R.insufficientScore("Nutrition score");
    else R.scoreBar("Nutrition score", a.nutritional_analysis.nutrition_score);
  }

  if (complianceInsufficient) R.insufficientScore("Compliance score");
  else R.scoreBar("Compliance score", oa.compliance_score as number);

  if (oa?.overall_score != null) {
    R.scoreBar("OVERALL", oa.overall_score);
    R.paragraph(
      a.nutritional_analysis
        ? "Overall = safety 35% + nutrition 50% + compliance 15%."
        : "Overall = safety 75% + compliance 25%.",
      { size: 8, color: MUTED, gapAfter: 2 },
    );
  }
  R.gap(4);

  if (oa?.summary) {
    R.paragraph("Summary", { bold: true, gapAfter: 2 });
    R.paragraph(oa.summary, { gapAfter: 8 });
  }

  if (safetyInsufficient) {
    R.bigVerdict("SAFETY VERDICT UNAVAILABLE — PARTIAL SCAN", MUTED);
  } else {
    // The verdict follows the weakest dimension, so it cannot be derived from
    // the safety score alone — a 96/100-safe maida biscuit is 'limit'.
    const v = VERDICT_TEXT[a.verdict];
    const nn = a.nutritional_analysis;
    const nScore = a.overall_assessment?.nutrition_score;
    const stapleSparing =
      nn?.food_type === "staple_ingredient" &&
      (nn.nutrient_density === "empty" ||
        /\b(oil|ghee|sugar|jaggery|gur|salt|namak|honey|syrup)\b/i.test(
          a.product_info?.name ?? "",
        ));

    if (nn?.food_type === "staple_ingredient" && nScore != null) {
      // A cooking ingredient, never a "bad product".
      if (stapleSparing) R.bigVerdict("USE SPARINGLY — A COOKING STAPLE", ORANGE);
      else if (nScore >= 75) R.bigVerdict("GOOD STAPLE", GREEN);
      else R.bigVerdict("FINE STAPLE", GREEN);
    } else if (a.verdict === "safe" && nScore != null) {
      // 'safe' spans nutrition 66-95: 66-75 is "REASONABLE CHOICE", 76+ "GOOD".
      R.bigVerdict(nScore <= 75 ? "REASONABLE CHOICE" : "GOOD CHOICE", GREEN);
    } else if (v) {
      // FIX 6 — category-appropriate wording ("Safe to use", never "Safe to
      // consume", for a non-food product; the medicine notice for
      // drug_or_medical). v.rgb still carries the right colour for the verdict.
      R.bigVerdict(verdictLabel(a.verdict, a.detected_category?.category).toUpperCase(), v.rgb);
    } else {
      const band = scoreBand(oa.safety_score as number);
      R.bigVerdict(
        verdictLabel(a.verdict, a.detected_category?.category).toUpperCase(),
        band.rgb,
      );
    }

    if (nn?.food_type === "staple_ingredient" && nScore != null) {
      R.paragraph(
        stapleSparing
          ? "A cooking staple that is calorie-dense with little else — use it as an ingredient, in small amounts."
          : nScore >= 75
            ? "A sound everyday cooking ingredient."
            : `A normal, affordable staple — nothing to avoid.${
                nn.concerns[0]?.better_alternative
                  ? ` ${nn.concerns[0].better_alternative} is more nutritious.`
                  : ""
              }`,
        { size: 9, color: MUTED, gapAfter: 4 },
      );
    } else if (a.verdict === "limit") {
      R.paragraph(
        "No harmful ingredients, but nutritionally poor — okay occasionally, not as a regular choice.",
        { size: 9, color: MUTED, gapAfter: 4 },
      );
    } else if (a.verdict === "safe" && nScore != null && nScore <= 75) {
      R.paragraph(
        "Fine to eat — nothing harmful — though less refined versions are more nutritious.",
        { size: 9, color: MUTED, gapAfter: 4 },
      );
    }
  }
  if (oa?.recommendation) {
    R.paragraph(oa.recommendation, { size: 9, color: MUTED });
  }
}

function drawActions(R: Layout, a: ProductAnalysis) {
  const verdict = complianceVerdict(a);
  const counts = ingredientCounts(a.ingredient_analysis ?? []);
  const hasViolations =
    verdict.key === "non_compliant" ||
    verdict.key === "partial" ||
    counts.harmful > 0 ||
    counts.banned > 0;

  R.heading("How To Take Action");
  R.paragraph(
    hasViolations
      ? "If you found violations, you can file a complaint. Attach this PDF report and a clear photo of the product and its label."
      : "This product looks compliant. If you still spot an issue on the pack, you can raise it with the authorities below.",
    { gapAfter: 6 },
  );

  const cat = resolveCategory(a.detected_category);
  const links: { label: string; url?: string }[] = [
    {
      label: `Regulator for this product type: ${cat.regulatoryBody} (${cat.act})`,
    },
    ...cat.portals.map((portal) => ({
      label: portal.phone
        ? `${portal.label}: ${portal.url}  ·  call ${portal.phone}`
        : `${portal.label}: ${portal.url}`,
      url: portal.url,
    })),
  ];

  const lineH = 13;
  for (const l of links) {
    R.doc.setFont("helvetica", "normal");
    R.doc.setFontSize(9);
    // Regulator names and portal URLs are long — wrap them inside the content
    // column instead of letting them run past the right margin. (BUG 5.)
    const lines = clampLines(
      R.doc.splitTextToSize(l.label, R.contentW - 14) as string[],
      4,
    );
    R.ensure(lines.length * lineH + 2);
    R.doc.text("•", R.margin + 2, R.y + 8);
    ink(R.doc, l.url ? TEAL_DARK : INK);
    lines.forEach((ln, i) => {
      const ly = R.y + 8 + i * lineH;
      // Every wrapped line of a portal entry links to the same URL.
      if (l.url) R.doc.textWithLink(ln, R.margin + 14, ly, { url: l.url });
      else R.doc.text(ln, R.margin + 14, ly);
    });
    R.y += lines.length * lineH + 2;
  }
  R.gap(4);
}

function drawFooters(R: Layout) {
  const { doc, pageW, pageH, margin } = R;
  const total = doc.getNumberOfPages();
  const disclaimer =
    "Disclaimer: This report is AI-generated for educational and awareness purposes. Consult relevant authorities for official action.";

  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    // Fixed position: rule at pageH - margin - 34, two credit lines, then up
    // to two disclaimer lines ending at ~pageH - margin - 7. Layout.bottom
    // stops body content 18pt above the rule so nothing collides. BUG 5.
    const fy = pageH - margin - 34;

    stroke(doc, LINE);
    doc.setLineWidth(0.5);
    doc.line(margin, fy, pageW - margin, fy);

    ink(doc, MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Generated by HealthRepo | healthrepo.vercel.app", margin, fy + 11);
    doc.text(`Page ${i} of ${total}`, pageW - margin, fy + 11, { align: "right" });

    doc.setFontSize(6.6);
    const lines = (
      doc.splitTextToSize(disclaimer, pageW - margin * 2) as string[]
    ).slice(0, 2);
    lines.forEach((ln, j) => doc.text(ln, margin, fy + 20 + j * 7.5));
  }
}

// ---------------------------------------------------------------------------
// Image rasterisation (html2canvas)
// ---------------------------------------------------------------------------

interface RasterImage {
  dataUrl: string;
  width: number;
  height: number;
}

async function rasterizeImage(src: string): Promise<RasterImage | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();

    const holder = document.createElement("div");
    holder.style.cssText =
      "position:fixed;left:-10000px;top:0;width:auto;height:auto;";
    img.style.cssText = "display:block;max-width:600px;height:auto;";
    holder.appendChild(img);
    document.body.appendChild(holder);

    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(holder, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: true,
      });
      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
      };
    } finally {
      document.body.removeChild(holder);
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
