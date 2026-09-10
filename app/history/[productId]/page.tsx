"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Download,
  Share2,
  Siren,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  AlertTriangle,
  Skull,
  ClipboardCheck,
  FlaskConical,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ToastProvider";
import { supabase } from "@/lib/supabase";
import { removeProductImage } from "@/lib/storage";
import { HEALTHIER_ALTERNATIVES } from "@/lib/reference-data";
import {
  normalizeDosageAnalysis,
  normalizeDetectedCategory,
  normalizeVerdict,
} from "@/lib/analysis-normalize";
import { resolveCategory } from "@/lib/product-category";
import type {
  ProductAnalysis,
  IngredientAnalysis,
  ComplianceItem,
  SafetyStatus,
  DosageAnalysis,
  DetectedCategory,
  PersonalFlag,
  NutritionalAnalysis,
  Verdict,
} from "@/types/analysis";
import type { StoredAlternative } from "@/types/database";
import { NutritionSection } from "@/components/NutritionSection";

// ---------------------------------------------------------------------------
// Row shape + helpers
// ---------------------------------------------------------------------------

interface ScanRow {
  id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  detected_category: DetectedCategory | null;
  image_url: string | null;
  compliance_status: "compliant" | "non_compliant" | "partial" | null;
  compliance_details: Record<string, ComplianceItem> | null;
  ingredient_analysis: IngredientAnalysis[] | null;
  dosage_analysis: DosageAnalysis | null;
  personal_alerts: PersonalFlag[] | null;
  healthier_alternatives: StoredAlternative[] | null;
  overall_score: number | null;
  /** scoring-model-v2 columns — null / {} on rows scored before the nutrition layer. */
  safety_score: number | null;
  nutrition_score: number | null;
  compliance_score: number | null;
  verdict: string | null;
  nutritional_analysis: NutritionalAnalysis | Record<string, never> | null;
  primary_concern: Record<string, unknown> | null;
  scan_version: number | null;
  scanned_at: string;
}

const BASE_COLS =
  "id, product_name, brand, category, detected_category, image_url, compliance_status, compliance_details, ingredient_analysis, dosage_analysis, personal_alerts, healthier_alternatives, overall_score, scanned_at";
const V2_COLS = `${BASE_COLS}, safety_score, nutrition_score, compliance_score, verdict, nutritional_analysis, primary_concern, scan_version`;

function isUnknownColumn(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(
    e.message ?? "",
  );
}

/** True when this row carries the full scoring-model-v2 nutrition layer. */
function isV2(row: ScanRow): boolean {
  return (row.scan_version ?? 1) >= 2 && row.safety_score != null;
}

/** The stored nutritional_analysis, or null when it is absent / an empty {}. */
function storedNutrition(row: ScanRow): NutritionalAnalysis | null {
  const n = row.nutritional_analysis;
  if (!n || typeof n !== "object") return null;
  if (!("food_type" in n) && !("concerns" in n)) return null; // {} placeholder
  return n as NutritionalAnalysis;
}

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
const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const declLabel = (k: string) => DECLARATION_LABELS[k] ?? titleCase(k);

const isNotApplicable = (i: ComplianceItem) =>
  !i.present && i.compliant && /not applicable/i.test(i.issue ?? "");

function complianceVerdict(row: ScanRow): {
  label: "Passed" | "Failed" | "Partial" | "Not assessed";
  color: string;
} {
  const items = Object.values(row.compliance_details ?? {}).filter(
    (v) => !isNotApplicable(v),
  );
  const status =
    row.compliance_status ??
    (items.length === 0
      ? null
      : items.every((v) => v.present && v.compliant)
        ? "compliant"
        : items.some((v) => v.present && v.compliant)
          ? "partial"
          : "non_compliant");
  if (status === "compliant")
    return { label: "Passed", color: "text-green-600 dark:text-green-400" };
  if (status === "non_compliant")
    return { label: "Failed", color: "text-red-600 dark:text-red-400" };
  if (status === "partial")
    return { label: "Partial", color: "text-amber-600 dark:text-amber-400" };
  return { label: "Not assessed", color: "text-zinc-500" };
}

function complianceScore(cd: Record<string, ComplianceItem> | null): number {
  const items = Object.values(cd ?? {}).filter((v) => !isNotApplicable(v));
  if (!items.length) return 0;
  return Math.round(
    (items.filter((v) => v.present && v.compliant).length / items.length) * 100,
  );
}

const STATUS_STYLE: Record<
  SafetyStatus,
  { label: string; badge: string; bar: string }
> = {
  safe: {
    label: "Safe",
    badge: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    bar: "border-l-green-500",
  },
  caution: {
    label: "Caution",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    bar: "border-l-amber-500",
  },
  harmful: {
    label: "Harmful",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    bar: "border-l-red-500",
  },
  banned: {
    label: "Banned",
    badge: "bg-red-700 text-white",
    bar: "border-l-red-700",
  },
  unknown: {
    label: "Unknown",
    badge: "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
    bar: "border-l-zinc-400",
  },
};

function splitAlternatives(v?: string | null): string[] {
  if (!v) return [];
  return v
    .split(/[;,]|\bor\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function deriveAlternatives(row: ScanRow): StoredAlternative[] {
  if (row.healthier_alternatives?.length) return row.healthier_alternatives;
  return (row.ingredient_analysis ?? [])
    .filter((i) => i.safety_status === "harmful" || i.safety_status === "banned")
    .map((ing) => {
      const key =
        Object.keys(HEALTHIER_ALTERNATIVES).find(
          (k) => k.toLowerCase() === ing.name.toLowerCase(),
        ) ?? "";
      const ref = key ? HEALTHIER_ALTERNATIVES[key] : undefined;
      return {
        name: ing.name,
        status: ing.safety_status,
        alternatives:
          ref?.alternatives ?? splitAlternatives(ing.healthier_alternative),
        tip:
          ref?.what_to_look_for_on_label ??
          "Check the ingredients list and pick a product that does not name this additive.",
      };
    });
}

const VERDICTS: readonly string[] = ["safe", "caution", "limit", "avoid"];

function rowToAnalysis(row: ScanRow): ProductAnalysis {
  const cd = row.compliance_details ?? {};
  const ing = row.ingredient_analysis ?? [];
  const bannedN = ing.filter((i) => i.safety_status === "banned").length;
  const harmfulN = ing.filter((i) => i.safety_status === "harmful").length;
  const v2 = isV2(row);
  const nutrition = storedNutrition(row);
  // v2: overall_score is the weighted blend, and safety/nutrition/compliance
  // were stored separately. v1: overall_score is the legacy safety value.
  const safety = v2 ? row.safety_score : row.overall_score;
  const compliance = v2
    ? (row.compliance_score ?? complianceScore(row.compliance_details))
    : complianceScore(row.compliance_details);
  const verdict =
    v2 && row.verdict && VERDICTS.includes(row.verdict)
      ? (row.verdict as Verdict)
      : normalizeVerdict(null, row.overall_score ?? null, bannedN, harmfulN);
  return {
    product_info: {
      name: row.product_name ?? null,
      brand: row.brand ?? null,
      category: row.category ?? null,
      net_weight: cd.net_quantity?.value ?? null,
      mrp: cd.mrp?.value ?? null,
      manufacture_date: cd.manufacture_date?.value ?? null,
      expiry_date: cd.best_before_use_by?.value ?? null,
      manufacturer_address: cd.manufacturer_info?.value ?? null,
      fssai_license: cd.fssai_license?.value ?? null,
      batch_number: null,
      customer_care: cd.consumer_care?.value ?? null,
      country_of_origin: cd.country_of_origin?.value ?? null,
    },
    detected_category: normalizeDetectedCategory(row.detected_category),
    verdict,
    verdict_reason: "",
    key_findings: [],
    legal_metrology_compliance: cd,
    ingredient_analysis: (row.ingredient_analysis ?? []).map((ing) => ({
      ...ing,
      personal_flags: Array.isArray(ing.personal_flags) ? ing.personal_flags : [],
    })),
    dosage_analysis: normalizeDosageAnalysis(row.dosage_analysis),
    nutritional_analysis: nutrition,
    personal_alerts: Array.isArray(row.personal_alerts)
      ? row.personal_alerts
      : [],
    overall_assessment: {
      safety_score: safety ?? 0,
      nutrition_score: v2 ? (row.nutrition_score ?? null) : null,
      compliance_score: compliance,
      overall_score: row.overall_score ?? null,
      summary: "",
      recommendation: "",
    },
    banned_ingredients_check: [],
    ingredients_not_in_database: [],
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HistoryDetailPage({
  params,
}: {
  params: { productId: string };
}) {
  const { productId } = params;
  const router = useRouter();

  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">(
    "loading",
  );
  const [row, setRow] = useState<ScanRow | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pdfBusy, setPdfBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) return setState("notfound");

      const q1 = await supabase
        .from("scanned_products")
        .select(V2_COLS)
        .eq("id", productId)
        .eq("user_id", user.id)
        .maybeSingle();
      let data: unknown = q1.data;
      let error = q1.error;
      // Pre-migration DB: retry with just the columns it knows.
      if (error && isUnknownColumn(error)) {
        const q2 = await supabase
          .from("scanned_products")
          .select(BASE_COLS)
          .eq("id", productId)
          .eq("user_id", user.id)
          .maybeSingle();
        data = q2.data;
        error = q2.error;
      }
      if (!alive) return;
      if (error) return setState("error");
      if (!data) return setState("notfound");
      setRow(data as unknown as ScanRow);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [productId]);

  const derived = useMemo(() => {
    if (!row) return null;
    const ingredients = row.ingredient_analysis ?? [];
    const harmful = ingredients.filter((i) => i.safety_status === "harmful");
    const banned = ingredients.filter((i) => i.safety_status === "banned");
    const caution = ingredients.filter((i) => i.safety_status === "caution");
    const safe = ingredients.filter((i) => i.safety_status === "safe");
    return {
      ingredients,
      v2: isV2(row),
      nutrition: storedNutrition(row),
      harmful,
      banned,
      caution,
      safe,
      verdict: complianceVerdict(row),
      alternatives: deriveAlternatives(row),
      hasViolations:
        complianceVerdict(row).label !== "Passed" ||
        harmful.length > 0 ||
        banned.length > 0,
    };
  }, [row]);

  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  async function handlePdf() {
    if (!row) return;
    setPdfBusy(true);
    try {
      const { generateReport } = await import("@/lib/pdf-generator");
      await generateReport({
        analysis: rowToAnalysis(row),
        imageUrl: row.image_url,
        scanId: row.id,
        scannedAt: row.scanned_at,
      });
    } catch {
      toast.error("Could not generate the PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleShare() {
    if (!row) return;
    const url = `${window.location.origin}/history/${row.id}`;
    const text = `${row.product_name} scored ${row.overall_score ?? "?"}/100 ${
      isV2(row) ? "overall" : "for safety"
    } on HealthRepo.`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: `HealthRepo: ${row.product_name}`,
          text,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Link copied to clipboard");
    } catch {
      /* dismissed */
    }
  }

  async function handleDelete() {
    if (!row) return;
    setDeleting(true);
    const { error } = await supabase
      .from("scanned_products")
      .delete()
      .eq("id", row.id);
    if (error) {
      setDeleting(false);
      toast.error("Could not delete this scan");
      return;
    }
    // Don't leave the photo orphaned in the bucket.
    await removeProductImage(row.image_url);
    toast.success("Removed from history");
    router.push("/history");
  }

  if (state === "loading") {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      </Shell>
    );
  }

  if (state !== "ready" || !row || !derived) {
    return (
      <Shell>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-5 text-sm">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            {state === "notfound"
              ? "That scan is no longer in your history."
              : "Something went wrong loading that scan."}
          </p>
          <Link
            href="/history"
            className="mt-3 inline-block rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white"
          >
            Back to history
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
      <PageHeader title="Scan detail" backHref="/history" backLabel="History" />

      {/* Header */}
      <section className="flex flex-col items-center gap-3 text-center">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{row.product_name}</h2>
          {row.brand && <p className="text-sm text-zinc-500">{row.brand}</p>}
          {row.category && (
            <span className="mt-2 inline-block rounded-full bg-teal-600/10 px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-300">
              {titleCase(row.category)}
            </span>
          )}
          {row.detected_category && (() => {
            const meta = resolveCategory(row.detected_category);
            return (
              <div className="mt-2 flex flex-col items-center gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
                >
                  <span aria-hidden>{meta.emoji}</span>
                  {meta.label}
                </span>
                <p className="text-[11px] text-zinc-500">
                  Regulated by {meta.regulatoryBody}
                </p>
              </div>
            );
          })()}
        </div>
        {row.image_url && !imageFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.image_url}
            alt={row.product_name}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="max-h-64 w-full rounded-2xl border border-zinc-200 object-contain dark:border-white/10"
          />
        )}
        <SafetyGauge score={row.overall_score ?? 0} />
        {derived.v2 ? (
          <div className="flex gap-2">
            {(
              [
                ["Safety", row.safety_score],
                ["Nutrition", row.nutrition_score],
                ["Compliance", row.compliance_score],
              ] as [string, number | null][]
            ).map(([label, val]) => (
              <span
                key={label}
                className={`flex flex-col items-center rounded-lg px-2.5 py-1 text-center ${
                  val == null
                    ? "bg-zinc-100 text-zinc-400 dark:bg-white/5"
                    : val >= 80
                      ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                      : val >= 50
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                }`}
              >
                <span className="text-sm font-bold tabular-nums">
                  {val == null ? "—" : Math.round(val)}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-wide">
                  {label}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400">
            Scanned before nutritional analysis was added — this is the safety
            score only.
          </p>
        )}
      </section>

      {/* Nutritional quality — same section as the scan results page */}
      {derived.v2 && derived.nutrition && (
        <Expander
          title="Nutritional quality"
          open={open.has("nutrition")}
          onToggle={() => toggle("nutrition")}
        >
          <NutritionSection n={derived.nutrition} />
        </Expander>
      )}
      {derived.v2 && !derived.nutrition && row.nutrition_score == null && (
        <section className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-white/10">
          Nutritional quality is not assessed for this product category.
        </section>
      )}

      {/* Key highlights */}
      <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Key highlights
        </h3>
        <Highlight
          icon={<FlaskConical className="h-4 w-4 text-red-500" aria-hidden />}
          text={`${derived.harmful.length} harmful ingredient${
            derived.harmful.length === 1 ? "" : "s"
          } found`}
        />
        <Highlight
          icon={<ClipboardCheck className="h-4 w-4 text-teal-600" aria-hidden />}
          text={
            <>
              Compliance:{" "}
              <span className={`font-semibold ${derived.verdict.color}`}>
                {derived.verdict.label}
              </span>
            </>
          }
        />
        {derived.banned.length > 0 && (
          <Highlight
            icon={<Skull className="h-4 w-4 text-red-600" aria-hidden />}
            text={
              <span className="font-semibold text-red-600 dark:text-red-400">
                {derived.banned.length} banned ingredient
                {derived.banned.length === 1 ? "" : "s"} detected
              </span>
            }
          />
        )}
      </section>

      {/* Expandable: Full Compliance Report */}
      <Expander
        title="Full Compliance Report"
        open={open.has("compliance")}
        onToggle={() => toggle("compliance")}
      >
        {Object.keys(row.compliance_details ?? {}).length === 0 ? (
          <p className="text-sm text-zinc-500">No compliance data was stored.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {Object.entries(row.compliance_details ?? {}).map(([key, item]) => (
              <ComplianceRow key={key} label={declLabel(key)} item={item} />
            ))}
          </ul>
        )}
      </Expander>

      {/* Expandable: Full Ingredient Analysis */}
      <Expander
        title="Full Ingredient Analysis"
        open={open.has("ingredients")}
        onToggle={() => toggle("ingredients")}
      >
        {derived.ingredients.length === 0 ? (
          <p className="text-sm text-zinc-500">No ingredients were stored.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {[...derived.banned, ...derived.harmful, ...derived.caution].map(
              (ing, i) => (
                <IngredientDetail key={`${ing.name}-${i}`} ing={ing} />
              ),
            )}
            {derived.safe.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Rated safe
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {derived.safe.map((ing, i) => (
                    <span
                      key={`${ing.name}-${i}`}
                      className="rounded-md bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-500/15 dark:text-green-300"
                    >
                      {ing.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Expander>

      {/* Expandable: Healthier Alternatives */}
      <Expander
        title="Healthier Alternatives"
        open={open.has("alternatives")}
        onToggle={() => toggle("alternatives")}
      >
        {derived.alternatives.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No harmful or banned ingredients — no alternatives needed.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {derived.alternatives.map((alt, i) => (
              <li
                key={`${alt.name}-${i}`}
                className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                    {alt.name}
                  </span>
                  <span aria-hidden>→</span>
                  <span className="flex flex-wrap gap-1">
                    {alt.alternatives.map((o, j) => (
                      <span
                        key={j}
                        className="rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300"
                      >
                        {o}
                      </span>
                    ))}
                  </span>
                </div>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-semibold">
                    What to look for on labels:{" "}
                  </span>
                  {alt.tip}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Expander>

      {/* Actions */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePdf}
            disabled={pdfBusy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pdfBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            Download PDF Report
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-semibold dark:border-white/15"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            Share
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {derived.hasViolations && (
            <Link
              href={`/complaint/${row.id}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white"
            >
              <Siren className="h-4 w-4" aria-hidden />
              File Complaint
            </Link>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-300 px-3 py-2.5 text-sm font-semibold text-red-600 dark:border-red-500/30 dark:text-red-400"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete from History
          </button>
        </div>
      </section>

      {/* Delete confirmation */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Delete this scan?</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              “{row.product_name}” will be permanently removed from your history.
              This cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-white/15"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleting && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
      <PageHeader title="Scan detail" backHref="/history" backLabel="History" />
      {children}
    </main>
  );
}

function SafetyGauge({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const band =
    s >= 80
      ? { label: "Safe", stroke: "stroke-green-500", text: "text-green-600 dark:text-green-400" }
      : s >= 50
        ? { label: "Caution", stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400" }
        : { label: "Unsafe", stroke: "stroke-red-600", text: "text-red-600 dark:text-red-400" };
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-32 w-32">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          className="stroke-zinc-200 dark:stroke-white/10"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - s / 100)}
          className={band.stroke}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-extrabold tabular-nums ${band.text}`}>
          {s}
        </span>
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${band.text}`}
        >
          {band.label}
        </span>
      </div>
    </div>
  );
}

function Highlight({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2 text-sm">
      {icon}
      {text}
    </p>
  );
}

function Expander({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold"
      >
        {title}
        <ChevronDown
          className={`h-4 w-4 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-t border-zinc-100 px-4 py-3 dark:border-white/5">
          {children}
        </div>
      )}
    </section>
  );
}

function ComplianceRow({
  label,
  item,
}: {
  label: string;
  item: ComplianceItem;
}) {
  const state =
    item.present && item.compliant
      ? "ok"
      : item.present
        ? "issue"
        : isNotApplicable(item)
          ? "na"
          : item.status === "not_visible"
            ? "not_visible"
            : "missing";
  const icon =
    state === "ok" ? (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
    ) : state === "issue" ? (
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
    ) : state === "na" || state === "not_visible" ? (
      <Circle
        className="h-4 w-4 shrink-0 text-zinc-300 dark:text-white/20"
        aria-hidden
      />
    ) : (
      <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
    );
  return (
    <li className="flex items-start gap-2.5 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {item.value && (
          <p className="truncate text-xs text-zinc-500" title={item.value}>
            {item.value}
          </p>
        )}
        {item.issue && state !== "na" && state !== "not_visible" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {item.issue}
          </p>
        )}
        {state === "missing" && !item.issue && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Missing from the label
          </p>
        )}
        {state === "not_visible" && (
          <p className="text-xs text-zinc-500">
            Not visible in this photo — scan the other panels to check
          </p>
        )}
      </div>
    </li>
  );
}

function IngredientDetail({ ing }: { ing: IngredientAnalysis }) {
  const st = STATUS_STYLE[ing.safety_status] ?? STATUS_STYLE.unknown;
  return (
    <div
      className={`rounded-xl border border-zinc-200 border-l-4 p-3 dark:border-white/10 ${st.bar}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold">{ing.name}</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.badge}`}
        >
          {ing.safety_status === "banned" && (
            <Skull className="h-3 w-3" aria-hidden />
          )}
          {st.label}
        </span>
      </div>
      <dl className="mt-2 flex flex-col gap-2 text-sm">
        {ing.reason && <DetailField title="Why it's flagged">{ing.reason}</DetailField>}
        {ing.health_effects && (
          <DetailField title="What it does to your body">
            {ing.health_effects}
          </DetailField>
        )}
        {ing.who_should_avoid && (
          <DetailField title="Who should avoid it">
            {ing.who_should_avoid}
          </DetailField>
        )}
        {ing.banned_in_countries?.length ? (
          <DetailField title="Banned / restricted in">
            {ing.banned_in_countries.join(", ")}
          </DetailField>
        ) : null}
        {ing.healthier_alternative && (
          <DetailField title="Healthier alternative">
            <span className="text-green-700 dark:text-green-400">
              {ing.healthier_alternative}
            </span>
          </DetailField>
        )}
      </dl>
    </div>
  );
}

function DetailField({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </dt>
      <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{children}</dd>
    </div>
  );
}
