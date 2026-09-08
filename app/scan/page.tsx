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
import { HEALTHIER_ALTERNATIVES, REFERENCE_METADATA } from "@/lib/reference-data";
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
  PersonalFlag,
  PersonalFlagSeverity,
} from "@/types/analysis";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type View =
  | "capture"
  | "processing"
  | "verify"
  | "results"
  | "error"
  | "garbled"
  | "unreadable"
  | "manual";
type VerifyChoice = "analyze" | "vision" | "auto";
/** Which rung of the three-tier extraction chain produced the analysed text. */
type Tier = "tesseract" | "haiku" | "sonnet" | "manual";
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
  !item.present && item.compliant && /not applicable/i.test(item.issue ?? "");

function deriveComplianceStatus(
  a: ProductAnalysis,
): "compliant" | "non_compliant" | "partial" {
  const items = Object.values(a.legal_metrology_compliance ?? {}).filter(
    (v) => !isNotApplicable(v),
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
    return { label: "Safe", stroke: "stroke-green-500", text: "text-green-600 dark:text-green-400" };
  if (score >= 50)
    return { label: "Caution", stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { label: "Unsafe", stroke: "stroke-red-600", text: "text-red-600 dark:text-red-400" };
}

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
  const [errInfo, setErrInfo] = useState<{ message: string; hint?: string } | null>(
    null,
  );
  const [garbled, setGarbled] = useState<{
    message: string;
    recommendation: string;
  } | null>(null);
  const [verifyText, setVerifyText] = useState("");
  const [verifyExpanded, setVerifyExpanded] = useState(false);
  const [unreadableFields, setUnreadableFields] = useState<string[]>([]);
  const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);
  const [result, setResult] = useState<{
    analysis: ProductAnalysis;
    extractedText: string;
    tier: Tier;
    warning?: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [showComplaint, setShowComplaint] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const toast = useToast();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  // Resolver + timeout handle for the "verify" gate (see runAnalysis).
  const verifyResolveRef = useRef<((choice: VerifyChoice) => void) | null>(null);
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );
  useEffect(
    () => () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    },
    [],
  );

  const selectFile = useCallback((picked: File) => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(picked);
    });
    setFile(picked);
    setResult(null);
    setErrInfo(null);
    setGarbled(null);
    setUnreadableFields([]);
    setManual(EMPTY_MANUAL);
    setSteps(IDLE_STEPS);
    setSave({ state: "idle" });
    setView("capture");
  }, []);

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
    setUnreadableFields([]);
    setManual(EMPTY_MANUAL);
    setSteps(IDLE_STEPS);
    setSave({ state: "idle" });
    setView("capture");
  };

  /** Resolve the pending "verify" gate with the user's pick (or the timeout). */
  const settleVerify = useCallback((choice: VerifyChoice) => {
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current);
      verifyTimerRef.current = null;
    }
    const resolve = verifyResolveRef.current;
    verifyResolveRef.current = null;
    resolve?.(choice);
  }, []);

  // --- shared tail: extracted text -> /api/analyze -> report ------------
  // Called by every path once a `sourceText` and its `tier` are settled
  // (all three extraction tiers, plus manual entry).
  const analyzeText = useCallback(
    async (
      sourceText: string,
      tier: Tier,
      opts?: { lowConfidence?: boolean },
    ) => {
      setSteps((s) => ({ ...s, analyze: "active" }));

      // Personalise the analysis with the user's health profile, if they set one.
      const hp = await fetchHealthProfile();
      const userHealthProfile = isHealthProfileEmpty(hp) ? null : hp;

      let analysis: ProductAnalysis;
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extractedText: sourceText, userHealthProfile }),
        });
        const data = await res.json();

        // Claude judged the text unreadable and refused to analyse it.
        if (res.status === 422 && data?.error === "garbled_text") {
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

        if (!res.ok) {
          setErrInfo({
            message: data?.error ?? "The analysis service failed to respond.",
            hint: "Check your connection and try again.",
          });
          setView("error");
          return;
        }
        analysis = data.analysis as ProductAnalysis;
      } catch {
        setErrInfo({
          message: "Could not reach the analysis service.",
          hint: "Check your connection and try again.",
        });
        setView("error");
        return;
      }
      if (!analysis || typeof analysis !== "object") {
        setErrInfo({ message: "The analysis came back empty. Please try again." });
        setView("error");
        return;
      }

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

      if (file) void saveScan(analysis, sourceText, file);
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
      setUnreadableFields([]);
      setShowComplaint(false);
      setShowRawText(false);
      setOcrProgress(0);
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
            setErrInfo(mapOcrError(err));
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

        // ---- Optional 3s user gut-check on the raw OCR text ----
        let userChoice: VerifyChoice = "auto";
        if (tesseractText.trim()) {
          setVerifyText(tesseractText);
          setVerifyExpanded(false);
          setView("verify");
          userChoice = await new Promise<VerifyChoice>((resolve) => {
            verifyResolveRef.current = resolve;
            verifyTimerRef.current = setTimeout(() => {
              verifyTimerRef.current = null;
              verifyResolveRef.current = null;
              resolve("auto");
            }, 3000);
          });
          setView("processing");
        }

        if (userChoice === "analyze") {
          // User vouched for the on-device read — straight to analysis.
          setSteps((s) => ({ ...s, verify: "done" }));
          await analyzeText(tesseractText, "tesseract", { lowConfidence });
          return;
        }
        if (userChoice === "auto") {
          setSteps((s) => ({ ...s, verify: "active" }));
          await sleep(250); // let the "Verifying…" row register
          const tesseractGood =
            ocrConfidence > 70 &&
            ocrWordCount > 30 &&
            validateExtractedText(tesseractText).score >= 3;
          setSteps((s) => ({ ...s, verify: "done" }));
          if (tesseractGood) {
            await analyzeText(tesseractText, "tesseract", { lowConfidence });
            return;
          }
        } else {
          // userChoice === "vision" — user says the read is wrong.
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
      } catch {
        payload = null;
      }

      // ---- TIER 2: Haiku Vision ----
      let haikuText = "";
      if (payload) {
        try {
          const res = await fetch("/api/extract-text", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              imageBase64: payload.base64,
              mediaType: payload.mediaType,
            }),
          });
          const data = await res.json();
          if (res.ok && typeof data.extractedText === "string") {
            haikuText = data.extractedText.trim();
          }
        } catch {
          // fall through to tier 3
        }
      }

      if (haikuText && validateExtractedText(haikuText).score >= 3) {
        setSteps((s) => ({ ...s, enhance: "done" }));
        await analyzeText(haikuText, "haiku");
        return;
      }

      // ---- TIER 3: Sonnet Vision (advanced) ----
      setSteps((s) => ({ ...s, enhance: "done", advanced: "active" }));

      let sonnetText = "";
      let sonnetUnreadable: string[] = [];
      if (payload) {
        try {
          const res = await fetch("/api/extract-text-advanced", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              imageBase64: payload.base64,
              mediaType: payload.mediaType,
            }),
          });
          const data = await res.json();
          if (res.ok && typeof data.extractedText === "string") {
            sonnetText = data.extractedText.trim();
          }
          if (Array.isArray(data?.unreadableFields)) {
            sonnetUnreadable = data.unreadableFields
              .filter((x: unknown): x is string => typeof x === "string")
              .map((x: string) => x.trim())
              .filter(Boolean);
          }
        } catch {
          // handled below
        }
      }

      setSteps((s) => ({ ...s, advanced: "done" }));

      if (sonnetText && validateExtractedText(sonnetText).score >= 3) {
        await analyzeText(sonnetText, "sonnet");
        return;
      }

      // Safety net: if the Vision tiers never actually ran (the image could not
      // be encoded, or both calls errored at the transport level) but Tesseract
      // did read something plausible, analyse that rather than dead-ending.
      if (
        !payload &&
        tesseractText.trim() &&
        validateExtractedText(tesseractText).score >= 2
      ) {
        await analyzeText(tesseractText, "tesseract", { lowConfidence });
        return;
      }

      // All three tiers came up short — the image is genuinely unreadable.
      setUnreadableFields(sonnetUnreadable);
      setView("unreadable");
    },
    [file, analyzeText],
  );

  // --- manual entry -> analyze ----------------------------------------
  const submitManual = useCallback(async () => {
    const text = buildManualText(manual);
    if (text.replace(/\s+/g, "").length < 12 || !manual.ingredients.trim()) {
      toast.error("Add at least the product name and the ingredients list.");
      return;
    }
    setErrInfo(null);
    setGarbled(null);
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
      const score = Math.max(
        0,
        Math.min(100, Math.round(analysis.overall_assessment?.safety_score ?? 0)),
      );

      // Best-effort — a failed upload still saves the analysis, just without a photo.
      const imageUrl = await uploadProductImage(imageFile, user.id);

      const { data, error } = await supabase
        .from("scanned_products")
        .insert({
          user_id: user.id,
          product_name: pi.name ?? "Unknown product",
          brand: pi.brand,
          category: pi.category ?? "uncategorized",
          image_url: imageUrl,
          extracted_text: extractedText,
          compliance_status: deriveComplianceStatus(analysis),
          compliance_details: analysis.legal_metrology_compliance ?? {},
          ingredient_analysis: analysis.ingredient_analysis ?? [],
          dosage_analysis: analysis.dosage_analysis ?? {},
          personal_alerts: analysis.personal_alerts ?? [],
          healthier_alternatives: buildAlternatives(analysis),
          overall_score: score,
        })
        .select("id")
        .single();

      if (error) {
        setSave({ state: "error" });
        return;
      }
      setSave({ state: "saved", id: data.id as string });
    } catch {
      setSave({ state: "error" });
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
    const compliance = deriveComplianceStatus(a);
    const complianceIssues = Object.entries(a.legal_metrology_compliance ?? {})
      .filter(([, v]) => v.issue && !isNotApplicable(v))
      .map(([k, v]) => `${declLabel(k)}: ${v.issue}`);
    const hasViolations =
      compliance !== "compliant" || counts.harmful > 0 || counts.banned > 0;
    const alternatives = buildAlternatives(a);

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

    return {
      a,
      ingredients,
      counts,
      compliance,
      complianceIssues,
      hasViolations,
      alternatives,
      personalFlags,
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
        </section>
      )}

      {/* ============ USER TEXT VERIFICATION ============ */}
      {view === "verify" && (
        <section className="flex flex-col gap-4">
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Product being analysed"
              loading="lazy"
              className="mx-auto max-h-44 rounded-2xl border border-zinc-200 object-contain dark:border-white/10"
            />
          )}

          <div className="rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
            <p className="text-sm font-semibold">Quick check before we analyse</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              We read the text on your device. Take a quick look if you like — or
              just wait and we&rsquo;ll check it for you.
            </p>

            <button
              type="button"
              onClick={() => setVerifyExpanded((v) => !v)}
              aria-expanded={verifyExpanded}
              className="mt-3 flex w-full items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 text-left text-sm font-medium dark:border-white/10"
            >
              <span className="flex-1">📝 Preview extracted text</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                  verifyExpanded ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>

            {verifyExpanded && (
              <pre className="mt-2 max-h-[150px] overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-100 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">
                {verifyText || "No text was read from this image."}
              </pre>
            )}

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => settleVerify("analyze")}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.99]"
              >
                ✅ Looks correct — Analyze
              </button>
              <button
                type="button"
                onClick={() => settleVerify("vision")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-zinc-50 dark:border-white/15 dark:hover:bg-white/[0.03]"
              >
                ❌ Text looks wrong — Use AI reading
              </button>
            </div>

            <p className="mt-3 text-center text-xs text-zinc-500">
              Can&rsquo;t verify? Don&rsquo;t worry — we&rsquo;ll auto-check the
              text quality.
            </p>
          </div>
        </section>
      )}

      {/* ============ ERROR ============ */}
      {view === "error" && errInfo && (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300">
                {errInfo.message}
              </p>
              {errInfo.hint && (
                <p className="mt-1 text-sm text-red-700/90 dark:text-red-300/90">
                  {errInfo.hint}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {file && (
              <button
                type="button"
                onClick={() => runAnalysis()}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Try again
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
      )}

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

          {/* a) Product header + gauge */}
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 p-5 text-center dark:border-white/10">
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {derived.a.product_info?.name ?? "Unidentified product"}
              </h2>
              {derived.a.product_info?.brand && (
                <p className="text-sm text-zinc-500">{derived.a.product_info.brand}</p>
              )}
              {derived.a.product_info?.category && (
                <span className="mt-2 inline-block rounded-full bg-teal-600/10 px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-300">
                  {titleCase(derived.a.product_info.category)}
                </span>
              )}
            </div>
            <SafetyGauge score={derived.a.overall_assessment?.safety_score ?? 0} />
            {derived.a.overall_assessment?.summary && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {derived.a.overall_assessment.summary}
              </p>
            )}
            {derived.a.overall_assessment?.recommendation && (
              <p className="text-sm font-medium">
                {derived.a.overall_assessment.recommendation}
              </p>
            )}
            <SaveNote save={save} />
          </section>

          {/* b) Legal Metrology Compliance */}
          <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ClipboardCheck className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden />
                Legal Metrology Compliance
              </h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${COMPLIANCE_BADGE[derived.compliance].cls}`}
              >
                {COMPLIANCE_BADGE[derived.compliance].label}
              </span>
            </div>

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
          </section>

          {/* b2) Personalized alerts — only when the profile produced flags */}
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

          {/* c) Ingredient Analysis */}
          <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden />
              Ingredient Analysis
            </h3>
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
          </section>

          {/* c2) Additive dosage check */}
          <DosageSection da={derived.a.dosage_analysis} />

          {/* d) Healthier Alternatives */}
          {derived.alternatives.length > 0 && (
            <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Salad className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden />
                Healthier Alternatives
              </h3>
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
            </section>
          )}

          {/* raw text (handy for debugging a bad read) */}
          <div>
            <button
              type="button"
              onClick={() => setShowRawText((v) => !v)}
              className="text-xs font-medium text-zinc-500 underline underline-offset-2"
            >
              {showRawText ? "Hide" : "View"} extracted text
            </button>
            {showRawText && result && (
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 p-3 font-mono text-[11px] leading-relaxed text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                {result.extractedText}
              </pre>
            )}
          </div>

          {/* e) Sticky actions */}
          <div className="sticky bottom-16 -mx-4 mt-2 border-t border-zinc-200 bg-background/95 px-4 py-3 backdrop-blur dark:border-white/10 md:bottom-0">
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
                  grievance on either portal:
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  <li>
                    <a
                      href={REFERENCE_METADATA.complaint_portals.fssai_foscos}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300"
                    >
                      FSSAI FoSCoS grievance portal
                    </a>
                    <span className="text-xs text-zinc-500"> — food safety issues</span>
                  </li>
                  <li>
                    <a
                      href={REFERENCE_METADATA.complaint_portals.national_consumer_helpline}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300"
                    >
                      National Consumer Helpline
                    </a>
                    <span className="text-xs text-zinc-500">
                      {" "}
                      — call{" "}
                      {REFERENCE_METADATA.complaint_portals.national_consumer_helpline_number}
                    </span>
                  </li>
                </ul>
              </div>
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

function SafetyGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(clamped);
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
          strokeDashoffset={c * (1 - clamped / 100)}
          className={band.stroke}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-extrabold tabular-nums ${band.text}`}>
          {clamped}
        </span>
        <span className={`text-xs font-semibold uppercase tracking-wide ${band.text}`}>
          {band.label}
        </span>
      </div>
    </div>
  );
}

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

function DosageSection({ da }: { da: DosageAnalysis }) {
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
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Gauge className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden />
        Additive dosage check
      </h3>

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
