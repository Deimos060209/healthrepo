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
  ShieldCheck,
  FlaskConical,
  RotateCcw,
  FileText,
  Microscope,
} from "lucide-react";
import { ResultRowSkeleton } from "@/components/Skeleton";
import { supabase } from "@/lib/supabase";
import { PRODUCT_CATEGORIES } from "@/lib/reference-data";
import {
  BROAD_CATEGORY_FILTERS,
  SEARCH_SUBCATEGORIES,
  categoryScoreThreshold,
} from "@/lib/product-category";
import type { IngredientAnalysis } from "@/types/analysis";
import {
  fetchHealthProfile,
  isHealthProfileEmpty,
  type HealthProfile,
} from "@/lib/health-profile";
import {
  dedupeSafeProducts,
  profileConcerns,
  summarizeIngredients,
  SCORE_FILTER_OPTIONS,
  type SafeProduct,
  type SafeProductRow,
  type ScoreFilterKey,
} from "@/lib/safe-products";

// ---------------------------------------------------------------------------
// Shared types & helpers
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

/**
 * FIX 6 — "My scans" has no detected_category id on the row (only the free-text
 * subcategory saved with the scan), so this is a best-effort keyword match
 * rather than the strict verdictLabel() the results screen uses. It still
 * ensures a shampoo never reads "Safe to consume".
 */
function statusFor(flag: Flag, category: string | null): { label: string; cls: string } {
  const cat = (category ?? "").toLowerCase();
  const isCare = /personal.?care|cosmetic|shampoo|soap|skin|hair|deodorant/.test(cat);
  const isHousehold = /household|clean|detergent/.test(cat);
  if (flag === "concerning") {
    return { label: "⚠️ Contains concerning ingredients", cls: "text-amber-700 dark:text-amber-400" };
  }
  if (flag === "harmful") {
    return { label: "🚫 Contains harmful/banned ingredients", cls: "text-red-700 dark:text-red-400" };
  }
  // flag === "safe"
  if (isCare) return { label: "✅ Safe to use", cls: "text-green-700 dark:text-green-400" };
  if (isHousehold) return { label: "✅ Safe to use as directed", cls: "text-green-700 dark:text-green-400" };
  return { label: "✅ Safe to consume", cls: "text-green-700 dark:text-green-400" };
}

const catLabelFor = (category: string | null): string => {
  if (!category) return "Uncategorised";
  const cat = CATEGORY_MAP.get(category);
  return cat ? `${cat.icon_emoji} ${cat.name}` : titleCase(category);
};

// ---------------------------------------------------------------------------
// Page shell — two tabs
// ---------------------------------------------------------------------------

type Tab = "safe" | "mine";

export default function SearchPage() {
  const [tab, setTab] = useState<Tab>("safe");

  return (
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

      <div
        role="tablist"
        aria-label="Search mode"
        className="mt-4 flex rounded-xl border border-zinc-200 p-1 text-sm dark:border-white/10"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "safe"}
          onClick={() => setTab("safe")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-colors ${
            tab === "safe"
              ? "bg-teal-600 text-white"
              : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Find safe products
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mine"}
          onClick={() => setTab("mine")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-colors ${
            tab === "mine"
              ? "bg-teal-600 text-white"
              : "text-zinc-600 dark:text-zinc-400"
          }`}
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          My scans
        </button>
      </div>

      {tab === "safe" ? <SafeProductsTab /> : <MyScansTab />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// TAB 1 — Find safe products (built from verified scan data)
// ---------------------------------------------------------------------------

function SafeProductsTab() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  // Broad regulatory bucket: "" | "food_and_beverages" | "personal_care" | "household_cleaning" | "baby"
  const [broadCat, setBroadCat] = useState("");
  const [scoreKey, setScoreKey] = useState<ScoreFilterKey>("75");

  const [rows, setRows] = useState<SafeProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [profile, setProfile] = useState<HealthProfile | null>(null);

  // Category-specific "safe" threshold: food 75+, personal care 70+, baby 85+.
  // The "All safe" score chip maps to that threshold; the stricter chips are
  // always honoured as-is.
  const catThreshold = useMemo(
    () =>
      broadCat
        ? categoryScoreThreshold(
            broadCat === "baby" ? "baby_product_food" : broadCat,
          )
        : 75,
    [broadCat],
  );
  const minScore = useMemo(() => {
    const base = SCORE_FILTER_OPTIONS.find((o) => o.key === scoreKey)?.min ?? 75;
    return scoreKey === "75" ? catThreshold : base;
  }, [scoreKey, catThreshold]);
  const term = sanitize(debounced);

  useEffect(() => {
    let alive = true;
    fetchHealthProfile().then((p) => {
      if (alive) setProfile(isHealthProfileEmpty(p) ? null : p);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 500);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setUnavailable(false);

    (async () => {
      const params: Record<string, unknown> = {
        search_query: term,
        category_filter: category,
        min_score: minScore,
      };
      // Only pass the broad-category arg when it's in use — keeps the call
      // working against the pre-category deployment of search_safe_products.
      if (broadCat) params.detected_category_filter = broadCat;

      const { data, error } = await supabase.rpc("search_safe_products", params);
      if (!alive) return;
      if (error) {
        setUnavailable(true);
        setRows([]);
      } else {
        setRows((data ?? []) as SafeProductRow[]);
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [term, category, minScore, broadCat, reloadKey]);

  const products = useMemo(() => {
    const all = dedupeSafeProducts(rows);
    if (!broadCat) return all;
    const bucket = BROAD_CATEGORY_FILTERS.find((b) => b.key === broadCat);
    if (!bucket) return all;
    // Belt-and-braces client filter (older rows have no detected_category).
    return all.filter((p) => bucket.match.includes(p.categoryId));
  }, [rows, broadCat]);
  const safestInCategory = useMemo(
    () => (category ? products.slice(0, 5) : []),
    [products, category],
  );
  const broadCatLabel = broadCat
    ? (BROAD_CATEGORY_FILTERS.find((b) => b.key === broadCat)?.label ?? "")
    : "";
  const activeCatName = category
    ? (CATEGORY_MAP.get(category)?.name ?? titleCase(category))
    : broadCatLabel;

  return (
    <section className="mt-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">
          Products verified safe by HealthRepo scans
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Every product here was scanned and verified by real users.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
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
          placeholder="Search verified safe products..."
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

      {/* Broad regulatory category — food / personal care / household / baby */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <FilterChip
          active={broadCat === ""}
          onClick={() => {
            setBroadCat("");
            setCategory("");
          }}
        >
          All types
        </FilterChip>
        {BROAD_CATEGORY_FILTERS.map((b) => (
          <FilterChip
            key={b.key}
            active={broadCat === b.key}
            onClick={() => {
              // FIX 5 — the subcategory is meaningless once its parent type
              // changes, so it always resets alongside broadCat.
              setBroadCat(broadCat === b.key ? "" : b.key);
              setCategory("");
            }}
          >
            <span aria-hidden>{b.emoji}</span> {b.label}
          </FilterChip>
        ))}
      </div>

      {/* FIX 5 — subcategory chips ONLY once a specific type is chosen, scoped
          to that type's own subcategories. Hidden entirely at "All types",
          where a subcategory list is meaningless. */}
      {broadCat && SEARCH_SUBCATEGORIES[broadCat] && (
        <div className="-mx-1 flex animate-[fadeIn_0.15s_ease-out] gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip active={category === ""} onClick={() => setCategory("")}>
            All
          </FilterChip>
          {SEARCH_SUBCATEGORIES[broadCat].map((c) => (
            <FilterChip
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(category === c.id ? "" : c.id)}
            >
              {c.label}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Score filter */}
      <div className="flex flex-wrap gap-1.5">
        {SCORE_FILTER_OPTIONS.map((o) => (
          <FilterChip
            key={o.key}
            active={scoreKey === o.key}
            onClick={() => setScoreKey(o.key)}
          >
            {o.label}
          </FilterChip>
        ))}
      </div>

      {/* Accuracy messaging */}
      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/[0.06] p-3 text-xs text-teal-800 dark:text-teal-200">
        <ul className="flex flex-col gap-1">
          <li>
            These recommendations are based on <strong>actual scanned
            products</strong>, not estimates.
          </li>
          <li>
            Safety scores are calculated by analysing real ingredient lists
            against FSSAI regulations.
          </li>
          <li>
            The more products the community scans, the better our
            recommendations get.
          </li>
          {broadCat && (
            <li>
              {broadCatLabel} products are recommended at{" "}
              <strong>{catThreshold}+</strong>
              {broadCat === "personal_care"
                ? " (a lower bar — most personal-care products carry some processing)"
                : broadCat === "baby"
                  ? " (a stricter bar — baby products get zero tolerance)"
                  : ""}
              .
            </li>
          )}
        </ul>
      </div>

      {profile && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Cards below are also checked against your{" "}
          <Link
            href="/profile/health"
            className="font-medium underline underline-offset-2"
          >
            health profile
          </Link>
          .
        </p>
      )}

      {unavailable && !loading && (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-700 dark:text-red-300">
          <p>
            Safe-product search is unavailable right now. The{" "}
            <code>search_safe_products</code> database function may not be
            deployed yet.
          </p>
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

      {loading && (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ResultRowSkeleton key={i} />
          ))}
        </ul>
      )}

      {!loading && !unavailable && products.length === 0 && (
        <SafeEmptyState category={activeCatName} />
      )}

      {!loading && category && safestInCategory.length > 0 && (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/[0.05] p-4">
          <h3 className="text-sm font-semibold text-green-700 dark:text-green-300">
            🌟 Safest in {activeCatName}
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {safestInCategory.map((p) => (
              <SafeProductCard key={p.id} product={p} profile={profile} compact />
            ))}
          </ul>
        </div>
      )}

      {!loading && products.length > 0 && (
        <ul className="flex flex-col gap-3">
          {products.map((p) => (
            <SafeProductCard key={p.id} product={p} profile={profile} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-teal-500 bg-teal-600 text-white"
          : "border-zinc-200 text-zinc-600 hover:border-teal-300 dark:border-white/10 dark:text-zinc-400"
      }`}
    >
      {children}
    </button>
  );
}

function SafeProductCard({
  product,
  profile,
  compact = false,
}: {
  product: SafeProduct;
  profile: HealthProfile | null;
  compact?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const badge = scoreBadge(product.score);
  const summary = useMemo(
    () => summarizeIngredients(product.ingredients),
    [product.ingredients],
  );
  const concerns = useMemo(
    () => profileConcerns(product.ingredients, profile),
    [product.ingredients, profile],
  );
  const hasCriticalConcern = concerns.some((c) => c.severity === "critical");

  return (
    <li
      className={`rounded-2xl border p-4 ${
        concerns.length > 0
          ? "border-amber-400/60 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/[0.06]"
          : "border-zinc-200 dark:border-white/10"
      }`}
    >
      <div className="flex items-start gap-3">
        {product.imageUrl && !imageFailed ? (
          <span className="relative h-14 w-14 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.imageUrl}
              alt={product.name}
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="h-14 w-14 rounded-lg object-cover"
            />
            <span
              className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white dark:ring-zinc-900 ${badge.bg}`}
            >
              {badge.value}
            </span>
          </span>
        ) : (
          <span
            className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-lg font-bold text-white ${badge.bg}`}
          >
            {badge.value}
            <span className="text-[8px] font-medium opacity-90">/100</span>
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{product.name}</p>
          {product.brand && (
            <p className="truncate text-xs text-zinc-500">{product.brand}</p>
          )}
          <p className="mt-0.5 text-xs font-medium text-green-700 dark:text-green-400">
            ✅ Fully compliant
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
              {catLabelFor(product.category)}
            </span>
            <span className="text-zinc-400">
              Verified by {product.timesScanned}{" "}
              {product.timesScanned === 1 ? "scan" : "scans"}
            </span>
          </div>
        </div>
      </div>

      {!compact && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <li>
            <span className="font-semibold text-green-700 dark:text-green-400">
              {summary.safe}
            </span>{" "}
            safe
            {summary.concerning > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {summary.concerning}
                </span>{" "}
                concerning
              </>
            )}
          </li>
          {summary.noBanned && <li>✅ No banned ingredients</li>}
          {summary.noHarmfulAdditives && <li>✅ No harmful additives</li>}
        </ul>
      )}

      {/* Health-profile verdict */}
      {profile && concerns.length === 0 && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300">
          ✅ Safe for your profile
        </p>
      )}
      {concerns.length > 0 && (
        <div className="mt-2 rounded-xl bg-amber-500/10 p-2.5">
          <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
            {hasCriticalConcern ? "🔴" : "⚠️"} Has concerns for your profile
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-800 dark:text-amber-200">
            {concerns.map((c, i) => (
              <li key={i}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/history/${product.id}`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          View full report
        </Link>
        <Link
          href={`/scan?verify=${encodeURIComponent(product.name)}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-white/15 dark:text-zinc-300"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Re-verify this product
        </Link>
      </div>
    </li>
  );
}

function SafeEmptyState({ category }: { category: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 p-8 text-center dark:border-white/10">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-600/10 text-teal-600 dark:text-teal-400">
        <Microscope className="h-8 w-8" aria-hidden />
      </span>
      <p className="text-sm font-semibold">
        🔬 No verified safe products yet
        {category ? ` in ${category}` : ""}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Be the first to scan and verify products!
      </p>
      <p className="text-xs text-zinc-500">
        Every product you scan helps build our safe products database for
        everyone.
      </p>
      <Link
        href="/scan"
        className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-teal-600/30"
      >
        <ScanLine className="h-4 w-4" aria-hidden />
        Scan a product now →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB 2 — My scans (the user's own scan history)
// ---------------------------------------------------------------------------

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

function MyScansTab() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("safest");

  const [rows, setRows] = useState<SearchRow[]>([]);
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const term = sanitize(debounced);
  const mode: "search" | "category" | "browse" = term
    ? "search"
    : activeCategory
      ? "category"
      : "browse";

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 500);
    return () => window.clearTimeout(t);
  }, [query]);

  // category counts (once) — own scans only
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await supabase.from("scanned_products").select("category");
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

  // fetch results for search / category modes — own scans only (RLS-scoped)
  useEffect(() => {
    if (mode === "browse") {
      setRows([]);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      let q = supabase
        .from("scanned_products")
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
      const res = await q;
      if (!alive) return;
      if (res.error) {
        setError("Search is unavailable right now. Please try again.");
        setRows([]);
      } else {
        setRows((res.data ?? []) as unknown as SearchRow[]);
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
    <section className="mt-5">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Search through products you have scanned before.
      </p>

      {/* Search bar */}
      <div className="relative mt-3">
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
          placeholder="Search your scans..."
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

      {/* ---------- BROWSE ---------- */}
      {mode === "browse" && (
        <div className="mt-6">
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
        </div>
      )}

      {/* ---------- CATEGORY / SEARCH ---------- */}
      {mode !== "browse" && (
        <div className="mt-5 flex flex-col gap-4">
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
            <MyScansNoResults term={mode === "search" ? term : activeCatName} />
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
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// My-scans pieces
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
  const status = statusFor(group.flag, group.category);
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

function MyScansNoResults({ term }: { term: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 p-8 text-center dark:border-white/10">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-600/10 text-teal-600 dark:text-teal-400">
        <FlaskConical className="h-8 w-8" aria-hidden />
      </span>
      <p className="text-sm font-semibold">
        No scans found{term ? ` for “${term}”` : ""}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Scan this product to add it to your history.
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
