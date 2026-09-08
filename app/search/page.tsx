"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  X,
  ScanLine,
  RefreshCw,
  Star,
  ChevronLeft,
  ArrowLeft,
} from "lucide-react";
import { ResultRowSkeleton } from "@/components/Skeleton";
import { supabase } from "@/lib/supabase";
import { PRODUCT_CATEGORIES } from "@/lib/reference-data";
import type { IngredientAnalysis } from "@/types/analysis";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface SearchRow {
  id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  compliance_status: "compliant" | "non_compliant" | "partial" | null;
  ingredient_analysis: IngredientAnalysis[] | null;
  overall_score: number | null;
  scanned_at: string;
}

type Flag = "safe" | "concerning" | "harmful";
type SortKey = "safest" | "recent" | "scanned";

interface ProductGroup {
  key: string;
  representativeId: string;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  timesScanned: number;
  bestScore: number | null;
  latestAt: string;
  flag: Flag;
}

const COLS =
  "id, product_name, brand, category, image_url, compliance_status, ingredient_analysis, overall_score, scanned_at";

const CATEGORY_MAP = new Map(PRODUCT_CATEGORIES.map((c) => [c.id, c] as const));

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function sanitize(term: string): string {
  return term
    .replace(/[,()%\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreBadge(score: number | null): { bg: string; value: string } {
  if (score == null) return { bg: "bg-zinc-400", value: "?" };
  const s = clamp(score);
  if (s >= 80) return { bg: "bg-green-500", value: String(s) };
  if (s >= 50) return { bg: "bg-amber-500", value: String(s) };
  return { bg: "bg-red-600", value: String(s) };
}

const STATUS: Record<Flag, { label: string; cls: string }> = {
  safe: {
    label: "✅ Safe to consume",
    cls: "text-green-700 dark:text-green-400",
  },
  concerning: {
    label: "⚠️ Contains concerning ingredients",
    cls: "text-amber-700 dark:text-amber-400",
  },
  harmful: {
    label: "🚫 Contains harmful/banned ingredients",
    cls: "text-red-700 dark:text-red-400",
  },
};

function groupRows(rows: SearchRow[]): ProductGroup[] {
  const buckets: Record<string, SearchRow[]> = {};
  for (const r of rows) {
    const key = `${(r.product_name ?? "").trim().toLowerCase()}|${(r.brand ?? "")
      .trim()
      .toLowerCase()}`;
    (buckets[key] ??= []).push(r);
  }

  const groups: ProductGroup[] = [];
  for (const [key, bucket] of Object.entries(buckets)) {
    let harmful = false;
    let caution = false;
    let bestScore: number | null = null;
    let latestAt = bucket[0].scanned_at;
    let rep = bucket[0];

    for (const r of bucket) {
      for (const ing of r.ingredient_analysis ?? []) {
        if (ing.safety_status === "harmful" || ing.safety_status === "banned")
          harmful = true;
        else if (ing.safety_status === "caution") caution = true;
      }
      if (r.overall_score != null) {
        if (bestScore == null || r.overall_score > bestScore) {
          bestScore = r.overall_score;
          rep = r;
        }
      }
      if (new Date(r.scanned_at) > new Date(latestAt)) latestAt = r.scanned_at;
    }

    groups.push({
      key,
      representativeId: rep.id,
      name: rep.product_name,
      brand: rep.brand,
      category: rep.category,
      imageUrl: bucket.find((r) => r.image_url)?.image_url ?? null,
      timesScanned: bucket.length,
      bestScore,
      latestAt,
      flag: harmful ? "harmful" : caution ? "concerning" : "safe",
    });
  }
  return groups;
}

function sortGroups(groups: ProductGroup[], sort: SortKey): ProductGroup[] {
  const g = [...groups];
  if (sort === "safest")
    g.sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1));
  else if (sort === "recent")
    g.sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));
  else
    g.sort(
      (a, b) =>
        b.timesScanned - a.timesScanned ||
        (b.bestScore ?? -1) - (a.bestScore ?? -1),
    );
  return g;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("safest");

  const [rows, setRows] = useState<SearchRow[]>([]);
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeNote, setScopeNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const term = sanitize(debounced);
  const mode: "search" | "category" | "browse" = term
    ? "search"
    : activeCategory
      ? "category"
      : "browse";

  // debounce (500ms); Enter commits immediately
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 500);
    return () => window.clearTimeout(t);
  }, [query]);

  // category counts (once)
  useEffect(() => {
    let alive = true;
    (async () => {
      let res = await supabase.from("product_search").select("category");
      if (res.error)
        res = await supabase.from("scanned_products").select("category");
      if (!alive || res.error) return;
      const counts: Record<string, number> = {};
      for (const r of (res.data ?? []) as { category: string | null }[]) {
        if (r.category) counts[r.category] = (counts[r.category] ?? 0) + 1;
      }
      setCatCounts(counts);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // fetch results for search / category modes
  useEffect(() => {
    if (mode === "browse") {
      setRows([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);

    const build = (from: "product_search" | "scanned_products") => {
      let q = supabase
        .from(from)
        .select(COLS)
        .order("scanned_at", { ascending: false })
        .limit(500);
      if (mode === "search") {
        q = q.or(
          `product_name.ilike.%${term}%,brand.ilike.%${term}%,category.ilike.%${term}%`,
        );
      } else if (activeCategory) {
        q = q.eq("category", activeCategory);
      }
      return q;
    };

    (async () => {
      let res = await build("product_search");
      let scoped = false;
      if (res.error) {
        res = await build("scanned_products");
        scoped = true;
      }
      if (!alive) return;
      if (res.error) {
        setError("Search is unavailable right now. Please try again.");
        setRows([]);
      } else {
        setRows((res.data ?? []) as unknown as SearchRow[]);
        setScopeNote(
          scoped
            ? "Showing only your own scans — apply the product_search migration for community-wide search."
            : null,
        );
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [mode, term, activeCategory, reloadKey]);

  const groups = useMemo(() => groupRows(rows), [rows]);
  const sorted = useMemo(() => sortGroups(groups, sort), [groups, sort]);

  const safest = useMemo(
    () =>
      groups
        .filter((g) => g.flag === "safe" && g.bestScore != null)
        .sort((a, b) => (b.bestScore ?? 0) - (a.bestScore ?? 0))
        .slice(0, 5),
    [groups],
  );

  const selectCategory = (id: string) => {
    setQuery("");
    setDebounced("");
    setActiveCategory(id);
  };

  const activeCatName = activeCategory
    ? (CATEGORY_MAP.get(activeCategory)?.name ?? titleCase(activeCategory))
    : "";

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
            <Search className="h-6 w-6 text-teal-600" aria-hidden />
            Search
          </h1>
        </header>

        {/* Search bar */}
        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setDebounced(query);
            }}
            placeholder="Search for a product or ingredient..."
            className="w-full rounded-2xl border border-zinc-300 bg-transparent py-3 pl-11 pr-10 text-sm text-foreground placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-white/15"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setDebounced("");
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {scopeNote && mode !== "browse" && (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {scopeNote}
          </p>
        )}

        {/* ---------- BROWSE ---------- */}
        {mode === "browse" && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold">Browse by Category</h2>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {PRODUCT_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCategory(c.id)}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-zinc-200 p-3 text-center transition-colors hover:border-teal-300 hover:bg-teal-50/50 dark:border-white/10 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/[0.06]"
                >
                  <span className="text-2xl" aria-hidden>
                    {c.icon_emoji}
                  </span>
                  <span className="text-xs font-medium leading-tight">
                    {c.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {catCounts[c.id] ?? 0} scanned
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ---------- CATEGORY / SEARCH ---------- */}
        {mode !== "browse" && (
          <section className="mt-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              {mode === "category" ? (
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 dark:text-teal-300"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  All categories
                </button>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Results for{" "}
                  <span className="font-semibold text-foreground">
                    &ldquo;{term}&rdquo;
                  </span>
                </p>
              )}
              <SortTabs value={sort} onChange={setSort} />
            </div>

            {mode === "category" && (
              <h2 className="text-lg font-semibold">
                {CATEGORY_MAP.get(activeCategory ?? "")?.icon_emoji}{" "}
                {activeCatName}
              </h2>
            )}

            {loading && (
              <ul className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <ResultRowSkeleton key={i} />
                ))}
              </ul>
            )}

            {error && !loading && (
              <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-700 dark:text-red-300">
                <p>{error}</p>
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

            {!loading && !error && sorted.length === 0 && (
              <NoResults term={mode === "search" ? term : activeCatName} />
            )}

            {/* Safest highlight (category mode only) */}
            {!loading && mode === "category" && safest.length > 0 && (
              <div className="rounded-2xl border border-green-500/30 bg-green-500/[0.05] p-4">
                <h3 className="text-sm font-semibold text-green-700 dark:text-green-300">
                  🌟 Safest in {activeCatName}
                </h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {safest.map((g) => (
                    <ResultCard key={g.key} group={g} highlightSafe />
                  ))}
                </ul>
              </div>
            )}

            {!loading && sorted.length > 0 && (
              <ul className="flex flex-col gap-2">
                {sorted.map((g) => (
                  <ResultCard key={g.key} group={g} />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SortTabs({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
}) {
  const opts: [SortKey, string][] = [
    ["safest", "Safest"],
    ["recent", "Recent"],
    ["scanned", "Most Scanned"],
  ];
  return (
    <div className="flex shrink-0 rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-white/10">
      {opts.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded-md px-2 py-1 font-medium transition-colors ${
            value === k
              ? "bg-teal-600 text-white"
              : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ResultCard({
  group,
  highlightSafe = false,
}: {
  group: ProductGroup;
  highlightSafe?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const badge = scoreBadge(group.bestScore);
  const status = STATUS[group.flag];
  const cat = group.category ? CATEGORY_MAP.get(group.category) : undefined;
  const catLabel = cat
    ? `${cat.icon_emoji} ${cat.name}`
    : group.category
      ? titleCase(group.category)
      : "Uncategorised";

  return (
    <li>
      <Link
        href={`/history/${group.representativeId}`}
        className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors hover:border-teal-300 dark:hover:border-teal-500/40 ${
          highlightSafe
            ? "border-green-500/40 bg-white dark:border-green-500/30 dark:bg-transparent"
            : "border-zinc-200 dark:border-white/10"
        }`}
      >
        {group.imageUrl && !imageFailed ? (
          <span className="relative h-11 w-11 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={group.imageUrl}
              alt={group.name}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="h-11 w-11 rounded-lg object-cover"
            />
            <span
              className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900 ${badge.bg}`}
            >
              {badge.value}
            </span>
          </span>
        ) : (
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${badge.bg}`}
          >
            {badge.value}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          {group.brand && (
            <p className="truncate text-xs text-zinc-500">{group.brand}</p>
          )}
          <p className={`mt-0.5 truncate text-xs font-medium ${status.cls}`}>
            {status.label}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              {catLabel}
            </span>
            <span className="text-[10px] text-zinc-400">
              Scanned {group.timesScanned}
              {group.timesScanned === 1 ? " time" : " times"}
            </span>
            {highlightSafe && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300">
                <Star className="h-3 w-3" aria-hidden />
                Free from harmful ingredients
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function NoResults({ term }: { term: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 p-8 text-center dark:border-white/10">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-600/10 text-teal-600 dark:text-teal-400">
        <Search className="h-8 w-8" aria-hidden />
      </span>
      <p className="text-sm font-semibold">
        No products found{term ? ` for “${term}”` : ""}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Be the first to scan this product!
      </p>
      <Link
        href="/scan"
        className="mt-1 inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-teal-600/30"
      >
        <ScanLine className="h-4 w-4" aria-hidden />
        Scan Now
      </Link>
    </div>
  );
}
