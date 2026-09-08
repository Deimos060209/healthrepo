"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  History,
  Package,
  ScanLine,
  AlertTriangle,
  Skull,
  RefreshCw,
  LogIn,
  ArrowLeft,
} from "lucide-react";
import { ProductCardSkeleton } from "@/components/Skeleton";
import { supabase } from "@/lib/supabase";
import { PRODUCT_CATEGORIES } from "@/lib/reference-data";
import type { ComplianceItem, IngredientAnalysis } from "@/types/analysis";

interface ScanRow {
  id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  compliance_status: "compliant" | "non_compliant" | "partial" | null;
  compliance_details: Record<string, ComplianceItem> | null;
  ingredient_analysis: IngredientAnalysis[] | null;
  overall_score: number | null;
  scanned_at: string;
}

type LoadState = "loading" | "ready" | "anon" | "error";

const CATEGORY_MAP = new Map(
  PRODUCT_CATEGORIES.map((c) => [c.id, c] as const),
);

const isNotApplicable = (i: ComplianceItem) =>
  !i.present && i.compliant && /not applicable/i.test(i.issue ?? "");

function complianceState(
  row: ScanRow,
): "passed" | "failed" | "partial" | "unknown" {
  if (row.compliance_status === "compliant") return "passed";
  if (row.compliance_status === "non_compliant") return "failed";
  if (row.compliance_status === "partial") return "partial";
  const items = Object.values(row.compliance_details ?? {}).filter(
    (v) => !isNotApplicable(v),
  );
  if (!items.length) return "unknown";
  const pass = items.filter((v) => v.present && v.compliant).length;
  if (pass === items.length) return "passed";
  if (pass === 0) return "failed";
  return "partial";
}

function scoreBadge(score: number | null): { bg: string; value: string } {
  if (score == null) return { bg: "bg-zinc-400", value: "?" };
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 80) return { bg: "bg-green-500", value: String(s) };
  if (s >= 50) return { bg: "bg-amber-500", value: String(s) };
  return { bg: "bg-red-600", value: String(s) };
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} week${w === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function HistoryPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (!user) {
        setState("anon");
        return;
      }
      const { data, error } = await supabase
        .from("scanned_products")
        .select(
          "id, product_name, brand, category, image_url, compliance_status, compliance_details, ingredient_analysis, overall_score, scanned_at",
        )
        .eq("user_id", user.id)
        .order("scanned_at", { ascending: false });
      if (!alive) return;
      if (error) {
        setState("error");
        return;
      }
      setRows((data ?? []) as unknown as ScanRow[]);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const visible = useMemo(
    () =>
      category === "all"
        ? rows
        : rows.filter((r) => r.category === category),
    [rows, category],
  );

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 md:pb-12">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-foreground dark:text-zinc-400"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Home
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <History className="h-6 w-6 text-teal-600" aria-hidden />
            Scan History
          </h1>
        </header>

        {state === "loading" && (
          <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </ul>
        )}

        {state === "error" && (
          <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5 text-sm text-red-700 dark:text-red-300">
            <p>Could not load your scan history.</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try again
            </button>
          </div>
        )}

        {state === "anon" && (
          <EmptyState
            icon={<LogIn className="h-10 w-10" aria-hidden />}
            title="Sign in to see your history"
            body="Your scanned products are saved to your account so you can review them later."
          />
        )}

        {state === "ready" && rows.length === 0 && (
          <EmptyState
            icon={<Package className="h-10 w-10" aria-hidden />}
            title="No products scanned yet"
            body="Start by scanning your first product!"
          />
        )}

        {state === "ready" && rows.length > 0 && (
          <>
            {/* Category filter tabs */}
            <div className="mt-4 -mx-4 overflow-x-auto px-4">
              <div className="flex w-max gap-2 pb-1">
                <FilterTab
                  label="All"
                  active={category === "all"}
                  onClick={() => setCategory("all")}
                />
                {PRODUCT_CATEGORIES.map((c) => (
                  <FilterTab
                    key={c.id}
                    label={`${c.icon_emoji} ${c.name}`}
                    active={category === c.id}
                    onClick={() => setCategory(c.id)}
                  />
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="mt-8 text-center text-sm text-zinc-500">
                No scans in this category yet.
              </p>
            ) : (
              <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
                {visible.map((row) => (
                  <ProductCard key={row.id} row={row} />
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-teal-600 bg-teal-600 text-white"
          : "border-zinc-200 text-zinc-600 hover:border-teal-300 dark:border-white/10 dark:text-zinc-400"
      }`}
    >
      {label}
    </button>
  );
}

function ProductCard({ row }: { row: ScanRow }) {
  const [imageFailed, setImageFailed] = useState(false);
  const badge = scoreBadge(row.overall_score);
  const cat = row.category ? CATEGORY_MAP.get(row.category) : undefined;
  const catLabel = cat
    ? `${cat.icon_emoji} ${cat.name}`
    : row.category
      ? titleCase(row.category)
      : "Uncategorised";

  const ingredients = row.ingredient_analysis ?? [];
  const bannedCount = ingredients.filter(
    (i) => i.safety_status === "banned",
  ).length;
  const compliance = complianceState(row);
  const flaggedCompliance = compliance === "failed" || compliance === "partial";

  return (
    <li>
      <Link
        href={`/history/${row.id}`}
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 transition-colors hover:border-teal-300 dark:border-white/10 dark:hover:border-teal-500/40"
      >
        <div className="relative aspect-square bg-zinc-100 dark:bg-white/[0.04]">
          {row.image_url && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.image_url}
              alt={row.product_name}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-300 dark:text-white/15">
              <Package className="h-10 w-10" aria-hidden />
            </div>
          )}
          <span
            className={`absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white dark:ring-zinc-900 ${badge.bg}`}
          >
            {badge.value}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">
            {row.product_name}
          </p>
          {row.brand && (
            <p className="line-clamp-1 text-xs text-zinc-500">{row.brand}</p>
          )}
          <span className="mt-1 w-fit rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
            {catLabel}
          </span>
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="text-[11px] text-zinc-400">
              {relativeTime(row.scanned_at)}
            </span>
            <span className="flex items-center gap-1.5">
              {flaggedCompliance && (
                <AlertTriangle
                  className="h-3.5 w-3.5 text-amber-500"
                  aria-label="Compliance issues"
                />
              )}
              {bannedCount > 0 && (
                <Skull
                  className="h-3.5 w-3.5 text-red-600"
                  aria-label="Banned ingredients"
                />
              )}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-600/10 text-teal-600 dark:text-teal-400">
        {icon}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
      <Link
        href="/scan"
        className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-teal-600/30"
      >
        <ScanLine className="h-4 w-4" aria-hidden />
        Scan Now
      </Link>
    </div>
  );
}
