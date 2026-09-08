"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  FlaskConical,
  Copy,
  ExternalLink,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Phone,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ToastProvider";
import { supabase } from "@/lib/supabase";
import { findAdditiveLimit } from "@/lib/reference-data";
import type {
  ComplianceItem,
  DosageAnalysis,
  IngredientAnalysis,
  LimitCheck,
  SafetyStatus,
} from "@/types/analysis";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Option = "none" | "compliance" | "ingredients";

interface ScanRow {
  id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  compliance_status: "compliant" | "non_compliant" | "partial" | null;
  compliance_details: Record<string, ComplianceItem> | null;
  ingredient_analysis: IngredientAnalysis[] | null;
  dosage_analysis: DosageAnalysis | null;
  overall_score: number | null;
  scanned_at: string;
}

interface Violation {
  key: string;
  label: string;
  value: string | null;
  detail: string;
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
const oneLine = (s?: string | null) => (s ? s.replace(/\s+/g, " ").trim() : "");
const pick = (v?: string | null, fallback = "Not declared on the package") =>
  v && v.trim() ? v.trim() : fallback;

const isNotApplicable = (i: ComplianceItem) =>
  !i.present && i.compliant && /not applicable/i.test(i.issue ?? "");

function computeViolations(
  details: Record<string, ComplianceItem> | null | undefined,
): Violation[] {
  return Object.entries(details ?? {})
    .filter(([, v]) => v && !isNotApplicable(v) && !(v.present && v.compliant))
    .map(([k, v]) => ({
      key: k,
      label: declLabel(k),
      value: v.value ?? null,
      detail:
        v.issue?.trim() ||
        (v.present
          ? "Present but not in the prescribed format."
          : "Not printed on the label."),
    }));
}

/** Limit checks the analysis marked as over the FSSAI maximum. */
function limitChecksOverLimit(d: DosageAnalysis | null | undefined): LimitCheck[] {
  return (d?.limit_checks ?? []).filter((lc) => lc.status === "exceeds_limit");
}

/** Complaint-text block listing every additive that exceeds its FSSAI limit. */
function buildDosageComplaintBlock(
  d: DosageAnalysis | null | undefined,
): string {
  const over = limitChecksOverLimit(d);
  if (!over.length) return "";

  const lines = over.map((lc, i) => {
    const ref = findAdditiveLimit(lc.name);
    const limit =
      lc.fssai_limit?.trim() ||
      (ref?.fssai_max_limit_mg_per_kg != null
        ? `${ref.fssai_max_limit_mg_per_kg} mg/kg`
        : "the maximum permitted under FSSAI standards");
    const declared =
      lc.declared_quantity_if_available?.trim() ||
      "not declared on the label";
    const regulation =
      ref?.fssai_regulation_reference ??
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — maximum-limit (Appendix A) provisions.";
    return [
      `${i + 1}. ${lc.name}`,
      `   FSSAI prescribed limit: ${limit}`,
      `   Quantity declared on the pack: ${declared}`,
      `   Regulation: ${regulation}`,
      lc.note?.trim() ? `   Analysis note: ${oneLine(lc.note)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "The following additive(s) are present at levels that EXCEED the FSSAI prescribed maximum limit:",
    "",
    lines.join("\n"),
  ].join("\n");
}

function regulationsViolated(status: SafetyStatus): string {
  if (status === "banned")
    return "Food Safety and Standards (Prohibition and Restrictions on Sales) Regulations, 2011; not a permitted additive under the Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011.";
  if (status === "harmful")
    return "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 (permitted-additive and maximum-limit provisions) and the Food Safety and Standards (Labelling and Display) Regulations, 2020.";
  return "Food Safety and Standards Act, 2006 and the regulations framed thereunder.";
}

const longDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

function fmtPurchaseDate(v: string): string {
  if (!v) return "__________ (please fill in)";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : longDate(d);
}

function buildComplianceComplaint(
  row: ScanRow,
  violations: Violation[],
  date: string,
  place: string,
): string {
  const manufacturer = pick(row.compliance_details?.manufacturer_info?.value);
  const list = violations.length
    ? violations
        .map(
          (v, i) =>
            `${i + 1}. ${v.label}${
              v.value ? ` (declared as: "${v.value}")` : ""
            } — ${v.detail}`,
        )
        .join("\n")
    : "1. (No specific violation was auto-detected — describe the issue you noticed on the pack.)";

  return [
    "To: The Controller of Legal Metrology / Consumer Grievance Cell",
    "",
    "Subject: Complaint regarding non-compliance with the Legal Metrology (Packaged Commodities) Rules, 2011",
    "",
    "Product details",
    `- Product name: ${pick(row.product_name)}`,
    `- Brand: ${pick(row.brand)}`,
    `- Manufacturer / packer / importer: ${manufacturer}`,
    `- Category: ${row.category ? titleCase(row.category) : "Not specified"}`,
    `- Date of purchase: ${fmtPurchaseDate(date)}`,
    `- Place of purchase: ${place.trim() || "__________ (please fill in)"}`,
    "",
    "I purchased the above pre-packaged commodity and found the following mandatory declaration(s) to be missing, incomplete, or not in the prescribed format:",
    "",
    list,
    "",
    "This product violates the Legal Metrology (Packaged Commodities) Rules, 2011 (in particular Rule 6 on mandatory declarations and Rule 7 on the manner of declaration).",
    "",
    "I request that the matter be investigated and appropriate action taken against the manufacturer/packer/importer and the seller under the Legal Metrology Act, 2009. I am attaching a photograph of the product and its label.",
    "",
    "Complainant details",
    "- Name: ____________________",
    "- Mobile: ____________________",
    "- Email: ____________________",
    "- Address: ____________________",
    "",
    `Date: ${longDate(new Date())}`,
  ].join("\n");
}

function buildIngredientComplaint(
  row: ScanRow,
  ingredients: IngredientAnalysis[],
  date: string,
  place: string,
): string {
  const fssai = row.compliance_details?.fssai_license?.value;
  const fssaiLine =
    fssai && fssai.trim() ? fssai.trim() : "Not declared / not legible on the pack";

  const dosageBlock = buildDosageComplaintBlock(row.dosage_analysis);

  const items = ingredients.length
    ? ingredients
        .map((ing, i) =>
          [
            `${i + 1}. ${ing.name} [${ing.safety_status.toUpperCase()}]`,
            `   Concern: ${oneLine(ing.reason) || "Flagged as unsafe on analysis."}`,
            ing.health_effects
              ? `   Health effects: ${oneLine(ing.health_effects)}`
              : null,
            ing.who_should_avoid
              ? `   Especially unsafe for: ${oneLine(ing.who_should_avoid)}`
              : null,
            ing.banned_in_countries?.length
              ? `   Banned / restricted in: ${ing.banned_in_countries.join(", ")}`
              : null,
            `   Regulation(s) violated: ${regulationsViolated(ing.safety_status)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n")
    : "1. (No harmful or banned ingredient was auto-detected — describe your concern.)";

  return [
    "To: Food Safety and Standards Authority of India (FSSAI) — Consumer Grievance Cell",
    "",
    "Subject: Complaint regarding unsafe / non-permitted ingredients in a packaged food product",
    "",
    "Product details",
    `- Product name: ${pick(row.product_name)}`,
    `- Brand: ${pick(row.brand)}`,
    `- FSSAI licence number on the pack: ${fssaiLine}`,
    `- Category: ${row.category ? titleCase(row.category) : "Not specified"}`,
    `- Date of purchase: ${fmtPurchaseDate(date)}`,
    `- Place of purchase: ${place.trim() || "__________ (please fill in)"}`,
    "",
    "On examining the product label, the following ingredient(s) raise serious food-safety concerns:",
    "",
    items,
    ...(dosageBlock ? ["", dosageBlock] : []),
    "",
    "This product contains ingredients that violate the Food Safety and Standards Act, 2006 and the regulations framed thereunder, including the Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 and, where applicable, the Food Safety and Standards (Prohibition and Restrictions on Sales) Regulations, 2011.",
    "",
    "I request that samples of this product be drawn and tested, and that action be taken against the manufacturer and the seller under the Act. I am attaching a photograph of the product and its ingredients list.",
    "",
    "Complainant details",
    "- Name: ____________________",
    "- Mobile: ____________________",
    "- Email: ____________________",
    "- Address: ____________________",
    "",
    `Date: ${longDate(new Date())}`,
  ].join("\n");
}

const localRef = () =>
  `HR-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

const COMPLIANCE_STEPS = [
  "Click ‘Copy Complaint Text’ above.",
  "Click ‘Open Portal’ — it will open in a new tab.",
  "Register / log in on the portal.",
  "Select ‘Legal Metrology’ as the complaint category.",
  "Paste the complaint text and attach the product photo.",
  "Submit.",
];
const INGREDIENT_STEPS = [
  "Click ‘Copy Complaint Text’ above.",
  "Click ‘Open FSSAI Portal’ — it will open in a new tab.",
  "Register with your mobile number (OTP verification).",
  "Select complaint type: ‘Packaged Food’.",
  "Paste the complaint text and upload the product photo.",
  "Submit — you’ll receive a ticket number via SMS.",
];

const CONSUMER_PORTAL = "https://consumerhelpline.gov.in";
const FSSAI_PORTAL = "https://foscos.fssai.gov.in/consumergrievance";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ComplaintPage({
  params,
}: {
  params: { productId: string };
}) {
  const { productId } = params;

  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "notfound" | "error"
  >("loading");
  const [row, setRow] = useState<ScanRow | null>(null);

  const [option, setOption] = useState<Option>("none");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePlace, setPurchasePlace] = useState("");
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);

  const toast = useToast();
  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filed, setFiled] = useState<{
    type: "compliance" | "ingredients";
    ref: string;
    savedToAccount: boolean;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) {
        setLoadState("notfound");
        return;
      }

      const { data, error } = await supabase
        .from("scanned_products")
        .select(
          "id, product_name, brand, category, image_url, compliance_status, compliance_details, ingredient_analysis, dosage_analysis, overall_score, scanned_at",
        )
        .eq("id", productId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!alive) return;
      if (error) {
        setLoadState("error");
        return;
      }
      if (!data) {
        setLoadState("notfound");
        return;
      }
      setRow(data as unknown as ScanRow);
      setLoadState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [productId]);

  const violations = useMemo(
    () => (row ? computeViolations(row.compliance_details) : []),
    [row],
  );
  const unsafe = useMemo(
    () =>
      row
        ? (row.ingredient_analysis ?? []).filter(
            (i) => i.safety_status === "harmful" || i.safety_status === "banned",
          )
        : [],
    [row],
  );
  const overLimit = useMemo(
    () => (row ? limitChecksOverLimit(row.dosage_analysis) : []),
    [row],
  );

  const generate = useCallback((): string => {
    if (!row || option === "none") return "";
    return option === "compliance"
      ? buildComplianceComplaint(row, violations, purchaseDate, purchasePlace)
      : buildIngredientComplaint(row, unsafe, purchaseDate, purchasePlace);
  }, [row, option, violations, unsafe, purchaseDate, purchasePlace]);

  useEffect(() => {
    if (option === "none" || !row || touched) return;
    setDraft(generate());
  }, [generate, option, row, touched]);

  const chooseOption = (next: Option) => {
    setOption((cur) => (cur === next ? "none" : next));
    setTouched(false);
    setFileError(null);
  };

  const regenerate = () => {
    setTouched(false);
    setDraft(generate());
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      textareaRef.current?.select();
      try {
        document.execCommand("copy");
      } catch {
        toast.error("Could not copy — select the text and copy manually");
        return;
      }
    }
    toast.success("Complaint text copied to clipboard");
  };

  const submit = async () => {
    if (!row || option === "none") return;
    const type = option; // narrows to "compliance" | "ingredients"
    setFiling(true);
    setFileError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const complaint_data = {
        complaint_text: draft,
        purchase_date: purchaseDate || null,
        purchase_place: purchasePlace.trim() || null,
        portal: type === "compliance" ? CONSUMER_PORTAL : FSSAI_PORTAL,
        product_name: row.product_name,
        brand: row.brand,
        violations: type === "compliance" ? violations : undefined,
        unsafe_ingredients:
          type === "ingredients"
            ? unsafe.map((i) => ({
                name: i.name,
                status: i.safety_status,
                reason: i.reason,
              }))
            : undefined,
        additives_exceeding_limit:
          type === "ingredients" && overLimit.length
            ? overLimit.map((lc) => ({
                name: lc.name,
                fssai_limit:
                  lc.fssai_limit ??
                  findAdditiveLimit(lc.name)?.fssai_regulation_reference ??
                  null,
                declared_quantity: lc.declared_quantity_if_available,
                regulation:
                  findAdditiveLimit(lc.name)?.fssai_regulation_reference ?? null,
              }))
            : undefined,
        prepared_at: new Date().toISOString(),
      };

      if (!user) {
        setFiled({ type, ref: localRef(), savedToAccount: false });
        return;
      }

      const { data, error } = await supabase
        .from("complaints")
        .insert({
          user_id: user.id,
          product_id: row.id,
          complaint_type: type,
          status: "drafted",
          complaint_data,
        })
        .select("id")
        .single();

      if (error || !data) {
        setFileError(
          "Could not save the complaint to your account. You can still copy the text and file it on the portal.",
        );
        return;
      }
      setFiled({ type, ref: data.id as string, savedToAccount: true });
    } catch {
      setFileError(
        "Something went wrong. You can still copy the text and file it on the portal.",
      );
    } finally {
      setFiling(false);
    }
  };

  // ----- loading / error states -----
  if (loadState === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
        <PageHeader title="File a complaint" />
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading the scan…
        </div>
      </main>
    );
  }

  if (loadState !== "ready" || !row) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
        <PageHeader title="File a complaint" />
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-5 text-sm">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            {loadState === "notfound"
              ? "We couldn't find that scan."
              : "Something went wrong loading that scan."}
          </p>
          <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
            It may belong to a different account, or you may need to sign in on
            this device.
          </p>
          <Link
            href="/scan"
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white"
          >
            Scan a product
          </Link>
        </div>
      </main>
    );
  }

  // ----- success screen -----
  if (filed) {
    const portal = filed.type === "compliance" ? CONSUMER_PORTAL : FSSAI_PORTAL;
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
        <PageHeader title="File a complaint" backHref={`/history/${productId}`} backLabel="Scan results" />
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 p-6 text-center dark:border-white/10">
          <CheckCircle2 className="h-12 w-12 text-green-500" aria-hidden />
          <h2 className="text-lg font-bold">Complaint prepared successfully!</h2>
          <div className="rounded-xl bg-teal-600/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
              Your HealthRepo reference
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold">
              #{filed.ref.slice(0, 8).toUpperCase()}
            </p>
            <p className="mt-1 break-all text-[11px] text-zinc-500">{filed.ref}</p>
          </div>
          {!filed.savedToAccount && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Not signed in — this reference is for your records only and was not
              saved to an account.
            </p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Once you submit on the portal you&rsquo;ll get a ticket / docket
            number. Use that number to track your complaint on the portal.
          </p>
          <a
            href={portal}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Open the portal again
          </a>
          <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
            <Link
              href={`/history/${productId}`}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Back to scan results
            </Link>
            <button
              type="button"
              onClick={() => {
                setFiled(null);
                setOption("none");
                setTouched(false);
              }}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-white/15"
            >
              Prepare another complaint
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ----- main -----
  const steps = option === "compliance" ? COMPLIANCE_STEPS : INGREDIENT_STEPS;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
      <PageHeader
        title="File a complaint"
        backHref={`/history/${productId}`}
        backLabel="Scan results"
      />

      {/* Product summary */}
      <section className="flex gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
        {row.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.image_url}
            alt=""
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-lg border border-zinc-200 object-cover dark:border-white/10"
          />
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{row.product_name}</h2>
          {row.brand && <p className="truncate text-xs text-zinc-500">{row.brand}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {violations.length} compliance{" "}
              {violations.length === 1 ? "issue" : "issues"}
            </span>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {unsafe.length} unsafe {unsafe.length === 1 ? "ingredient" : "ingredients"}
            </span>
            {typeof row.overall_score === "number" && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                Safety {row.overall_score}/100
              </span>
            )}
          </div>
        </div>
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Choose what you want to report. HealthRepo drafts the complaint text for
        you — review it, copy it, and file it on the official portal.
      </p>

      {/* Option cards */}
      <div className="flex flex-col gap-3">
        <OptionCard
          active={option === "compliance"}
          onClick={() => chooseOption("compliance")}
          icon={<ClipboardList className="h-5 w-5" aria-hidden />}
          title="Report Compliance Violation"
          subtitle="Missing labels, wrong MRP format, incomplete declarations"
        />
        <OptionCard
          active={option === "ingredients"}
          onClick={() => chooseOption("ingredients")}
          icon={<FlaskConical className="h-5 w-5" aria-hidden />}
          title="Report Unsafe Ingredients"
          subtitle="Harmful, banned, or mislabeled ingredients"
        />
      </div>

      {/* Selected panel */}
      {option !== "none" && (
        <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
          {/* purchase details */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Date of purchase
              <input
                type="date"
                value={purchaseDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground dark:border-white/15"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Place of purchase
              <input
                type="text"
                value={purchasePlace}
                onChange={(e) => setPurchasePlace(e.target.value)}
                placeholder="Shop name, area, city"
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 dark:border-white/15"
              />
            </label>
          </div>

          {/* what we found */}
          <div className="rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {option === "compliance"
                ? "Compliance issues included"
                : "Ingredients included"}
            </p>
            {option === "compliance" ? (
              violations.length ? (
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-700 dark:text-zinc-300">
                  {violations.map((v) => (
                    <li key={v.key}>
                      <span className="font-medium">{v.label}</span> — {v.detail}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  No specific violations were auto-detected — edit the text to
                  describe what you noticed.
                </p>
              )
            ) : unsafe.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-700 dark:text-zinc-300">
                {unsafe.map((ing, i) => (
                  <li key={`${ing.name}-${i}`}>
                    <span className="font-medium">{ing.name}</span>{" "}
                    <span
                      className={
                        ing.safety_status === "banned"
                          ? "text-red-700 dark:text-red-300"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      [{ing.safety_status}]
                    </span>{" "}
                    — {oneLine(ing.reason)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">
                No harmful or banned ingredient was auto-detected — edit the text
                to describe your concern.
              </p>
            )}

            {option === "ingredients" && overLimit.length > 0 && (
              <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-white/10">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                  Additive(s) over the FSSAI limit
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-zinc-700 dark:text-zinc-300">
                  {overLimit.map((lc, i) => (
                    <li key={`${lc.name}-${i}`}>
                      <span className="font-medium">{lc.name}</span>
                      {lc.fssai_limit ? ` — limit ${lc.fssai_limit}` : ""}
                      {lc.declared_quantity_if_available
                        ? `, declared ${lc.declared_quantity_if_available}`
                        : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Included in the complaint text with the relevant FSSAI
                  regulation reference.
                </p>
              </div>
            )}
          </div>

          <p className="text-xs font-medium">
            {option === "compliance"
              ? "This product violates the Legal Metrology (Packaged Commodities) Rules, 2011."
              : "This product contains ingredients that violate the FSSAI Food Safety and Standards Act, 2006."}
          </p>

          {/* editable complaint text */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Complaint text (editable)
              </span>
              {touched && (
                <button
                  type="button"
                  onClick={regenerate}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Reset to auto-generated
                </button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setTouched(true);
              }}
              rows={16}
              className="w-full resize-y rounded-xl border border-zinc-200 bg-transparent p-3 font-mono text-[11px] leading-relaxed dark:border-white/10"
            />
          </div>

          {/* actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyText}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Copy className="h-4 w-4" aria-hidden />
              Copy Complaint Text
            </button>
            <a
              href={option === "compliance" ? CONSUMER_PORTAL : FSSAI_PORTAL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold dark:border-white/15"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {option === "compliance"
                ? "Open Consumer Helpline Portal"
                : "Open FSSAI Food Safety Connect"}
            </a>
          </div>

          {option === "ingredients" && (
            <p className="inline-flex items-center gap-2 rounded-lg bg-teal-600/10 px-3 py-2 text-xs font-medium text-teal-800 dark:text-teal-200">
              <Phone className="h-4 w-4 shrink-0" aria-hidden />
              FSSAI Toll-Free Helpline: 1800-11-4420
            </p>
          )}

          {/* step-by-step guide */}
          <div className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              How to file it
            </p>
            <ol className="mt-2 flex flex-col gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          {/* save */}
          {fileError && (
            <p className="flex items-start gap-2 rounded-lg bg-red-500/[0.08] px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {fileError}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={filing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {filing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
            Save complaint &amp; get reference number
          </button>
        </section>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Option card
// ---------------------------------------------------------------------------

function OptionCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        active
          ? "border-teal-500 bg-teal-50/60 ring-1 ring-teal-500/40 dark:bg-teal-500/[0.08]"
          : "border-zinc-200 hover:border-teal-300 hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/[0.03]"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          active
            ? "bg-teal-600 text-white"
            : "bg-teal-600/10 text-teal-700 dark:text-teal-400"
        }`}
      >
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
          {subtitle}
        </span>
      </span>
      <ChevronRight
        className={`h-5 w-5 shrink-0 transition-transform ${
          active ? "rotate-90 text-teal-600" : "text-zinc-400"
        }`}
        aria-hidden
      />
    </button>
  );
}
