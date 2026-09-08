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
import type {
  ProductAnalysis,
  IngredientAnalysis,
  ComplianceItem,
  SafetyStatus,
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

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const R = new Layout(doc);

  const scannedAt = input.scannedAt ? new Date(input.scannedAt) : new Date();
  const image = input.imageUrl ? await rasterizeImage(input.imageUrl) : null;

  drawHeader(R, scannedAt, input.scanId ?? null, image);
  drawProductInfo(R, a);
  drawPersonalAlerts(R, a);
  drawCompliance(R, a);
  drawIngredients(R, a);
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
const GREEN: RGB = [22, 163, 74]; // green-600
const INK: RGB = [39, 39, 42];
const MUTED: RGB = [113, 113, 122];
const LINE: RGB = [224, 224, 228];
const ZEBRA: RGB = [250, 250, 251];
const TINT_GREEN: RGB = [220, 252, 231];
const TINT_AMBER: RGB = [254, 243, 199];
const TINT_RED: RGB = [254, 226, 226];
const TINT_ZINC: RGB = [244, 244, 245];

const fill = (d: JsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const stroke = (d: JsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const ink = (d: JsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);

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

function scoreBand(score: number): { word: string; rgb: RGB } {
  const s = clamp(score);
  if (s >= 80) return { word: "Safe", rgb: GREEN };
  if (s >= 50) return { word: "Caution", rgb: AMBER };
  return { word: "Unsafe", rgb: RED };
}

function recommendationText(score: number): string {
  const s = clamp(score);
  if (s >= 80) return "SAFE TO CONSUME";
  if (s >= 50) return "CONSUME WITH CAUTION";
  return "AVOID THIS PRODUCT";
}

function complianceVerdict(a: ProductAnalysis): {
  key: "compliant" | "partial" | "non_compliant" | "unknown";
  text: string;
  color: RGB;
} {
  const items = Object.values(a.legal_metrology_compliance ?? {}).filter(
    (v) => !isNotApplicable(v),
  );
  if (items.length === 0)
    return { key: "unknown", text: "COMPLIANCE NOT ASSESSED", color: MUTED };
  const pass = items.filter((v) => v.present && v.compliant).length;
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
    this.bottom = this.pageH - this.margin - 44;
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
    this.doc.text(text.toUpperCase(), this.margin, this.y + 10);
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
    this.ensure(34);
    this.gap(6);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(17);
    ink(this.doc, color);
    this.doc.text(text, this.margin + this.contentW / 2, this.y + 14, {
      align: "center",
    });
    this.y += 30;
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
    for (const it of items) {
      const lines = this.doc.splitTextToSize(it, this.contentW - 14) as string[];
      const lineH = 12.6;
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

    rows.forEach((row, ri) => {
      const wrapped = row.map((cell, i) =>
        this.doc.splitTextToSize(cell.text || "—", colW[i] - padX * 2),
      ) as string[][];
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
  scannedAt: Date,
  scanId: string | null,
  image: RasterImage | null,
) {
  const { doc, margin, pageW } = R;

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
  if (scanId) doc.text(`Report ID: ${scanId}`, margin, margin + 40);

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
      stroke(doc, LINE);
      doc.setLineWidth(0.5);
      doc.rect(pageW - margin - w, margin - 4, w, h);
      doc.addImage(image.dataUrl, "PNG", pageW - margin - w, margin - 4, w, h);
    } catch {
      /* embedding failed — carry on without the photo */
    }
  }

  R.y = margin + 54;
  fill(doc, TEAL);
  doc.rect(margin, R.y, R.contentW, 2, "F");
  R.y += 14;
}

function drawProductInfo(R: Layout, a: ProductAnalysis) {
  const p = a.product_info ?? ({} as ProductAnalysis["product_info"]);
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

  const colW = R.contentW / 2;
  const rowH = 26;
  pairs.forEach((pair, i) => {
    if (i % 2 === 0) R.ensure(rowH);
    const x = R.margin + (i % 2) * colW;
    ink(R.doc, MUTED);
    R.doc.setFont("helvetica", "bold");
    R.doc.setFontSize(7);
    R.doc.text(pair[0].toUpperCase(), x, R.y + 7);
    ink(R.doc, INK);
    R.doc.setFont("helvetica", "normal");
    R.doc.setFontSize(9.5);
    const line = (R.doc.splitTextToSize(pair[1], colW - 12) as string[])[0] ?? "—";
    R.doc.text(line, x, R.y + 19);
    if (i % 2 === 1 || i === pairs.length - 1) R.y += rowH;
  });

  R.gap(6);
  R.labelledParagraph("Manufacturer / packer & address", fmt(p.manufacturer_address));
  R.labelledParagraph("Consumer care", fmt(p.customer_care));
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
      const s =
        item.present && item.compliant
          ? { label: "OK", color: GREEN, tint: TINT_GREEN }
          : item.present
            ? { label: "ISSUE", color: AMBER, tint: TINT_AMBER }
            : isNotApplicable(item)
              ? { label: "N/A", color: MUTED, tint: TINT_ZINC }
              : { label: "MISSING", color: RED, tint: TINT_RED };
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
          text: isNotApplicable(item) ? "Not applicable" : fmt(item.issue),
          textColor: item.issue && !isNotApplicable(item) ? AMBER : INK,
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
  R.bigVerdict(
    typeof cScore === "number"
      ? `${verdict.text}  ·  ${clamp(cScore)}/100`
      : verdict.text,
    verdict.color,
  );

  if (verdict.key === "non_compliant" || verdict.key === "partial") {
    const violations = Object.entries(a.legal_metrology_compliance ?? {})
      .filter(([, v]) => !isNotApplicable(v) && !(v.present && v.compliant))
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

  R.scoreBar("Safety score", oa?.safety_score ?? 0);
  R.scoreBar("Compliance score", oa?.compliance_score ?? 0);
  R.gap(4);

  if (oa?.summary) {
    R.paragraph("Summary", { bold: true, gapAfter: 2 });
    R.paragraph(oa.summary, { gapAfter: 8 });
  }

  const band = scoreBand(oa?.safety_score ?? 0);
  R.bigVerdict(recommendationText(oa?.safety_score ?? 0), band.rgb);
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

  const links: { label: string; url?: string }[] = [
    {
      label: "Legal Metrology / consumer complaints: consumerhelpline.gov.in",
      url: "https://consumerhelpline.gov.in",
    },
    {
      label: "FSSAI food safety complaints: foscos.fssai.gov.in/consumergrievance",
      url: "https://foscos.fssai.gov.in/consumergrievance",
    },
    { label: "FSSAI Helpline: 1800-11-4420" },
  ];

  for (const l of links) {
    R.ensure(15);
    R.doc.setFont("helvetica", "normal");
    R.doc.setFontSize(9);
    R.doc.text("•", R.margin + 2, R.y + 8);
    if (l.url) {
      ink(R.doc, TEAL_DARK);
      R.doc.textWithLink(l.label, R.margin + 14, R.y + 8, { url: l.url });
    } else {
      ink(R.doc, INK);
      R.doc.text(l.label, R.margin + 14, R.y + 8);
    }
    R.y += 15;
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
    const fy = pageH - margin - 26;

    stroke(doc, LINE);
    doc.setLineWidth(0.5);
    doc.line(margin, fy, pageW - margin, fy);

    ink(doc, MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Generated by HealthRepo | healthrepo.vercel.app", margin, fy + 12);
    doc.text(`Page ${i} of ${total}`, pageW - margin, fy + 12, { align: "right" });

    doc.setFontSize(6.6);
    const lines = doc.splitTextToSize(disclaimer, pageW - margin * 2) as string[];
    lines.forEach((ln, j) => doc.text(ln, margin, fy + 21 + j * 8));
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
