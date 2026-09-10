"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  ImagePlus,
  RotateCcw,
  Loader2,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  FlaskConical,
  Salad,
  Download,
  Share2,
  Siren,
  Skull,
  Sparkles,
  Gauge,
  Lightbulb,
  ChevronDown,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ArrowRight,
  PencilLine,
  Frown,
  Package,
  FileText,
  Hourglass,
  Wheat,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ToastProvider";
import {
  processImage,
  validateExtractedText,
  imageToVisionPayload,
  OcrError,
  ocrErrorMessage,
} from "@/lib/ocr";
import { supabase } from "@/lib/supabase";
import { uploadProductImage } from "@/lib/storage";
import { HEALTHIER_ALTERNATIVES } from "@/lib/reference-data";
import {
  resolveCategory,
  SELECTABLE_CATEGORIES,
} from "@/lib/product-category";
import {
  fetchHealthProfile,
  isHealthProfileEmpty,
} from "@/lib/health-profile";
import type {
  ProductAnalysis,
  IngredientAnalysis,
  ComplianceItem,
  SafetyStatus,
  DosageAnalysis,
  CumulativeRisk,
  DetectedCategoryId,
  PersonalFlag,
  PersonalFlagSeverity,
  Verdict,
} from "@/types/analysis";
import { NutritionSection } from "@/components/NutritionSection";
import { isFoodCategory } from "@/lib/enrich-analysis";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type View =
  | "capture"
  | "processing"
  | "results"
  | "error"
  | "garbled"
  | "notpackaged"
  | "unreadable"
  | "manual";
/** Which rung of the three-tier extraction chain produced the analysed text. */
type Tier = "tesseract" | "haiku" | "sonnet" | "manual";

/** Human label for how the analysed text was obtained. */
function readByLabel(tier: Tier): string {
  if (tier === "tesseract") return "on-device OCR";
  if (tier === "manual") return "your entry";
  return "AI vision";
}
type StepState = "idle" | "active" | "done";
type StepKey = "ocr" | "verify" | "enhance" | "advanced" | "analyze" | "report";
type Steps = Record<StepKey, StepState>;
type SaveState =
  | { state: "idle" | "saving" | "saved" | "skipped" | "error"; id?: string };

interface ManualForm {
  name: string;
  brand: string;
  ingredients: string;
  other: string;
}
const EMPTY_MANUAL: ManualForm = { name: "", brand: "", ingredients: "", other: "" };

function buildManualText(m: ManualForm): string {
  return [
    m.name.trim() && `Product name: ${m.name.trim()}`,
    m.brand.trim() && `Brand: ${m.brand.trim()}`,
    m.ingredients.trim() && `Ingredients: ${m.ingredients.trim()}`,
    m.other.trim() && `Other details on the pack: ${m.other.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Clamp a model-supplied safety score into a 0-100 integer (0 when absent). */
function clampScore(n: number | null | undefined): number {
  return Math.max(0, Math.min(100, Math.round(n ?? 0)));
}

const TIER_LABEL: Record<Tier, { label: string; note: string }> = {
  tesseract: {
    label: "📊 Standard scan",
    note: "Text was read on your device.",
  },
  haiku: {
    label: "📊 AI-assisted scan",
    note: "The on-device read was unclear, so AI re-read the label.",
  },
  sonnet: {
    label: "📊 Advanced AI scan",
    note: "The image was difficult — the advanced AI reader was used.",
  },
  manual: {
    label: "📊 Manual entry",
    note: "The details you typed in were analysed.",
  },
};

const IDLE_STEPS: Steps = {
  ocr: "idle",
  verify: "idle",
  enhance: "idle",
  advanced: "idle",
  analyze: "idle",
  report: "idle",
};

const IMAGE_TIPS = [
  "Use good lighting — avoid shadows",
  "Keep the text flat and centered",
  "Include the full ingredients list",
  "For cans/bottles, take multiple angles",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// FIX 6 — never pay for the same analysis twice. A short-lived in-memory cache
// of successful analyses keyed by the extracted text (+ whether a health
// profile was applied). A repeat scan of the same label inside the window — a
// double-tap, or a retry after a save error — reuses the result instead of
// making another billed /api/analyze call.
const ANALYSIS_DEDUPE_MS = 60_000;
// How long to let /api/analyze run before aborting client-side. Kept under the
// route's maxDuration (60) so a hung request is dropped before it bills.
const ANALYSIS_TIMEOUT_MS = 55_000;
const recentAnalyses = new Map<
  string,
  { at: number; analysis: ProductAnalysis }
>();
function analysisKey(text: string, hasProfile: boolean): string {
  const s = text.replace(/\s+/g, " ").trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}:${hasProfile ? "hp" : "no"}`;
}

// ---------------------------------------------------------------------------
// Analysis-service failure handling
// ---------------------------------------------------------------------------
//
// The API routes now return a specific code for each way an Anthropic call can
// fail — `{ error, retryable, retry_after_seconds? }` — instead of one generic
// "couldn't reach the service". We turn that into user-facing copy here.
//
//   out_of_credits  usage limit reached — retrying cannot help, no retry button
//   rate_limited    too many scans — count down `retry_after_seconds`, then retry
//   overloaded      service busy — retried automatically before it ever shows
//   auth_error      key is broken — operator problem, don't tell the user to retry
//   network_error / timeout   genuinely connectivity — keep the old wording

type AnalysisErrorCode =
  | "out_of_credits"
  | "rate_limited"
  | "overloaded"
  | "auth_error"
  | "network_error"
  | "timeout"
  | "generic";

interface AnalysisError {
  code: AnalysisErrorCode;
  message: string;
  hint?: string;
  retryable: boolean;
  retryAfter?: number;
}

const ERROR_COPY: Record<
  Exclude<AnalysisErrorCode, "generic">,
  { message: string; hint?: string; retryable: boolean }
> = {
  out_of_credits: {
    message: "⚠️ Analysis is temporarily unavailable",
    hint: "HealthRepo has reached its usage limit for now. Please try again later.",
    retryable: false,
  },
  rate_limited: {
    message: "Too many scans right now — please wait a moment",
    hint: "Your extracted text is saved. Try again shortly.",
    retryable: true,
  },
  overloaded: {
    message: "The analysis service is busy",
    hint: "It didn't respond after a few automatic retries. Give it a moment and try again.",
    retryable: true,
  },
  auth_error: {
    message: "Analysis is temporarily unavailable. Please try again later.",
    retryable: false,
  },
  network_error: {
    message: "Could not reach the analysis service.",
    hint: "Check your connection and try again.",
    retryable: true,
  },
  timeout: {
    message: "The analysis service took too long to respond.",
    hint: "Check your connection and try again.",
    retryable: true,
  },
};

/** Turn an /api/analyze (or /api/extract-*) error body into display copy. */
function mapAnalysisError(data: unknown): AnalysisError {
  const body = (data ?? {}) as {
    error?: unknown;
    retryable?: unknown;
    retry_after_seconds?: unknown;
  };
  const code = typeof body.error === "string" ? body.error : "";
  const known = (ERROR_COPY as Record<string, (typeof ERROR_COPY)[keyof typeof ERROR_COPY]>)[code];
  if (known) {
    return {
      code: code as AnalysisErrorCode,
      message: known.message,
      hint: known.hint,
      retryable:
        typeof body.retryable === "boolean" ? body.retryable : known.retryable,
      retryAfter:
        typeof body.retry_after_seconds === "number" &&
        body.retry_after_seconds > 0
          ? Math.ceil(body.retry_after_seconds)
          : undefined,
    };
  }
  // Legacy / validation errors still send `error` as a human sentence.
  return {
    code: "generic",
    message: code || "The analysis service failed to respond.",
    hint: "Check your connection and try again.",
    retryable: true,
  };
}

/** One-line toast copy for the secondary re-analyse flows. */
function analysisErrorToast(data: unknown): string {
  const e = mapAnalysisError(data);
  switch (e.code) {
    case "out_of_credits":
      return "Analysis is temporarily unavailable — usage limit reached. Try again later.";
    case "rate_limited":
      return "Too many scans right now — wait a moment and try again.";
    case "overloaded":
      return "The analysis service is busy. Try again in a moment.";
    case "auth_error":
      return "Analysis is temporarily unavailable. Please try again later.";
    default:
      return e.message;
  }
}

type AnalyzeOutcome =
  | { kind: "ok"; analysis: ProductAnalysis }
  | { kind: "special"; view: "notpackaged" | "garbled"; data: Record<string, unknown> }
  | { kind: "error"; error: AnalysisError };

/**
 * POST /api/analyze with two built-in behaviours the spec calls for:
 *  - a transient `overloaded` is retried automatically (2s then 5s) before it
 *    is ever shown to the user;
 *  - every other failure comes back as a typed {@link AnalysisError} rather than
 *    a thrown exception, so the caller never has to guess.
 * The caller keeps ownership of the extracted text, so a returned error loses
 * nothing — "Try again" re-sends the same text with no OCR/vision re-run.
 */
async function requestAnalysis(
  payload: Record<string, unknown>,
  onAutoRetry?: (attempt: number) => void,
): Promise<AnalyzeOutcome> {
  const OVERLOAD_BACKOFF_MS = [2000, 5000];

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
    let res: Response;
    let data: Record<string, unknown>;
    try {
      res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          kind: "error",
          error: {
            code: "timeout",
            message:
              "The analysis took too long and was stopped before it could run up a charge.",
            hint: "Try again, or scan a smaller portion of the label.",
            retryable: true,
          },
        };
      }
      return {
        kind: "error",
        error: {
          code: "network_error",
          message: "Could not reach the analysis service.",
          hint: "Check your connection and try again.",
          retryable: true,
        },
      };
    }
    clearTimeout(timeout);

    if (res.status === 422 && data?.error === "not_a_packaged_product") {
      return { kind: "special", view: "notpackaged", data };
    }
    if (res.status === 422 && data?.error === "garbled_text") {
      return { kind: "special", view: "garbled", data };
    }
    if (res.ok && data?.analysis) {
      return { kind: "ok", analysis: data.analysis as ProductAnalysis };
    }

    // Auto-retry a genuine overload a couple of times before surfacing anything.
    if (
      data?.error === "overloaded" &&
      attempt < OVERLOAD_BACKOFF_MS.length
    ) {
      onAutoRetry?.(attempt + 1);
      await sleep(OVERLOAD_BACKOFF_MS[attempt]);
      continue;
    }

    return { kind: "error", error: mapAnalysisError(data) };
  }
}

/**
 * True when a Supabase write failed only because a column in the payload does
 * not exist on this database yet (a pending migration). Lets saveScan retry
 * with just the base columns instead of losing the scan entirely.
 */
function isMissingColumnError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === "PGRST204") return true;
  return /could not find the '.*' column|column ".*" of relation|column .* does not exist/i.test(
    err.message ?? "",
  );
}

/**
 * The scoring-model-v2 columns written on every save. overall_score now holds
 * the WEIGHTED overall (safety x0.35 + nutrition x0.50 + compliance x0.15) that
 * enrichAnalysis already computed — no longer the safety score. nutrition_score
 * is null for non-food. scan_version 2 marks a row as carrying the full
 * nutritional layer. See migration 20260909040000.
 */
function scoreColumns(a: ProductAnalysis): Record<string, unknown> {
  const oa = a.overall_assessment;
  const asInt = (v: number | null | undefined) =>
    v == null ? null : Math.max(0, Math.min(100, Math.round(v)));
  return {
    safety_score: asInt(oa?.safety_score),
    nutrition_score: asInt(oa?.nutrition_score ?? null),
    compliance_score: asInt(oa?.compliance_score),
    overall_score:
      asInt(oa?.overall_score) ?? asInt(oa?.safety_score) ?? 0,
    verdict: a.verdict ?? null,
    nutritional_analysis: a.nutritional_analysis ?? {},
    primary_concern: a.nutritional_analysis?.primary_concern ?? {},
    scan_version: 2,
  };
}

/** v2-optional columns that a pre-migration database rejects. */
const V2_OPTIONAL_COLUMNS = [
  "detected_category",
  "dosage_analysis",
  "personal_alerts",
  "safety_score",
  "nutrition_score",
  "compliance_score",
  "verdict",
  "nutritional_analysis",
  "primary_concern",
  "scan_version",
] as const;

/**
 * UPDATE a saved scan row, and — if the database predates a migration — retry
 * without the columns it does not know, keeping overall_score at its pre-v2
 * (safety) meaning so an old DB is never misread.
 */
async function syncSavedRow(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  let { error } = await supabase
    .from("scanned_products")
    .update(patch)
    .eq("id", id);
  if (error && isMissingColumnError(error)) {
    const base = { ...patch };
    for (const c of V2_OPTIONAL_COLUMNS) delete base[c];
    if ("overall_score" in patch) {
      const s = patch.safety_score;
      if (typeof s === "number") base.overall_score = s;
    }
    ({ error } = await supabase
      .from("scanned_products")
      .update(base)
      .eq("id", id));
  }
  if (error) console.error("[syncSavedRow] update failed:", error);
}

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
const declLabel = (key: string) => DECLARATION_LABELS[key] ?? titleCase(key);

const isNotApplicable = (item: ComplianceItem) =>
  item.status === "not_applicable" ||
  (!item.present && item.compliant && /not applicable/i.test(item.issue ?? ""));

/**
 * The scan could not read enough of the label to score it honestly — either no
 * ingredients were found, or too many declarations were "not visible". The
 * route/normalizer null the score and set the *_status; treat either signal as
 * insufficient. Such a scan gets the partial-scan screen, no PDF, no save.
 */
function isInsufficientData(a: ProductAnalysis): boolean {
  const oa = a.overall_assessment;
  return (
    !oa ||
    oa.safety_score == null ||
    oa.compliance_score == null ||
    oa.safety_status === "insufficient_data" ||
    oa.compliance_status === "insufficient_data"
  );
}

function deriveComplianceStatus(
  a: ProductAnalysis,
): "compliant" | "non_compliant" | "partial" {
  const items = Object.values(a.legal_metrology_compliance ?? {}).filter(
    (v) => !isNotApplicable(v) && v.status !== "not_visible",
  );
  if (items.length === 0) return "partial";
  const pass = items.filter((v) => v.present && v.compliant).length;
  if (pass === items.length) return "compliant";
  if (pass === 0) return "non_compliant";
  return "partial";
}

const COMPLIANCE_BADGE = {
  compliant: { label: "Compliant", cls: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" },
  non_compliant: { label: "Non-Compliant", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  partial: { label: "Partially Compliant", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
} as const;

function scoreBand(score: number) {
  if (score >= 80)
    return {
      label: "Safe",
      stroke: "stroke-green-500",
      text: "text-green-600 dark:text-green-400",
      bar: "bg-green-500",
    };
  if (score >= 50)
    return {
      label: "Caution",
      stroke: "stroke-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      bar: "bg-amber-500",
    };
  return {
    label: "Unsafe",
    stroke: "stroke-red-600",
    text: "text-red-600 dark:text-red-400",
    bar: "bg-red-600",
  };
}

/** Nutrition concern-type labels (also used by the shared NutritionSection). */
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

const STATUS_STYLE: Record<
  SafetyStatus,
  { label: string; card: string; badge: string }
> = {
  safe: {
    label: "Safe",
    card: "border-l-4 border-l-green-500",
    badge: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  },
  caution: {
    label: "Caution",
    card: "border-l-4 border-l-amber-500",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  harmful: {
    label: "Harmful",
    card: "border-l-4 border-l-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  banned: {
    label: "Banned",
    card: "border-l-4 border-l-red-700",
    badge: "bg-red-700 text-white dark:bg-red-800",
  },
  unknown: {
    label: "Unknown",
    card: "border-l-4 border-l-zinc-400",
    badge: "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
  },
};

const PERSONAL_SEVERITY_STYLE: Record<
  PersonalFlagSeverity,
  { icon: string; cls: string }
> = {
  critical: { icon: "🔴", cls: "text-red-700 dark:text-red-300 font-semibold" },
  warning: { icon: "🟡", cls: "text-amber-700 dark:text-amber-300" },
  info: { icon: "ℹ️", cls: "text-zinc-600 dark:text-zinc-400" },
};
const SEVERITY_RANK: Record<PersonalFlagSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const RISK_STYLE: Record<CumulativeRisk, { label: string; cls: string }> = {
  low: {
    label: "Low",
    cls: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  },
  medium: {
    label: "Medium",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  high: {
    label: "High",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

function splitAlternatives(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,]|\bor\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Look up the reference entry for an ingredient name, tolerating case. */
function referenceFor(name: string) {
  if (HEALTHIER_ALTERNATIVES[name]) return HEALTHIER_ALTERNATIVES[name];
  const key = Object.keys(HEALTHIER_ALTERNATIVES).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  return key ? HEALTHIER_ALTERNATIVES[key] : undefined;
}

function mapOcrError(err: unknown): { message: string; hint?: string } {
  if (err instanceof OcrError) {
    switch (err.code) {
      case "NO_TEXT_FOUND":
        return {
          message: "Could not read text from this image. Please try a clearer photo.",
          hint: "Make sure the label fills the frame and the text is in focus.",
        };
      case "LOW_CONFIDENCE":
        return {
          message: "This photo is too blurry to read reliably.",
          hint: "Try taking the photo in better lighting and hold the phone steady.",
        };
      case "DECODE_FAILED":
        return {
          message: "That image could not be opened.",
          hint: "Use a JPG or PNG photo of the package.",
        };
      case "FILE_TOO_LARGE":
      case "INVALID_FILE":
        return { message: err.message };
      default:
        return { message: err.message, hint: "Please try again." };
    }
  }
  return { message: ocrErrorMessage(err), hint: "Please try again." };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [view, setView] = useState<View>("capture");
  const [steps, setSteps] = useState<Steps>(IDLE_STEPS);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [errInfo, setErrInfo] = useState<AnalysisError | null>(null);
  // Live countdown for a `rate_limited` error — the "Try again" button stays
  // disabled until it reaches zero.
  const [retryIn, setRetryIn] = useState(0);
  const [garbled, setGarbled] = useState<{
    message: string;
    recommendation: string;
  } | null>(null);
  const [notPackaged, setNotPackaged] = useState<{
    detected: string | null;
    message: string;
  } | null>(null);
  const [unreadableFields, setUnreadableFields] = useState<string[]>([]);
  // Persistent "view extracted text" control — available during analysis AND
  // after results. `extracted` is set the moment text is settled.
  const [extracted, setExtracted] = useState<{ text: string; tier: Tier } | null>(
    null,
  );
  const [showTextPanel, setShowTextPanel] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [textReanalyzing, setTextReanalyzing] = useState(false);
  const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);
  // Set from ?verify=<product name> when arriving via a "Re-verify this product"
  // link on the safe-products page — just a hint shown on the capture screen.
  const [reVerifyName, setReVerifyName] = useState<string | null>(null);
  const [result, setResult] = useState<{
    analysis: ProductAnalysis;
    extractedText: string;
    tier: Tier;
    warning?: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [showComplaint, setShowComplaint] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  // Category-detection review (shown when confidence is 'low', or on demand).
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState(false);
  const [categoryPick, setCategoryPick] = useState<DetectedCategoryId | "">("");
  const [reanalyzing, setReanalyzing] = useState(false);

  const toast = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const name = new URLSearchParams(window.location.search).get("verify");
      if (name) setReVerifyName(name.trim().slice(0, 120));
    } catch {
      /* no query string — nothing to prefill */
    }
  }, []);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  // Tick down the wait after a `rate_limited` error; "Try again" is disabled
  // until this hits zero.
  useEffect(() => {
    if (view !== "error" || errInfo?.code !== "rate_limited") {
      setRetryIn(0);
      return;
    }
    setRetryIn(errInfo.retryAfter ?? 20);
    const id = setInterval(() => {
      setRetryIn((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [view, errInfo]);

  const resetCategoryReview = useCallback(() => {
    setCategoryConfirmed(false);
    setCategoryEditing(false);
    setCategoryPick("");
    setReanalyzing(false);
  }, []);

  const selectFile = useCallback(
    (picked: File) => {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(picked);
      });
      setFile(picked);
      setResult(null);
      setErrInfo(null);
      setGarbled(null);
      setNotPackaged(null);
      setUnreadableFields([]);
      setExtracted(null);
      setShowTextPanel(false);
      setManual(EMPTY_MANUAL);
      setSteps(IDLE_STEPS);
      setSave({ state: "idle" });
      resetCategoryReview();
      setView("capture");
    },
    [resetCategoryReview],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) selectFile(picked);
  };

  const reset = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setResult(null);
    setErrInfo(null);
    setGarbled(null);
    setNotPackaged(null);
    setUnreadableFields([]);
    setExtracted(null);
    setShowTextPanel(false);
    setManual(EMPTY_MANUAL);
    setSteps(IDLE_STEPS);
    setSave({ state: "idle" });
    resetCategoryReview();
    setView("capture");
  };

  // --- shared tail: extracted text -> /api/analyze -> report ------------
  // Called by every path once a `sourceText` and its `tier` are settled
  // (all three extraction tiers, plus manual entry).
  const analyzeText = useCallback(
    async (
      sourceText: string,
      tier: Tier,
      opts?: { lowConfidence?: boolean },
    ) => {
      console.info("[ocr] final text -> analysis:", {
        tier,
        chars: sourceText.length,
        words: sourceText.trim() ? sourceText.trim().split(/\s+/).length : 0,
      });
      // Make the raw text reachable from the persistent control immediately —
      // before analysis even returns.
      setExtracted({ text: sourceText, tier });
      setSteps((s) => ({ ...s, analyze: "active" }));

      // Personalise the analysis with the user's health profile, if they set one.
      const hp = await fetchHealthProfile();
      const userHealthProfile = isHealthProfileEmpty(hp) ? null : hp;

      let analysis: ProductAnalysis;
      const dedupeKey = analysisKey(sourceText, !!userHealthProfile);
      const cached = recentAnalyses.get(dedupeKey);
      if (cached && Date.now() - cached.at < ANALYSIS_DEDUPE_MS) {
        analysis = cached.analysis;
      } else {
        const outcome = await requestAnalysis(
          { extractedText: sourceText, userHealthProfile },
          () => {
            // Auto-retrying a transient overload — keep the user on the
            // progress screen with an honest note rather than an error.
            setErrInfo({
              code: "overloaded",
              message: "The analysis service is busy. Retrying automatically…",
              retryable: true,
            });
          },
        );

        if (outcome.kind === "special") {
          const data = outcome.data;
          if (outcome.view === "notpackaged") {
            setNotPackaged({
              detected:
                typeof data.detected === "string" && data.detected.trim()
                  ? data.detected.trim()
                  : null,
              message:
                typeof data.message === "string" && data.message.trim()
                  ? data.message
                  : "We couldn't find any product label in this photo.",
            });
            setSteps((s) => ({ ...s, analyze: "done" }));
            setView("notpackaged");
            return;
          }
          setGarbled({
            message:
              typeof data.message === "string" && data.message.trim()
                ? data.message
                : "The extracted text appears corrupted.",
            recommendation:
              typeof data.recommendation === "string" &&
              data.recommendation.trim()
                ? data.recommendation
                : "Please retake the photo.",
          });
          setSteps((s) => ({ ...s, analyze: "done" }));
          setView("garbled");
          return;
        }

        if (outcome.kind === "error") {
          // The extracted text stays in `extracted` state — "Try again" from
          // the error screen re-sends it with no OCR/vision re-run.
          setErrInfo(outcome.error);
          setView("error");
          return;
        }

        analysis = outcome.analysis;
        recentAnalyses.set(dedupeKey, { at: Date.now(), analysis });
      }
      if (!analysis || typeof analysis !== "object") {
        setErrInfo({
          code: "generic",
          message: "The analysis came back empty. Please try again.",
          retryable: true,
        });
        setView("error");
        return;
      }
      // A retryable overload note may have been set mid-flight — clear it now
      // that we have a result.
      setErrInfo(null);

      setSteps((s) => ({ ...s, analyze: "done", report: "active" }));
      await sleep(600);
      setSteps((s) => ({ ...s, report: "done" }));

      setResult({
        analysis,
        extractedText: sourceText,
        tier,
        warning:
          tier === "tesseract" && opts?.lowConfidence
            ? "This photo was a little blurry — double-check the extracted details below."
            : undefined,
      });
      setExpanded(new Set());
      setView("results");

      // A partial scan has no honest score — keep it out of history and the
      // safe-products database entirely.
      if (file && !isInsufficientData(analysis)) {
        void saveScan(analysis, sourceText, file);
      }
    },
    [file],
  );

  // --- three-tier text extraction -> analyze ----------------------------
  //
  //   TIER 1  Tesseract.js in the browser (free). Passes the structural-marker
  //           check AND confidence>70 AND wordCount>30 -> use it.
  //   TIER 2  Haiku Vision (/api/extract-text, cheap). Re-run the SAME marker
  //           check on its output; score>=3 -> use it, else escalate.
  //   TIER 3  Sonnet Vision (/api/extract-text-advanced, most accurate). score>=3
  //           -> use it, else the image is genuinely unreadable — offer manual
  //           entry.
  //
  // `forceVision` (the garbled-retry button) skips tier 1 and starts at tier 2.
  const runAnalysis = useCallback(
    async (opts?: { forceVision?: boolean }) => {
      if (!file) return;
      const forceVision = opts?.forceVision === true;

      setView("processing");
      setErrInfo(null);
      setGarbled(null);
      setNotPackaged(null);
      setUnreadableFields([]);
      setShowComplaint(false);
      setExtracted(null);
      setShowTextPanel(false);
      setOcrProgress(0);
      resetCategoryReview();
      setSteps({
        ...IDLE_STEPS,
        ocr: forceVision ? "done" : "active",
        verify: forceVision ? "done" : "idle",
      });

      let tesseractText = "";
      let ocrConfidence = 0;
      let ocrWordCount = 0;
      let lowConfidence = false;

      // ---- TIER 1: Tesseract (skipped on a forced-Vision retry) ----
      if (!forceVision) {
        try {
          const ocr = await processImage(file, {
            onProgress: (p) => setOcrProgress(p),
          });
          tesseractText = ocr.text;
          ocrConfidence = ocr.confidence;
          ocrWordCount = ocr.wordCount;
          lowConfidence = ocr.lowConfidence;
        } catch (err) {
          if (
            err instanceof OcrError &&
            (err.code === "INVALID_FILE" || err.code === "FILE_TOO_LARGE")
          ) {
            // A bad file (too large / not an image) — "Try again" on the same
            // file cannot help, so only offer "Change photo".
            setErrInfo({ code: "generic", retryable: false, ...mapOcrError(err) });
            setView("error");
            return;
          }
          if (err instanceof OcrError && err.code === "ABORTED") {
            setView("capture");
            return;
          }
          // NO_TEXT_FOUND / LOW_CONFIDENCE / DECODE_FAILED / OCR_FAILED:
          // don't dead-end — let the Vision tiers try the same photo.
        }

        setSteps((s) => ({ ...s, ocr: "done" }));

        // ---- Auto quality gate on the on-device read (no user pause) ----
        // Analysis starts immediately; the user can review/correct the text at
        // any time via the persistent "View extracted text" control.
        if (tesseractText.trim()) {
          setSteps((s) => ({ ...s, verify: "active" }));
          await sleep(200); // let the "Verifying…" row register
          const t1Score = validateExtractedText(tesseractText).score;
          // Tesseract stays strict (>= 3) — it is the least reliable reader.
          const tesseractGood =
            ocrConfidence > 70 && ocrWordCount > 30 && t1Score >= 3;
          console.info("[ocr] tier1 gate:", {
            confidence: ocrConfidence,
            wordCount: ocrWordCount,
            validationScore: t1Score,
            passed: tesseractGood,
          });
          setSteps((s) => ({ ...s, verify: "done" }));
          if (tesseractGood) {
            await analyzeText(tesseractText, "tesseract", { lowConfidence });
            return;
          }
        } else {
          setSteps((s) => ({ ...s, verify: "done" }));
        }
        // Tier 1 did not produce usable text — fall through to the Vision tiers.
      }

      // ---- Encode the image once for both Vision tiers ----
      setSteps((s) => ({
        ...s,
        ocr: s.ocr === "idle" ? "done" : s.ocr,
        verify: s.verify === "idle" ? "done" : s.verify,
        enhance: "active",
      }));

      let payload: { base64: string; mediaType: string } | null = null;
      try {
        const p = await imageToVisionPayload(file);
        payload = { base64: p.base64, mediaType: p.mediaType };
      } catch (err) {
        console.warn("[ocr] vision payload encode failed:", err);
        payload = null;
      }

      const attempted = { tesseract: !forceVision, haiku: false, sonnet: false };
      const tesseractScore = validateExtractedText(tesseractText).score;
      // Set if a vision tier reports a hard Anthropic outage (out of credits /
      // broken key). The analyse call would hit the same wall, so we surface it
      // straight away instead of falling through to "couldn't read the image".
      let hardOutage: AnalysisError | null = null;

      // ---- TIER 2: Haiku Vision ----
      // Any failure here (throw, timeout, non-200) is swallowed and we escalate
      // straight to Sonnet — never a user-facing error at this tier.
      let haikuText = "";
      if (payload) {
        attempted.haiku = true;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30_000);
        try {
          const res = await fetch("/api/extract-text", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              imageBase64: payload.base64,
              mediaType: payload.mediaType,
            }),
            signal: ctrl.signal,
          });
          const data = await res.json().catch(() => ({}));
          console.info("[ocr] tier2 haiku:", {
            status: res.status,
            ok: res.ok,
            chars:
              typeof data?.extractedText === "string"
                ? data.extractedText.length
                : 0,
          });
          if (res.ok && typeof data.extractedText === "string") {
            haikuText = data.extractedText.trim();
          } else if (
            data?.error === "out_of_credits" ||
            data?.error === "auth_error"
          ) {
            hardOutage = mapAnalysisError(data);
          }
        } catch (err) {
          console.warn("[ocr] tier2 haiku threw / timed out:", err);
        } finally {
          clearTimeout(t);
        }
      } else {
        console.warn("[ocr] tier2 haiku skipped — no image payload");
      }

      // No point trying the (equally credit-dependent) advanced reader.
      if (hardOutage && !haikuText) {
        setSteps((s) => ({ ...s, enhance: "done" }));
        setErrInfo(hardOutage);
        setView("error");
        return;
      }

      // Vision output is trusted at a LOWER bar than Tesseract (>= 2, not 3).
      const haikuScore = haikuText ? validateExtractedText(haikuText).score : 0;
      if (haikuText && haikuScore >= 2) {
        console.info("[ocr] accepted tier2 haiku (score", haikuScore, ")");
        setSteps((s) => ({ ...s, enhance: "done" }));
        await analyzeText(haikuText, "haiku");
        return;
      }

      // ---- TIER 3: Sonnet Vision (advanced) ----
      setSteps((s) => ({ ...s, enhance: "done", advanced: "active" }));

      let sonnetText = "";
      let sonnetUnreadable: string[] = [];
      if (payload) {
        attempted.sonnet = true;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 55_000);
        try {
          const res = await fetch("/api/extract-text-advanced", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              imageBase64: payload.base64,
              mediaType: payload.mediaType,
            }),
            signal: ctrl.signal,
          });
          const data = await res.json().catch(() => ({}));
          console.info("[ocr] tier3 sonnet:", {
            status: res.status,
            ok: res.ok,
            chars:
              typeof data?.extractedText === "string"
                ? data.extractedText.length
                : 0,
          });
          if (res.ok && typeof data.extractedText === "string") {
            sonnetText = data.extractedText.trim();
          } else if (
            data?.error === "out_of_credits" ||
            data?.error === "auth_error"
          ) {
            hardOutage = mapAnalysisError(data);
          }
          if (Array.isArray(data?.unreadableFields)) {
            sonnetUnreadable = data.unreadableFields
              .filter((x: unknown): x is string => typeof x === "string")
              .map((x: string) => x.trim())
              .filter(Boolean);
          }
        } catch (err) {
          console.warn("[ocr] tier3 sonnet threw / timed out:", err);
        } finally {
          clearTimeout(t);
        }
      } else {
        console.warn("[ocr] tier3 sonnet skipped — no image payload");
      }

      setSteps((s) => ({ ...s, advanced: "done" }));

      // Sonnet is the last reader: accept at the lower vision bar, and accept
      // ANY substantial text it returned rather than dead-ending.
      const sonnetScore = sonnetText
        ? validateExtractedText(sonnetText).score
        : 0;
      if (sonnetText && (sonnetScore >= 2 || sonnetText.length >= 24)) {
        console.info(
          "[ocr] accepted tier3 sonnet (score",
          sonnetScore,
          "chars",
          sonnetText.length,
          ")",
        );
        await analyzeText(sonnetText, "sonnet");
        return;
      }

      // A hard Anthropic outage with nothing usable from any tier — show that,
      // not "we couldn't read the image".
      if (hardOutage && !sonnetText && !haikuText && !tesseractText.trim()) {
        setErrInfo(hardOutage);
        setView("error");
        return;
      }

      // Salvage: fall back to the best text an earlier tier produced before
      // giving up. Vision text clears the >= 2 bar; Tesseract still needs >= 2.
      const salvage: { text: string; tier: Tier } | null =
        haikuText && haikuScore >= 2
          ? { text: haikuText, tier: "haiku" }
          : tesseractText.trim() && tesseractScore >= 2
            ? { text: tesseractText, tier: "tesseract" }
            : haikuText.length >= 40
              ? { text: haikuText, tier: "haiku" }
              : null;
      if (salvage) {
        console.info("[ocr] salvaged text from", salvage.tier);
        await analyzeText(
          salvage.text,
          salvage.tier,
          salvage.tier === "tesseract" ? { lowConfidence } : undefined,
        );
        return;
      }

      // Every tier genuinely failed — only NOW show the "couldn't read" screen.
      console.warn("[ocr] all tiers failed:", {
        attempted,
        tesseract: { chars: tesseractText.length, score: tesseractScore },
        haiku: { chars: haikuText.length, score: haikuScore },
        sonnet: { chars: sonnetText.length, score: sonnetScore },
      });
      setUnreadableFields(sonnetUnreadable);
      setView("unreadable");
    },
    [file, analyzeText, resetCategoryReview],
  );

  // --- retry after a service failure --------------------------------------
  // Preserve the user's work: if text was already extracted, re-send THAT to
  // /api/analyze — no OCR, no vision, no cost for reading the label again.
  // Only fall back to the full pipeline when we never got any text out.
  const retryAnalysis = useCallback(async () => {
    setErrInfo(null);
    if (extracted?.text) {
      setView("processing");
      setSteps({
        ...IDLE_STEPS,
        ocr: "done",
        verify: "done",
        enhance:
          extracted.tier === "haiku" || extracted.tier === "sonnet"
            ? "done"
            : "idle",
        advanced: extracted.tier === "sonnet" ? "done" : "idle",
        analyze: "active",
      });
      await analyzeText(extracted.text, extracted.tier);
      return;
    }
    await runAnalysis();
  }, [extracted, analyzeText, runAnalysis]);

  // --- manual entry -> analyze ----------------------------------------
  const submitManual = useCallback(async () => {
    const text = buildManualText(manual);
    if (text.replace(/\s+/g, "").length < 12 || !manual.ingredients.trim()) {
      toast.error("Add at least the product name and the ingredients list.");
      return;
    }
    setErrInfo(null);
    setGarbled(null);
    setNotPackaged(null);
    setView("processing");
    setSteps({
      ...IDLE_STEPS,
      ocr: "done",
      verify: "done",
      analyze: "active",
    });
    await analyzeText(text, "manual");
  }, [manual, analyzeText, toast]);

  // --- persist to Supabase ----------------------------------------------
  async function saveScan(
    analysis: ProductAnalysis,
    extractedText: string,
    imageFile: File,
  ) {
    setSave({ state: "saving" });
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setSave({ state: "skipped" });
        return;
      }

      const pi = analysis.product_info ?? ({} as ProductAnalysis["product_info"]);

      // Best-effort — a failed upload still saves the analysis, just without a photo.
      const imageUrl = await uploadProductImage(imageFile, user.id);

      const fullRow: Record<string, unknown> = {
        user_id: user.id,
        product_name: pi.name ?? "Unknown product",
        brand: pi.brand,
        category: pi.category ?? "uncategorized",
        detected_category: analysis.detected_category ?? null,
        image_url: imageUrl,
        extracted_text: extractedText,
        compliance_status: deriveComplianceStatus(analysis),
        compliance_details: analysis.legal_metrology_compliance ?? {},
        ingredient_analysis: analysis.ingredient_analysis ?? [],
        dosage_analysis: analysis.dosage_analysis ?? {},
        personal_alerts: analysis.personal_alerts ?? [],
        healthier_alternatives: buildAlternatives(analysis),
        ...scoreColumns(analysis),
      };

      let { data, error } = await supabase
        .from("scanned_products")
        .insert(fullRow)
        .select("id")
        .single();

      // Resilience: on a database that predates the newer migrations, PostgREST
      // rejects the WHOLE insert because one column is unknown (PGRST204). Retry
      // without the optional columns so the scan still lands in history. The
      // scoring-model-v2 columns are stripped too, and overall_score falls back
      // to the safety score (its pre-v2 meaning) so an old DB is not misread.
      if (error && isMissingColumnError(error)) {
        console.error(
          "[saveScan] insert rejected for an unknown column — retrying with base columns only:",
          error,
        );
        const baseRow = { ...fullRow };
        delete baseRow.detected_category;
        delete baseRow.dosage_analysis;
        delete baseRow.personal_alerts;
        delete baseRow.safety_score;
        delete baseRow.nutrition_score;
        delete baseRow.compliance_score;
        delete baseRow.verdict;
        delete baseRow.nutritional_analysis;
        delete baseRow.primary_concern;
        delete baseRow.scan_version;
        baseRow.overall_score = clampScore(
          analysis.overall_assessment?.safety_score,
        );
        ({ data, error } = await supabase
          .from("scanned_products")
          .insert(baseRow)
          .select("id")
          .single());
      }

      if (error || !data) {
        console.error("[saveScan] insert failed:", error);
        setSave({ state: "error" });
        return;
      }
      setSave({ state: "saved", id: data.id as string });
    } catch (err) {
      console.error("[saveScan] threw:", err);
      setSave({ state: "error" });
    }
  }

  // --- re-run the analysis under a user-corrected category ------------
  async function reanalyzeWithCategory(override: DetectedCategoryId) {
    if (!result || reanalyzing) return;
    setReanalyzing(true);
    try {
      const hp = await fetchHealthProfile();
      const userHealthProfile = isHealthProfileEmpty(hp) ? null : hp;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
      let data: { analysis?: ProductAnalysis };
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            extractedText: result.extractedText,
            userHealthProfile,
            categoryOverride: override,
          }),
          signal: controller.signal,
        });
        data = await res.json();
        if (!res.ok || !data?.analysis) {
          toast.error(analysisErrorToast(data));
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
      const analysis = data.analysis as ProductAnalysis;
      setResult((r) => (r ? { ...r, analysis } : r));
      setExpanded(new Set());
      setCategoryEditing(false);
      setCategoryConfirmed(true);
      setCategoryPick("");

      // Keep the saved row in sync so history / search / PDF reflect the change.
      if (save.state === "saved" && save.id) {
        const pi = analysis.product_info ?? ({} as ProductAnalysis["product_info"]);
        await syncSavedRow(save.id, {
          category: pi.category ?? "uncategorized",
          detected_category: analysis.detected_category ?? null,
          compliance_status: deriveComplianceStatus(analysis),
          compliance_details: analysis.legal_metrology_compliance ?? {},
          ingredient_analysis: analysis.ingredient_analysis ?? [],
          dosage_analysis: analysis.dosage_analysis ?? {},
          personal_alerts: analysis.personal_alerts ?? [],
          healthier_alternatives: buildAlternatives(analysis),
          ...scoreColumns(analysis),
        });
      }
      toast.success("Re-analyzed for the selected category.");
    } catch {
      toast.error("Could not re-analyze with that category. Try again.");
    } finally {
      setReanalyzing(false);
    }
  }

  // --- re-analyse using the user's edited extracted text -------------
  async function reanalyzeWithText() {
    const text = textDraft.trim();
    if (!text || textReanalyzing || view !== "results") return;
    setTextReanalyzing(true);
    try {
      const hp = await fetchHealthProfile();
      const userHealthProfile = isHealthProfileEmpty(hp) ? null : hp;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
      let data: { analysis?: ProductAnalysis };
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extractedText: text, userHealthProfile }),
          signal: controller.signal,
        });
        data = await res.json();
        if (!res.ok || !data?.analysis) {
          toast.error(analysisErrorToast(data));
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
      const analysis = data.analysis as ProductAnalysis;
      setExtracted({ text, tier: "manual" });
      setResult((r) =>
        r
          ? { ...r, analysis, extractedText: text, tier: "manual" }
          : { analysis, extractedText: text, tier: "manual" },
      );
      setExpanded(new Set());
      setShowTextPanel(false);

      // Keep the saved row / safe-products state consistent.
      if (isInsufficientData(analysis)) {
        // a partial scan is never stored — nothing to sync
      } else if (save.state === "saved" && save.id) {
        const pi =
          analysis.product_info ?? ({} as ProductAnalysis["product_info"]);
        await syncSavedRow(save.id, {
          product_name: pi.name ?? "Unknown product",
          brand: pi.brand,
          category: pi.category ?? "uncategorized",
          detected_category: analysis.detected_category ?? null,
          extracted_text: text,
          compliance_status: deriveComplianceStatus(analysis),
          compliance_details: analysis.legal_metrology_compliance ?? {},
          ingredient_analysis: analysis.ingredient_analysis ?? [],
          dosage_analysis: analysis.dosage_analysis ?? {},
          personal_alerts: analysis.personal_alerts ?? [],
          healthier_alternatives: buildAlternatives(analysis),
          ...scoreColumns(analysis),
        });
      } else if (file) {
        void saveScan(analysis, text, file);
      }
      toast.success("Re-analysed with your corrections.");
    } catch {
      toast.error("Could not re-analyse. Try again.");
    } finally {
      setTextReanalyzing(false);
    }
  }

  // --- results-derived values -----------------------------------------
  const derived = useMemo(() => {
    if (!result) return null;
    const a = result.analysis;
    const ingredients = a.ingredient_analysis ?? [];
    const counts: Record<SafetyStatus, number> = {
      safe: 0,
      caution: 0,
      harmful: 0,
      banned: 0,
      unknown: 0,
    };
    for (const ing of ingredients) {
      counts[ing.safety_status] = (counts[ing.safety_status] ?? 0) + 1;
    }
    const insufficient = isInsufficientData(a);
    const compliance = deriveComplianceStatus(a);
    const complianceIssues = Object.entries(a.legal_metrology_compliance ?? {})
      .filter(
        ([, v]) => v.issue && !isNotApplicable(v) && v.status !== "not_visible",
      )
      .map(([k, v]) => `${declLabel(k)}: ${v.issue}`);
    const hasViolations =
      !insufficient &&
      (compliance !== "compliant" || counts.harmful > 0 || counts.banned > 0);
    const alternatives = buildAlternatives(a);

    // What we actually managed to read off the label (for the partial-scan UI).
    const pi = a.product_info ?? ({} as ProductAnalysis["product_info"]);
    const readFacts: { label: string; value: string }[] = [
      ["Product name", pi.name],
      ["Brand", pi.brand],
      ["Net quantity", pi.net_weight],
      ["MRP", pi.mrp],
      ["Manufacture date", pi.manufacture_date],
      ["Expiry / best before", pi.expiry_date],
      ["FSSAI licence", pi.fssai_license],
      ["Manufacturer", pi.manufacturer_address],
    ]
      .filter((e): e is [string, string] => Boolean(e[1] && String(e[1]).trim()))
      .map(([label, value]) => ({ label, value: String(value) }));

    // Every personal-health-profile conflict: product-level alerts first, then
    // each ingredient's own flags (tagged with the ingredient name). Sorted
    // critical -> warning -> info.
    const personalFlags: PersonalFlag[] = [
      ...(a.personal_alerts ?? []),
      ...ingredients.flatMap((ing) =>
        (ing.personal_flags ?? []).map((f) => ({
          ...f,
          ingredient: f.ingredient ?? ing.name,
        })),
      ),
    ].sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);

    // "What you should know" — the model's headline findings, or a derived
    // fallback so the section is never empty.
    const modelFindings = (a.key_findings ?? [])
      .map((s) => String(s).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 4);
    const fallbackFindings: string[] = [];
    if (counts.banned > 0)
      fallbackFindings.push(
        `Contains ${counts.banned} banned ingredient${counts.banned > 1 ? "s" : ""}`,
      );
    if (counts.harmful > 0)
      fallbackFindings.push(
        `Contains ${counts.harmful} harmful additive${counts.harmful > 1 ? "s" : ""}`,
      );
    if (compliance === "non_compliant")
      fallbackFindings.push("Fails several label-declaration checks");
    else if (compliance === "partial")
      fallbackFindings.push("Some label declarations are missing");
    if (a.dosage_analysis?.cumulative_risk === "high")
      fallbackFindings.push("High overall additive load");
    if (fallbackFindings.length === 0)
      fallbackFindings.push("No harmful or banned ingredients found");

    // "What you should know" must draw from BOTH dimensions — a clean safety
    // record is only half the story for a food.
    const nutritionFindings: string[] = [];
    const n = a.nutritional_analysis;
    if (n) {
      if (n.primary_concern)
        nutritionFindings.push(`Primary concern: ${n.primary_concern.explanation}`);
      const worst = n.concerns.find((c) => c.concern_level === "significant");
      const highs = n.threshold_flags.filter(
        (f) => f.level === "high" || f.level === "very_high",
      );
      if (highs.length)
        nutritionFindings.push(
          highs
            .map((f) => `High ${f.nutrient.toLowerCase()}: ${f.value_per_100}${f.unit} per 100`)
            .join(" · "),
        );
      if (n.sugar_alias_count >= 3)
        nutritionFindings.push(
          `Sugar listed under ${n.sugar_alias_count} different names`,
        );
      if (n.is_ultra_processed) nutritionFindings.push("Ultra-processed food");
      if (worst)
        nutritionFindings.push(
          `Made with ${worst.ingredient.toLowerCase()} — ${CONCERN_TYPE_LABEL[worst.concern_type]?.toLowerCase() ?? "a nutritional concern"}`,
        );
      else if (n.concerns.length)
        nutritionFindings.push(
          `${n.concerns.length} nutritional concern${n.concerns.length > 1 ? "s" : ""} in the ingredients`,
        );
    }

    const base = modelFindings.length ? modelFindings : fallbackFindings;
    // Only append what the model has not already said.
    const said = base.map((s) => s.toLowerCase());
    const extra = nutritionFindings.filter((f) => {
      const head = f.toLowerCase().split(/[:—-]/)[0].trim();
      return !said.some((s) => s.includes(head));
    });
    const keyFindings = [...base, ...extra].slice(0, 5);

    return {
      a,
      ingredients,
      counts,
      compliance,
      complianceIssues,
      hasViolations,
      alternatives,
      personalFlags,
      insufficient,
      readFacts,
      keyFindings,
    };
  }, [result]);

  // --- PDF ------------------------------------------------------------
  async function downloadPdf() {
    if (!result) return;
    setPdfBusy(true);
    try {
      const { generateReport } = await import("@/lib/pdf-generator");
      await generateReport({
        analysis: result.analysis,
        imageUrl: previewUrl,
        scanId: save.id ?? null,
      });
    } catch {
      toast.error("Could not generate the PDF report");
    } finally {
      setPdfBusy(false);
    }
  }

  async function shareReport() {
    if (!result) return;
    const a = result.analysis;
    const name = a.product_info?.name ?? "This product";
    const title = `HealthRepo: ${name} safety report`;
    const text = `${name} scored ${
      a.overall_assessment?.safety_score ?? "?"
    }/100 for safety on HealthRepo. ${a.overall_assessment?.recommendation ?? ""}`.trim();
    const url = save.id
      ? `${window.location.origin}/history/${save.id}`
      : window.location.origin;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Link copied to clipboard");
    } catch {
      /* user dismissed the share sheet, or clipboard blocked */
    }
  }

  const toggleExpanded = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const openTextPanel = () => {
    setTextDraft(extracted?.text ?? "");
    setShowTextPanel(true);
  };
  const closeTextPanel = () => setShowTextPanel(false);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <>
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
      <PageHeader title="Scan a product" />

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onInputChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onInputChange}
      />

      {/* ============ CAPTURE / PREVIEW ============ */}
      {view === "capture" && (
        <section className="flex flex-col gap-4">
          {reVerifyName && (
            <p className="flex items-start gap-2 rounded-xl border border-teal-500/30 bg-teal-500/[0.06] px-3 py-2 text-sm text-teal-800 dark:text-teal-200">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Scan <span className="font-semibold">{reVerifyName}</span> to
                update its safety verification.
              </span>
            </p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Photograph the packaging — the ingredients list and the MRP /
            net-quantity panel are the most useful. Text is read on your device,
            then checked for Legal Metrology and ingredient safety.
          </p>

          {!previewUrl ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-teal-600 px-4 py-8 text-white shadow-sm shadow-teal-600/30 transition-transform active:scale-[0.99]"
                >
                  <Camera className="h-8 w-8" aria-hidden />
                  <span className="text-sm font-semibold">Take Photo</span>
                  <span className="text-xs text-teal-50/90">Use your camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 px-4 py-8 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/[0.03]"
                >
                  <ImagePlus
                    className="h-8 w-8 text-teal-700 dark:text-teal-400"
                    aria-hidden
                  />
                  <span className="text-sm font-semibold">
                    Upload from Gallery
                  </span>
                  <span className="text-xs text-zinc-500">
                    Pick an existing photo
                  </span>
                </button>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb
                    className="h-4 w-4 text-amber-500"
                    aria-hidden
                  />
                  Tips for best results:
                </p>
                <ul className="mt-2 flex flex-col gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                  {IMAGE_TIPS.map((tip) => (
                    <li key={tip} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400"
                        aria-hidden
                      />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Selected product"
                loading="lazy"
                className="max-h-80 w-full rounded-2xl border border-zinc-200 object-contain dark:border-white/10"
              />
              <button
                type="button"
                onClick={() => runAnalysis()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/30 transition-transform active:scale-[0.99]"
              >
                <FlaskConical className="h-4 w-4" aria-hidden />
                Analyze This Product
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-zinc-600 hover:text-foreground dark:text-zinc-400"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Retake / change photo
              </button>
            </div>
          )}
        </section>
      )}

      {/* ============ PROCESSING ============ */}
      {view === "processing" && (
        <section className="flex flex-col gap-4">
          {extracted && (
            <ExtractedTextControl
              extracted={extracted}
              open={showTextPanel}
              canReanalyse={false}
              draft={textDraft}
              busy={textReanalyzing}
              onOpen={openTextPanel}
              onClose={closeTextPanel}
              onDraft={setTextDraft}
              onReanalyse={reanalyzeWithText}
            />
          )}
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Product being analysed"
              loading="lazy"
              className="mx-auto max-h-44 rounded-2xl border border-zinc-200 object-contain dark:border-white/10"
            />
          )}
          <ol className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
            <StepRow
              status={steps.ocr}
              label="📷 Reading text from image…"
              progress={steps.ocr === "active" ? ocrProgress : undefined}
            />
            <StepRow status={steps.verify} label="Verifying text quality…" />
            {steps.enhance !== "idle" && (
              <StepRow
                status={steps.enhance}
                label="🔍 Using AI to read text…"
              />
            )}
            {steps.advanced !== "idle" && (
              <StepRow
                status={steps.advanced}
                label="🔬 Image is difficult — using advanced AI reader…"
              />
            )}
            <StepRow
              status={steps.analyze}
              label="✅ Text extracted — analyzing ingredients and compliance…"
            />
            <StepRow status={steps.report} label="📊 Generating your report…" />
          </ol>
          {errInfo?.code === "overloaded" && (
            <p className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              The analysis service is busy — retrying automatically…
            </p>
          )}
        </section>
      )}

      {/* ============ ERROR ============ */}
      {view === "error" && errInfo && (() => {
        // Amber (wait, it's the service) vs red (connectivity / bad input).
        const soft =
          errInfo.code === "out_of_credits" ||
          errInfo.code === "auth_error" ||
          errInfo.code === "rate_limited" ||
          errInfo.code === "overloaded";
        const canRetry =
          errInfo.retryable && (Boolean(extracted?.text) || Boolean(file));
        return (
          <section
            role="alert"
            className={`flex flex-col gap-3 rounded-2xl border p-5 ${
              soft
                ? "border-amber-500/40 bg-amber-500/[0.06]"
                : "border-red-500/30 bg-red-500/[0.06]"
            }`}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className={`mt-0.5 h-5 w-5 shrink-0 ${
                  soft
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
                }`}
                aria-hidden
              />
              <div>
                <p
                  className={`font-semibold ${
                    soft
                      ? "text-amber-800 dark:text-amber-200"
                      : "text-red-700 dark:text-red-300"
                  }`}
                >
                  {errInfo.message}
                </p>
                {errInfo.hint && (
                  <p
                    className={`mt-1 text-sm ${
                      soft
                        ? "text-amber-800/90 dark:text-amber-200/90"
                        : "text-red-700/90 dark:text-red-300/90"
                    }`}
                  >
                    {errInfo.hint}
                  </p>
                )}
                {canRetry && extracted?.text && (
                  <p
                    className={`mt-1 text-xs ${
                      soft
                        ? "text-amber-700/80 dark:text-amber-300/80"
                        : "text-red-700/80 dark:text-red-300/80"
                    }`}
                  >
                    Your scanned text is kept — retrying re-analyses it without
                    re-reading the photo.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canRetry && (
                <button
                  type="button"
                  onClick={() => retryAnalysis()}
                  disabled={retryIn > 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  {retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
                </button>
              )}
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-white/15"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Change photo
              </button>
            </div>
          </section>
        );
      })()}

      {/* ============ GARBLED TEXT ============ */}
      {view === "garbled" && garbled && (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-200">
                Text couldn&rsquo;t be read accurately
              </p>
              <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/90">
                {garbled.message}
              </p>
              <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/90">
                {garbled.recommendation}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runAnalysis({ forceVision: true })}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Try with enhanced AI reading
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-white/15"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Retake photo
            </button>
          </div>
        </section>
      )}

      {/* ============ NOT A PACKAGED PRODUCT ============ */}
      {view === "notpackaged" && notPackaged && (
        <section className="flex flex-col gap-4">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Photo taken"
              loading="lazy"
              className="mx-auto max-h-44 rounded-2xl border border-zinc-200 object-contain dark:border-white/10"
            />
          )}
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
            <div className="flex items-start gap-2">
              <Package
                className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400"
                aria-hidden
              />
              <div>
                <p className="font-semibold">
                  This doesn&rsquo;t look like a packaged product
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {notPackaged.message}
                </p>
                {notPackaged.detected && (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    It looks like this might be {notPackaged.detected}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Camera className="h-4 w-4" aria-hidden />
                Take another photo
              </button>
              <button
                type="button"
                onClick={() => setView("manual")}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-white/15"
              >
                <PencilLine className="h-4 w-4" aria-hidden />
                Enter details manually
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ============ UNREADABLE (all 3 tiers failed) ============ */}
      {view === "unreadable" && (
        <section className="flex flex-col gap-4">
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-5"
          >
            <div className="flex items-start gap-2">
              <Frown
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
              <div>
                <p className="font-semibold text-amber-800 dark:text-amber-200">
                  😕 We couldn&rsquo;t read enough text from this image.
                </p>
                <p className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/90">
                  This might be because:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-800/90 dark:text-amber-200/90">
                  <li>The image is too blurry or dark</li>
                  <li>The text is too small to read</li>
                  <li>The label is damaged or obscured</li>
                </ul>
                {unreadableFields.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/90">
                    The advanced reader could not make out:{" "}
                    {unreadableFields.join(", ")}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Camera className="h-4 w-4" aria-hidden />
                📷 Try a different photo
              </button>
              <button
                type="button"
                onClick={() => setView("manual")}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-white/15"
              >
                <PencilLine className="h-4 w-4" aria-hidden />
                ✏️ Enter details manually
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ============ MANUAL ENTRY ============ */}
      {view === "manual" && (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <PencilLine
                className="h-4 w-4 text-teal-700 dark:text-teal-400"
                aria-hidden
              />
              Enter what you can read
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Type whatever is legible on the pack. The ingredients list matters
              most — copy it as printed. We&rsquo;ll analyse it the same way as a
              scan.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Product name
                <input
                  type="text"
                  value={manual.name}
                  onChange={(e) =>
                    setManual((m) => ({ ...m, name: e.target.value }))
                  }
                  placeholder="e.g. Classic Salted Potato Chips"
                  className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 dark:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Brand
                <input
                  type="text"
                  value={manual.brand}
                  onChange={(e) =>
                    setManual((m) => ({ ...m, brand: e.target.value }))
                  }
                  placeholder="e.g. Acme Foods"
                  className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 dark:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Ingredients list
                <textarea
                  value={manual.ingredients}
                  onChange={(e) =>
                    setManual((m) => ({ ...m, ingredients: e.target.value }))
                  }
                  rows={5}
                  placeholder="Copy the ingredients exactly as printed, separated by commas"
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 dark:border-white/15"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Any other details you can read
                <textarea
                  value={manual.other}
                  onChange={(e) =>
                    setManual((m) => ({ ...m, other: e.target.value }))
                  }
                  rows={3}
                  placeholder="MRP, net weight, FSSAI number, dates, manufacturer address, nutrition, allergens…"
                  className="w-full resize-y rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 dark:border-white/15"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={submitManual}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <FlaskConical className="h-4 w-4" aria-hidden />
                Analyze these details
              </button>
              <button
                type="button"
                onClick={() => setView("unreadable")}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-white/15"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Back
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ============ RESULTS ============ */}
      {view === "results" && derived && (
        <>
          {extracted && (
            <ExtractedTextControl
              extracted={extracted}
              open={showTextPanel}
              canReanalyse
              draft={textDraft}
              busy={textReanalyzing}
              onOpen={openTextPanel}
              onClose={closeTextPanel}
              onDraft={setTextDraft}
              onReanalyse={reanalyzeWithText}
            />
          )}
          {result?.tier && (
            <p className="flex items-center gap-2 rounded-xl bg-teal-600/10 px-3 py-2 text-xs font-medium text-teal-800 dark:text-teal-200">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">
                  {TIER_LABEL[result.tier].label}
                </span>{" "}
                — {TIER_LABEL[result.tier].note}
              </span>
            </p>
          )}
          {result?.warning && (
            <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {result.warning}
            </p>
          )}

          {/* a-1) Detected product category + which rules were applied */}
          <CategoryBanner
            analysis={derived.a}
            confirmed={categoryConfirmed}
            editing={categoryEditing}
            pick={categoryPick}
            reanalyzing={reanalyzing}
            onConfirm={() => setCategoryConfirmed(true)}
            onStartEdit={() => setCategoryEditing(true)}
            onCancelEdit={() => {
              setCategoryEditing(false);
              setCategoryPick("");
            }}
            onPick={setCategoryPick}
            onReanalyze={reanalyzeWithCategory}
          />

          {/* a0) Did this scan make it into the verified safe-products list? */}
          {!derived.insufficient &&
            save.state === "saved" &&
            (clampScore(derived.a.overall_assessment?.safety_score) >= 75 ? (
              <p className="flex items-start gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-800 dark:text-green-200">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  🌟 This product has been added to our safe products database!
                  Other users can now discover it.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-zinc-500/10 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400">
                <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  This product didn&rsquo;t meet our safety threshold (75+). It
                  won&rsquo;t appear in safe product recommendations.
                </span>
              </p>
            ))}

          {/* a) Product header + gauge — OR the partial-scan notice */}
          {derived.insufficient ? (
            <section className="flex flex-col gap-3 rounded-2xl border-2 border-amber-400/70 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-500/[0.08]">
              <p className="flex items-start gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                ⚠️ Partial scan — we could only read part of this label
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-200/90">
                To get a full safety report, photograph the back of the pack
                showing the complete ingredients list, FSSAI number, MRP and
                dates.
              </p>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 self-start rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Camera className="h-4 w-4" aria-hidden />
                Scan the full label
              </button>
              {derived.readFacts.length > 0 && (
                <div className="rounded-xl border border-amber-400/40 bg-white/60 p-3 dark:bg-white/[0.03]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    What we could read
                  </p>
                  <dl className="mt-1.5 flex flex-col gap-1 text-sm">
                    {derived.readFacts.map((f) => (
                      <div key={f.label} className="flex gap-2">
                        <dt className="shrink-0 text-zinc-500">{f.label}:</dt>
                        <dd className="font-medium">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <SaveNote save={save} />
            </section>
          ) : (
          <>
          {/* 1) VERDICT CARD */}
          <VerdictCard a={derived.a} save={save} />

          {/* 2) What you should know */}
          {derived.keyFindings.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
              <h3 className="text-sm font-semibold">What you should know</h3>
              <ul className="flex flex-col gap-1.5">
                {derived.keyFindings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500"
                      aria-hidden
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 3) Detailed sections — collapsed by default */}
          {/* b) Legal Metrology Compliance */}
          <Collapsible
            title={resolveCategory(derived.a.detected_category).complianceHeading}
            icon={
              <ClipboardCheck
                className="h-4 w-4 text-teal-700 dark:text-teal-400"
                aria-hidden
              />
            }
            badge={
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${COMPLIANCE_BADGE[derived.compliance].cls}`}
              >
                {COMPLIANCE_BADGE[derived.compliance].label}
              </span>
            }
          >
            {Object.keys(derived.a.legal_metrology_compliance ?? {}).length === 0 ? (
              <p className="text-sm text-zinc-500">No compliance data was returned.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-white/5">
                {Object.entries(derived.a.legal_metrology_compliance).map(
                  ([key, item]) => (
                    <ComplianceRow key={key} label={declLabel(key)} item={item} />
                  ),
                )}
              </ul>
            )}

            {derived.complianceIssues.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Issues found
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-200">
                  {derived.complianceIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </Collapsible>

          {/* b2) Personalized alerts — kept prominent, never collapsed */}
          {derived.personalFlags.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border-2 border-amber-400/70 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-500/[0.08]">
              <h3 className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-200">
                ⚡ Personalized alerts
              </h3>
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Based on your health profile:
              </p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {derived.personalFlags.map((f, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 text-sm ${PERSONAL_SEVERITY_STYLE[f.severity].cls}`}
                  >
                    <span aria-hidden>
                      {PERSONAL_SEVERITY_STYLE[f.severity].icon}
                    </span>
                    <span>
                      {f.ingredient && (
                        <span className="font-medium">{f.ingredient}: </span>
                      )}
                      {f.reason}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/profile/health"
                className="mt-1 inline-flex items-center gap-1 self-start text-xs font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
              >
                Edit your health profile →
              </Link>
            </section>
          )}

          {/* c) Ingredient analysis */}
          <Collapsible
            title="Ingredient analysis"
            icon={
              <FlaskConical
                className="h-4 w-4 text-teal-700 dark:text-teal-400"
                aria-hidden
              />
            }
            badge={
              derived.counts.harmful + derived.counts.banned > 0 ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                  {derived.counts.harmful + derived.counts.banned} flagged
                </span>
              ) : (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-500/15 dark:text-green-300">
                  All clear
                </span>
              )
            }
          >
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
              <span className="text-green-600 dark:text-green-400">
                {derived.counts.safe} safe
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                {derived.counts.caution} caution
              </span>
              <span className="text-red-600 dark:text-red-400">
                {derived.counts.harmful} harmful
              </span>
              <span className="text-red-700 dark:text-red-300">
                {derived.counts.banned} banned
              </span>
              {derived.counts.unknown > 0 && (
                <span className="text-zinc-500">{derived.counts.unknown} unknown</span>
              )}
            </p>

            {derived.ingredients.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No individual ingredients were identified in the text.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {derived.ingredients.map((ing, i) => (
                  <IngredientCard
                    key={`${ing.name}-${i}`}
                    ing={ing}
                    open={expanded.has(i)}
                    onToggle={() => toggleExpanded(i)}
                  />
                ))}
              </ul>
            )}
          </Collapsible>

          {/* c1) Nutritional quality — food categories only */}
          {derived.a.nutritional_analysis && (
            <Collapsible
              title="Nutritional quality"
              icon={
                <Wheat
                  className="h-4 w-4 text-teal-700 dark:text-teal-400"
                  aria-hidden
                />
              }
              badge={
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    clampScore(derived.a.nutritional_analysis.nutrition_score) >= 65
                      ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                      : clampScore(derived.a.nutritional_analysis.nutrition_score) >= 40
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
                  }`}
                >
                  {clampScore(derived.a.nutritional_analysis.nutrition_score)}/100
                </span>
              }
            >
              <NutritionSection n={derived.a.nutritional_analysis} />
            </Collapsible>
          )}

          {/* c2) Additive dosage check */}
          <Collapsible
            title="Additive dosage check"
            icon={
              <Gauge
                className="h-4 w-4 text-teal-700 dark:text-teal-400"
                aria-hidden
              />
            }
          >
            <DosageSection da={derived.a.dosage_analysis} embedded />
          </Collapsible>

          {/* d) Healthier alternatives */}
          {derived.alternatives.length > 0 && (
            <Collapsible
              title="Healthier alternatives"
              icon={
                <Salad
                  className="h-4 w-4 text-green-600 dark:text-green-400"
                  aria-hidden
                />
              }
            >
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
                      <ArrowRight className="h-4 w-4 text-zinc-400" aria-hidden />
                      <span className="flex flex-wrap gap-1">
                        {alt.alternatives.map((opt, j) => (
                          <span
                            key={j}
                            className="rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300"
                          >
                            {opt}
                          </span>
                        ))}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold">What to look for on labels: </span>
                      {alt.tip}
                    </p>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}

          {/* 4) Full assessment — the long summary lives here, collapsed */}
          <Collapsible
            title="Full assessment"
            icon={
              <FileText
                className="h-4 w-4 text-teal-700 dark:text-teal-400"
                aria-hidden
              />
            }
          >
            {derived.a.overall_assessment?.summary ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {derived.a.overall_assessment.summary}
              </p>
            ) : null}
            {derived.a.overall_assessment?.recommendation ? (
              <p className="mt-2 text-sm font-medium">
                {derived.a.overall_assessment.recommendation}
              </p>
            ) : null}
            {!derived.a.overall_assessment?.summary &&
              !derived.a.overall_assessment?.recommendation && (
                <p className="text-sm text-zinc-500">
                  No additional assessment notes were returned.
                </p>
              )}
          </Collapsible>
          </>
          )}

          {/* e) Sticky actions */}
          <div className="sticky bottom-16 -mx-4 mt-2 border-t border-zinc-200 bg-background/95 px-4 py-3 backdrop-blur dark:border-white/10 md:bottom-0">
            {derived.insufficient ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white"
              >
                <Camera className="h-4 w-4" aria-hidden />
                Scan the full label
              </button>
              <button
                type="button"
                onClick={() => setView("manual")}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-semibold dark:border-white/15"
              >
                <PencilLine className="h-4 w-4" aria-hidden />
                Enter details manually
              </button>
            </div>
            ) : (
            <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadPdf}
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
                onClick={shareReport}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-semibold dark:border-white/15"
              >
                <Share2 className="h-4 w-4" aria-hidden />
                Share
              </button>
              {derived.hasViolations &&
                (save.state === "saved" && save.id ? (
                  <Link
                    href={`/complaint/${save.id}`}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white"
                  >
                    <Siren className="h-4 w-4" aria-hidden />
                    File Complaint
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowComplaint((v) => !v)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white"
                  >
                    <Siren className="h-4 w-4" aria-hidden />
                    File Complaint
                  </button>
                ))}
            </div>

            {showComplaint && !(save.state === "saved" && save.id) && (
              <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                <p className="font-semibold">File this with the authorities</p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Take your PDF report and the product photo, then raise a
                  grievance on the portal for this product type (
                  {resolveCategory(derived.a.detected_category).label}):
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {resolveCategory(derived.a.detected_category).portals.map(
                    (portal) => (
                      <li key={portal.url}>
                        <a
                          href={portal.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300"
                        >
                          {portal.label}
                        </a>
                        {portal.phone && (
                          <span className="text-xs text-zinc-500">
                            {" "}
                            — call {portal.phone}
                          </span>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
            </>
            )}
          </div>
        </>
      )}
    </main>
    </>
  );
}

/** Alternatives list used for both the UI section and the Supabase row. */
function buildAlternatives(a: ProductAnalysis) {
  return (a.ingredient_analysis ?? [])
    .filter((ing) => ing.safety_status === "harmful" || ing.safety_status === "banned")
    .map((ing) => {
      const ref = referenceFor(ing.name);
      const alternatives =
        ref?.alternatives ?? splitAlternatives(ing.healthier_alternative);
      return {
        name: ing.name,
        status: ing.safety_status,
        alternatives: alternatives.length ? alternatives : ["No specific alternative listed"],
        tip:
          ref?.what_to_look_for_on_label ??
          "Check the ingredients list and choose a product that does not name this additive.",
      };
    });
}

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------

function StepRow({
  status,
  label,
  progress,
}: {
  status: StepState;
  label: string;
  progress?: number;
}) {
  return (
    <li className="flex items-center gap-3">
      {status === "done" ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden />
      ) : status === "active" ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-teal-600" aria-hidden />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-zinc-300 dark:text-white/20" aria-hidden />
      )}
      <div className="flex-1">
        <span
          className={`text-sm ${
            status === "idle"
              ? "text-zinc-400"
              : status === "done"
                ? "text-zinc-500 line-through"
                : "font-medium"
          }`}
        >
          {label}
        </span>
        {typeof progress === "number" && (
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-teal-600 transition-[width] duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
    </li>
  );
}

// (The single circular SafetyGauge was replaced by ScoreStrip — three compact
// scores side by side. `scoreBand().stroke` is kept for the history page,
// which still renders a gauge from a stored row.)

function ComplianceRow({ label, item }: { label: string; item: ComplianceItem }) {
  const state =
    item.present && item.compliant
      ? "ok"
      : item.present
        ? "issue"
        : isNotApplicable(item)
          ? "na"
          : "missing";

  const icon =
    state === "ok" ? (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
    ) : state === "issue" ? (
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
    ) : state === "na" ? (
      <Circle className="h-4 w-4 shrink-0 text-zinc-300 dark:text-white/20" aria-hidden />
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
        {item.issue && state !== "na" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{item.issue}</p>
        )}
        {state === "missing" && !item.issue && (
          <p className="text-xs text-red-600 dark:text-red-400">Missing from the label</p>
        )}
      </div>
    </li>
  );
}

function IngredientCard({
  ing,
  open,
  onToggle,
}: {
  ing: IngredientAnalysis;
  open: boolean;
  onToggle: () => void;
}) {
  const style = STATUS_STYLE[ing.safety_status] ?? STATUS_STYLE.unknown;
  const personalFlags = ing.personal_flags ?? [];
  const personalCritical = personalFlags.some((f) => f.severity === "critical");
  return (
    <li className={`overflow-hidden rounded-xl border border-zinc-200 dark:border-white/10 ${style.card}`}>
      {personalFlags.length > 0 && (
        <div
          className={`flex items-center gap-1.5 px-3 pt-2 text-[11px] font-semibold ${
            personalCritical
              ? "text-red-700 dark:text-red-300"
              : "text-amber-700 dark:text-amber-300"
          }`}
        >
          {personalCritical
            ? "🔴 Allergy / health risk for you"
            : "🟡 Conflicts with your profile"}
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex-1 text-sm font-medium">{ing.name}</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}
        >
          {ing.safety_status === "banned" && <Skull className="h-3 w-3" aria-hidden />}
          {style.label}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-zinc-100 px-3 py-3 text-sm dark:border-white/5">
          {personalFlags.length > 0 && (
            <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-2.5 dark:border-amber-500/30 dark:bg-amber-500/[0.08]">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Based on your health profile
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {personalFlags.map((f, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-1.5 text-xs ${PERSONAL_SEVERITY_STYLE[f.severity].cls}`}
                  >
                    <span aria-hidden>
                      {PERSONAL_SEVERITY_STYLE[f.severity].icon}
                    </span>
                    {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ing.reason && (
            <Field title="Why it's flagged">{ing.reason}</Field>
          )}
          {ing.health_effects && (
            <Field title="What it does to your body">{ing.health_effects}</Field>
          )}
          {ing.who_should_avoid && (
            <Field title="Who should especially avoid it">{ing.who_should_avoid}</Field>
          )}
          {ing.banned_in_countries?.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Banned / restricted in
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {ing.banned_in_countries.map((country, i) => (
                  <span
                    key={i}
                    className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-white/10"
                  >
                    {country}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {ing.healthier_alternative && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Healthier alternative
              </p>
              <p className="mt-0.5 text-green-700 dark:text-green-400">
                {ing.healthier_alternative}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{children}</p>
    </div>
  );
}

function DosageSection({
  da,
  embedded = false,
}: {
  da: DosageAnalysis;
  /** When true, render bare (no card chrome / heading) for use inside a Collapsible. */
  embedded?: boolean;
}) {
  const c = da.additive_count;
  const risk = RISK_STYLE[da.cumulative_risk] ?? RISK_STYLE.low;

  const countParts = (
    [
      [c.preservatives, "preservative"],
      [c.colors, "colour"],
      [c.sweeteners, "sweetener"],
      [c.antioxidants, "antioxidant"],
      [c.emulsifiers, "emulsifier"],
      [c.flavor_enhancers, "flavour enhancer"],
    ] as [number, string][]
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);

  const countList =
    countParts.length <= 1
      ? countParts.join("")
      : `${countParts.slice(0, -1).join(", ")} and ${
          countParts[countParts.length - 1]
        }`;

  const summary =
    countParts.length > 0
      ? `This product contains ${countList} (${c.total} additive${
          c.total === 1 ? "" : "s"
        } in total).`
      : "No regulated additives were identified in the ingredients list.";

  return (
    <div
      className={
        embedded
          ? "flex flex-col gap-3"
          : "flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10"
      }
    >
      {!embedded && (
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge
            className="h-4 w-4 text-teal-700 dark:text-teal-400"
            aria-hidden
          />
          Additive dosage check
        </h3>
      )}

      <p className="text-sm text-zinc-600 dark:text-zinc-400">{summary}</p>

      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Overall additive load:</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${risk.cls}`}
        >
          {risk.label}
        </span>
      </div>

      {da.limit_checks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {da.limit_checks.map((lc, i) => {
            const badge =
              lc.status === "within_limit"
                ? {
                    text: "Within FSSAI limit",
                    cls: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
                    Icon: CheckCircle2,
                  }
                : lc.status === "exceeds_limit"
                  ? {
                      text: "EXCEEDS FSSAI LIMIT ⚠️",
                      cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
                      Icon: AlertTriangle,
                    }
                  : {
                      text: "Quantity not disclosed",
                      cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                      Icon: Circle,
                    };
            return (
              <li
                key={`${lc.name}-${i}`}
                className={`rounded-xl border border-zinc-200 p-3 dark:border-white/10 ${
                  lc.status === "exceeds_limit" ? "border-l-4 border-l-red-500" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-sm font-medium">{lc.name}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                  >
                    <badge.Icon className="h-3 w-3" aria-hidden />
                    {badge.text}
                  </span>
                </div>
                {(lc.fssai_limit || lc.declared_quantity_if_available) && (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {lc.fssai_limit && (
                      <>FSSAI limit: {lc.fssai_limit}</>
                    )}
                    {lc.fssai_limit && lc.declared_quantity_if_available && " · "}
                    {lc.declared_quantity_if_available && (
                      <>Declared on pack: {lc.declared_quantity_if_available}</>
                    )}
                  </p>
                )}
                {lc.note && (
                  <p className="mt-1 text-xs text-zinc-500">{lc.note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {da.daily_intake_warning && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <Gauge className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {da.daily_intake_warning}
        </p>
      )}

      {da.combination_warnings.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Combination warnings
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-red-800 dark:text-red-200">
            {da.combination_warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Collapsible card used for every secondary results section (collapsed by default). */
function Collapsible({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left"
      >
        {icon}
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {badge}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-zinc-100 px-5 py-4 dark:border-white/5">
          {children}
        </div>
      )}
    </section>
  );
}

const VERDICT_META: Record<
  Verdict,
  { label: string; card: string; text: string; Icon: typeof CheckCircle2 }
> = {
  safe: {
    label: "Safe to consume",
    card: "border-green-500/50 bg-green-500/[0.06] dark:bg-green-500/[0.1]",
    text: "text-green-700 dark:text-green-300",
    Icon: CheckCircle2,
  },
  caution: {
    label: "Consume with caution",
    card: "border-amber-500/50 bg-amber-500/[0.06] dark:bg-amber-500/[0.1]",
    text: "text-amber-700 dark:text-amber-300",
    Icon: AlertTriangle,
  },
  limit: {
    label: "Okay occasionally",
    card: "border-orange-500/50 bg-orange-500/[0.06] dark:bg-orange-500/[0.1]",
    text: "text-orange-700 dark:text-orange-300",
    Icon: Hourglass,
  },
  avoid: {
    label: "Avoid this product",
    card: "border-red-500/60 bg-red-500/[0.06] dark:bg-red-500/[0.1]",
    text: "text-red-700 dark:text-red-300",
    Icon: XCircle,
  },
};

/** Sub-line under the verdict headline. 'limit' needs the explanation most. */
const VERDICT_SUBLINE: Record<Verdict, string | null> = {
  safe: null,
  caution: null,
  limit:
    "No harmful ingredients, but nutritionally poor — okay occasionally, not as a regular choice.",
  avoid: null,
};

const STAPLE_SPARING_RE =
  /\b(oil|ghee|vanaspati|dalda|sugar|jaggery|gur|salt|namak|honey|syrup|molasses)\b/i;

/**
 * The verdict headline + sub-line, keyed off food_type as well as the score.
 * Returns null to keep the plain VERDICT_META label (non-food, unscored, and
 * the 'avoid' / 'limit' cases which VERDICT_META already words well).
 */
function verdictDisplay(
  a: ProductAnalysis,
): { label: string; subline: string | null } | null {
  const n = a.nutritional_analysis;
  const s = a.overall_assessment?.nutrition_score;
  if (!n || s == null) return null;

  // STAPLE INGREDIENT — a cooking input, never a "bad product".
  if (n.food_type === "staple_ingredient") {
    const sparing =
      n.nutrient_density === "empty" ||
      STAPLE_SPARING_RE.test(a.product_info?.name ?? "") ||
      STAPLE_SPARING_RE.test(a.ingredient_analysis?.[0]?.name ?? "");
    if (sparing) {
      return {
        label: "Use sparingly",
        subline:
          "A cooking staple that is calorie-dense with little else — use it as an ingredient, in small amounts.",
      };
    }
    if (s >= 75) {
      return {
        label: "Good staple",
        subline: "A sound everyday cooking ingredient.",
      };
    }
    const alt = n.concerns[0]?.better_alternative;
    return {
      label: "Fine staple",
      subline: `A normal, affordable staple — nothing to avoid.${
        alt ? ` ${alt} is more nutritious.` : ""
      }`,
    };
  }

  // MINIMALLY PROCESSED and PROCESSED — the 'safe' band splits by score.
  if (a.verdict !== "safe") return null;
  if (s <= 75) {
    return {
      label: "Reasonable choice",
      subline:
        "Fine to eat — nothing harmful — though less refined versions are more nutritious.",
    };
  }
  return { label: "Good choice", subline: null };
}

/**
 * The three score dimensions, side by side and each tappable to expand.
 * Non-food categories have no nutrition dimension, so they show two.
 */
function ScoreStrip({ a }: { a: ProductAnalysis }) {
  const [open, setOpen] = useState<string | null>(null);
  const oa = a.overall_assessment;
  const isFood = isFoodCategory(a.detected_category?.category);

  const tiles: {
    key: string;
    label: string;
    score: number | null;
    detail: string;
  }[] = [
    {
      key: "safety",
      label: "Safety",
      score: oa?.safety_score ?? null,
      detail:
        "Banned substances and harmful additives only. A high safety score means nothing on this label is dangerous — it does not mean the product is nutritious.",
    },
    ...(isFood
      ? [
          {
            key: "nutrition",
            label: "Nutrition",
            score: oa?.nutrition_score ?? null,
            detail:
              a.nutritional_analysis?.moderation_advice ||
              "Nutritional quality: refined grains, added sugar, refined oils, sodium and processing level. Legal, additive-free ingredients still count here.",
          },
        ]
      : []),
    {
      key: "compliance",
      label: "Compliance",
      score: oa?.compliance_score ?? null,
      detail:
        "Whether the pack carries every declaration the Legal Metrology (Packaged Commodities) Rules 2011 require.",
    },
  ];

  const overall = oa?.overall_score ?? null;
  const opened = tiles.find((t) => t.key === open);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => {
          const band = t.score == null ? null : scoreBand(clampScore(t.score));
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setOpen(open === t.key ? null : t.key)}
              aria-expanded={open === t.key}
              className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 transition-colors ${
                open === t.key
                  ? "border-teal-500/60 bg-teal-500/[0.07]"
                  : "border-zinc-200 dark:border-white/10"
              }`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {t.label}
              </span>
              <span
                className={`text-2xl font-extrabold tabular-nums leading-none ${
                  band ? band.text : "text-zinc-400"
                }`}
              >
                {t.score == null ? "—" : clampScore(t.score)}
              </span>
              {t.score != null && (
                <span className="h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                  <span
                    className={`block h-full rounded-full ${band?.bar ?? ""}`}
                    style={{ width: `${clampScore(t.score)}%` }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {opened && (
        <p className="rounded-xl bg-zinc-500/[0.07] px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold">{opened.label}: </span>
          {opened.score == null
            ? "Not enough of the label was readable to score this. "
            : ""}
          {opened.detail}
        </p>
      )}

      {overall != null && (
        <p className="text-center text-xs text-zinc-500">
          Overall <span className="font-bold tabular-nums">{overall}</span>/100
          {isFood
            ? " — safety 35%, nutrition 50%, compliance 15%"
            : " — safety 75%, compliance 25%"}
        </p>
      )}
    </div>
  );
}

/** The top-of-results verdict card: big call, one-line reason, three scores. */
function VerdictCard({ a, save }: { a: ProductAnalysis; save: SaveState }) {
  const m = VERDICT_META[a.verdict] ?? VERDICT_META.caution;
  const foodWording = verdictDisplay(a);
  const label = foodWording?.label ?? m.label;
  const subline = foodWording?.subline ?? VERDICT_SUBLINE[a.verdict];
  return (
    <section className={`flex flex-col gap-3 rounded-2xl border-2 p-5 ${m.card}`}>
      <p className="text-xs font-medium text-zinc-500">
        {a.product_info?.name ?? "Product name not readable"}
        {a.product_info?.brand ? ` · ${a.product_info.brand}` : ""}
      </p>

      <ScoreStrip a={a} />

      <div className="min-w-0">
        <p
          className={`flex items-center gap-2 text-lg font-extrabold leading-tight ${m.text}`}
        >
          <m.Icon className="h-5 w-5 shrink-0" aria-hidden />
          {label}
        </p>
        {a.verdict_reason && (
          <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">
            {a.verdict_reason}
          </p>
        )}
        {subline && (
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {subline}
          </p>
        )}
      </div>
      <SaveNote save={save} />
    </section>
  );
}

/** Persistent "View extracted text" control — visible during analysis and after. */
function ExtractedTextControl({
  extracted,
  open,
  canReanalyse,
  draft,
  busy,
  onOpen,
  onClose,
  onDraft,
  onReanalyse,
}: {
  extracted: { text: string; tier: Tier };
  open: boolean;
  canReanalyse: boolean;
  draft: string;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDraft: (v: string) => void;
  onReanalyse: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={open ? onClose : onOpen}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-foreground dark:border-white/10 dark:text-zinc-400"
        >
          <PencilLine className="h-3.5 w-3.5" aria-hidden />
          {open ? "Hide extracted text" : "📝 View extracted text"}
        </button>
      </div>

      {open && (
        <div className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
          <p className="text-xs text-zinc-500">
            Read by: {readByLabel(extracted.tier)}
          </p>
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            rows={8}
            spellCheck={false}
            className="mt-2 w-full resize-y rounded-xl border border-zinc-300 bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground dark:border-white/15"
          />
          <p className="mt-2 text-xs text-zinc-500">
            Spot a mistake? Fix it and re-analyse.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onReanalyse}
              disabled={busy || !canReanalyse || !draft.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              Re-analyse with my corrections
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-white/15"
            >
              Cancel
            </button>
          </div>
          {!canReanalyse && (
            <p className="mt-2 text-[11px] text-zinc-400">
              You can re-analyse once the current analysis finishes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryBanner({
  analysis,
  confirmed,
  editing,
  pick,
  reanalyzing,
  onConfirm,
  onStartEdit,
  onCancelEdit,
  onPick,
  onReanalyze,
}: {
  analysis: ProductAnalysis;
  confirmed: boolean;
  editing: boolean;
  pick: DetectedCategoryId | "";
  reanalyzing: boolean;
  onConfirm: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onPick: (id: DetectedCategoryId) => void;
  onReanalyze: (id: DetectedCategoryId) => void;
}) {
  const dc = analysis.detected_category;
  const meta = resolveCategory(dc);
  const shelfCategory = analysis.product_info?.category;
  const lowConfidence = dc?.confidence === "low";
  const showReview = editing || (lowConfidence && !confirmed);

  return (
    <section
      className={`flex flex-col gap-2 rounded-2xl border-2 bg-white p-4 dark:bg-white/[0.03] ${meta.accentClass}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
        >
          <span aria-hidden>{meta.emoji}</span>
          {meta.label}
        </span>
        {dc?.confidence && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {dc.confidence} confidence
          </span>
        )}
      </div>

      <p className="flex items-start gap-2 text-sm">
        <Package className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
        <span>
          <span className="font-medium">Product type:</span>{" "}
          {shelfCategory ? `${titleCase(shelfCategory)} — ` : ""}
          {meta.label}
        </span>
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium">📋 Regulated by:</span> {meta.regulatoryBody}{" "}
        <span className="text-zinc-500">under {meta.act}</span>
      </p>
      {dc?.signals_found && dc.signals_found.length > 0 && (
        <p className="text-xs text-zinc-500">
          Detected from: {dc.signals_found.slice(0, 6).join(", ")}
        </p>
      )}

      {showReview && (
        <div className="mt-1 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3">
          {!editing ? (
            <>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                We detected this as a {meta.label}. Is that correct?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onConfirm}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Yes, correct
                </button>
                <button
                  type="button"
                  onClick={onStartEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-white/15"
                >
                  No, change category
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-amber-900 dark:text-amber-200">
                Choose the correct category
                <select
                  value={pick}
                  onChange={(e) => onPick(e.target.value as DetectedCategoryId)}
                  className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground dark:border-white/15"
                >
                  <option value="">Select…</option>
                  {SELECTABLE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!pick || reanalyzing}
                  onClick={() => pick && onReanalyze(pick)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {reanalyzing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Re-analyze
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={reanalyzing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold dark:border-white/15"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!showReview && !lowConfidence && (
        <button
          type="button"
          onClick={onStartEdit}
          className="self-start text-xs font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300"
        >
          Not a {meta.label}? Change category
        </button>
      )}
    </section>
  );
}

function SaveNote({ save }: { save: SaveState }) {
  const text =
    save.state === "saving"
      ? "Saving to your history…"
      : save.state === "saved"
        ? "Saved to your scan history"
        : save.state === "skipped"
          ? "Sign in to save this scan to your history"
          : save.state === "error"
            ? "Could not save this scan"
            : null;
  if (!text) return null;
  return <p className="text-xs text-zinc-500">{text}</p>;
}
