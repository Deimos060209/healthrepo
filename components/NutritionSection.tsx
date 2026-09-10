"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type {
  NutritionalAnalysis,
  NutritionalConcern,
  NutritionalConcernLevel,
} from "@/types/analysis";

/**
 * The "Nutritional quality" section — shared between the scan results page and
 * the history detail page so they render identically. Self-contained: it owns
 * its own copies of the small helpers/constants it needs.
 */

function clampScore(n: number | null | undefined): number {
  return Math.max(0, Math.min(100, Math.round(n ?? 0)));
}

function scoreBand(score: number) {
  if (score >= 80)
    return { text: "text-green-600 dark:text-green-400", bar: "bg-green-500" };
  if (score >= 50)
    return { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" };
  return { text: "text-red-600 dark:text-red-400", bar: "bg-red-600" };
}

const FOOD_TYPE_LABEL: Record<string, string> = {
  staple_ingredient: "Staple ingredient",
  minimally_processed: "Minimally processed",
  processed_product: "Processed product",
};

const DENSITY_BADGE: Record<string, { label: string; cls: string }> = {
  high: {
    label: "High",
    cls: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  },
  moderate: {
    label: "Moderate",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  low: {
    label: "Low",
    cls: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  },
  empty: {
    label: "Empty",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

const CONCERN_STYLE: Record<
  NutritionalConcernLevel,
  { label: string; badge: string; border: string }
> = {
  mild: {
    label: "Mild",
    badge: "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
    border: "border-l-4 border-l-zinc-400",
  },
  moderate: {
    label: "Moderate",
    badge:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    border: "border-l-4 border-l-amber-500",
  },
  significant: {
    label: "Significant",
    badge:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
    border: "border-l-4 border-l-orange-500",
  },
};

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

function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{children}</p>
    </div>
  );
}

function NutritionConcernCard({ c }: { c: NutritionalConcern }) {
  const s = CONCERN_STYLE[c.concern_level] ?? CONCERN_STYLE.moderate;
  return (
    <li
      className={`rounded-xl border border-zinc-200 p-3 dark:border-white/10 ${s.border}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{c.ingredient}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${s.badge}`}
        >
          {s.label}
        </span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-white/10 dark:text-zinc-400">
          {CONCERN_TYPE_LABEL[c.concern_type] ?? c.concern_type}
        </span>
        {c.source === "ai_knowledge" && (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-800 dark:bg-teal-500/15 dark:text-teal-300">
            AI knowledge
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        {c.why_flagged && <p>{c.why_flagged}</p>}
        {c.health_effects && (
          <Field title="What it does">{c.health_effects}</Field>
        )}
        {c.moderation_guidance && (
          <Field title="How much is fine">{c.moderation_guidance}</Field>
        )}
        {c.better_alternative && (
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-green-700 dark:text-green-400">
              Better:
            </span>
            <span className="text-green-700 dark:text-green-400">
              {c.better_alternative}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

export function NutritionSection({ n }: { n: NutritionalAnalysis }) {
  const score = clampScore(n.nutrition_score);
  const band = scoreBand(score);

  return (
    <div className="flex flex-col gap-4">
      {/* Score bar */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Nutrition score</span>
          <span className={`text-xl font-extrabold tabular-nums ${band.text}`}>
            {score}
            <span className="text-xs font-medium text-zinc-500">/100</span>
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
          <div
            className={`h-full rounded-full ${band.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* Food type + nutrient density — the scale this was judged on */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-bold uppercase tracking-wide text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
            {FOOD_TYPE_LABEL[n.food_type] ?? "Product"}
          </span>
          {DENSITY_BADGE[n.nutrient_density] && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide ${
                DENSITY_BADGE[n.nutrient_density].cls
              }`}
            >
              {DENSITY_BADGE[n.nutrient_density].label} nutrient density
            </span>
          )}
        </div>
        {n.food_type === "staple_ingredient" && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Scored as a cooking ingredient, not a finished product — the gentler
            staple scale applies.
          </p>
        )}
        {n.density_note && n.food_type !== "staple_ingredient" && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {n.density_note}
          </p>
        )}
      </div>

      {n.primary_concern && (
        <p className="flex items-start gap-2 rounded-xl border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-bold">Primary concern: </span>
            {n.primary_concern.explanation}
          </span>
        </p>
      )}

      {!n.nutrition_data_complete && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Nutrition panel not visible — scan the back of the pack for a complete
          assessment. The ingredient-based findings below still apply.
        </p>
      )}

      {n.is_ultra_processed && (
        <p className="rounded-xl border border-orange-400/50 bg-orange-500/10 px-3 py-2 text-xs text-orange-800 dark:text-orange-200">
          <span className="font-bold">Ultra-processed. </span>
          Diets high in ultra-processed foods are associated with obesity,
          cardiovascular disease and type 2 diabetes regardless of individual
          ingredient safety.
        </p>
      )}

      {n.sugar_alias_count >= 3 && (
        <div className="rounded-xl border-2 border-orange-400/60 bg-orange-50 px-3 py-2.5 dark:border-orange-500/40 dark:bg-orange-500/[0.08]">
          <p className="text-xs font-bold text-orange-900 dark:text-orange-200">
            Sugar is listed under {n.sugar_alias_count} different names
          </p>
          <p className="mt-1 text-xs text-orange-800 dark:text-orange-200/90">
            This makes the total sugar content appear lower in the ingredients
            order than it actually is.
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1">
            {n.sugar_aliases_found.map((s) => (
              <span
                key={s}
                className="rounded-md bg-orange-200/70 px-2 py-0.5 text-[11px] font-medium text-orange-900 dark:bg-orange-500/20 dark:text-orange-200"
              >
                {s}
              </span>
            ))}
          </p>
        </div>
      )}

      {n.ingredient_order_note && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {n.ingredient_order_note}
        </p>
      )}

      {/* Threshold readings */}
      {n.threshold_flags.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Nutrition panel
          </p>
          <ul className="mt-1.5 flex flex-col divide-y divide-zinc-100 dark:divide-white/5">
            {n.threshold_flags.map((f, i) => {
              const cls =
                f.level === "very_high" || f.level === "high"
                  ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                  : f.level === "medium_high" || f.level === "medium"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300";
              const isBonus = f.penalty < 0;
              const levelLabel = f.level.replace(/_/g, " ");
              return (
                <li
                  key={`${f.nutrient}-${i}`}
                  className="flex flex-col gap-0.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {f.nutrient}: {f.value_per_100}
                      {f.unit} per 100
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        isBonus
                          ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                          : cls
                      }`}
                    >
                      {isBonus ? "Good" : levelLabel}
                    </span>
                  </div>
                  {f.reference && (
                    <span className="text-xs text-zinc-500">{f.reference}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Concern cards */}
      {n.concerns.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Flagged ingredients ({n.concerns.length})
          </p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {n.concerns.map((c, i) => (
              <NutritionConcernCard key={`${c.ingredient}-${i}`} c={c} />
            ))}
          </ul>
        </div>
      )}

      {n.positive_notes.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {n.positive_notes.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {n.moderation_advice && (
        <p className="rounded-xl bg-zinc-500/[0.07] px-3 py-2 text-sm">
          <span className="font-semibold">In practice: </span>
          {n.moderation_advice}
        </p>
      )}
    </div>
  );
}
