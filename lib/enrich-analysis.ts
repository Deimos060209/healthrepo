/**
 * Re-attach the long-form explanations that /api/analyze deliberately stopped
 * asking the model for.
 *
 * The route now sends Claude a COMPACT reference (names + codes + severity only)
 * and tells it that, for an ingredient it recognises from that reference, it
 * should return just { name, safety_status, source: 'reference_database',
 * reason }. The rich why / health-effects / who-should-avoid / banned-in /
 * alternative text lives in lib/reference-data.ts — enrichAnalysis() looks each
 * flagged ingredient up locally (by name and also_known_as, case-insensitive)
 * and fills those fields in before the analysis reaches the UI, the PDF and
 * Supabase. Same output the user used to see, a fraction of the API cost.
 *
 * Ingredients Claude flagged from its OWN knowledge (source: 'ai_knowledge')
 * keep whatever explanation Claude wrote; local data only fills blanks for them.
 */

import type { ProductAnalysis, IngredientAnalysis } from "@/types/analysis";
import {
  BANNED_INGREDIENTS,
  HARMFUL_ADDITIVES,
  FSSAI_ADDITIVE_LIMITS,
  HEALTHIER_ALTERNATIVES,
  PERSONAL_CARE_BANNED_INGREDIENTS,
  PERSONAL_CARE_HARMFUL_ADDITIVES,
  HOUSEHOLD_PRODUCT_SAFETY,
} from "@/lib/reference-data";

interface RefDetail {
  reason: string | null;
  health_effects: string | null;
  who_should_avoid: string | null;
  banned_in_countries: string[];
  healthier_alternative: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Full alternatives text for a reference entry, tolerating a case mismatch. */
function alternativesFor(name: string): string | null {
  const direct = HEALTHIER_ALTERNATIVES[name];
  if (direct) return direct.alternatives.join(", ");
  const key = Object.keys(HEALTHIER_ALTERNATIVES).find(
    (k) => norm(k) === norm(name),
  );
  return key ? HEALTHIER_ALTERNATIVES[key].alternatives.join(", ") : null;
}

/** name / alias (normalised) -> merged detail. Built once at module load. */
const INDEX: Map<string, RefDetail> = (() => {
  const m = new Map<string, RefDetail>();
  const add = (keys: (string | null | undefined)[], detail: RefDetail) => {
    for (const raw of keys) {
      if (!raw) continue;
      const key = norm(raw);
      // First writer wins: the richest sources are added first below.
      if (key && !m.has(key)) m.set(key, detail);
    }
  };

  for (const b of BANNED_INGREDIENTS) {
    add([b.name, ...b.also_known_as, b.e_code], {
      reason: b.why_banned,
      health_effects: b.health_effects_detailed,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: alternativesFor(b.name),
    });
  }
  for (const a of HARMFUL_ADDITIVES) {
    add([a.name, a.e_code, a.ins_code], {
      reason: a.why_concerning,
      health_effects: a.health_effects_detailed,
      who_should_avoid: a.who_should_avoid,
      banned_in_countries: a.banned_or_restricted_in ?? [],
      healthier_alternative: a.healthier_alternative ?? alternativesFor(a.name),
    });
  }
  for (const b of PERSONAL_CARE_BANNED_INGREDIENTS) {
    add([b.name], {
      reason: b.why_banned,
      health_effects: b.health_effects,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: null,
    });
  }
  for (const a of PERSONAL_CARE_HARMFUL_ADDITIVES) {
    add([a.name], {
      reason: a.why_concerning,
      health_effects: null,
      who_should_avoid: a.who_should_avoid,
      banned_in_countries: [],
      healthier_alternative: a.healthier_alternative,
    });
  }
  for (const h of HOUSEHOLD_PRODUCT_SAFETY) {
    add([h.name], {
      reason: `${h.why_concerning} ${h.safety_note}`.trim(),
      health_effects: null,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: h.healthier_alternative,
    });
  }
  // Widen alias coverage only (E-codes, INS codes, label spellings) — the
  // detail these point at is deliberately thin since real entries were added
  // above and won the key.
  for (const l of FSSAI_ADDITIVE_LIMITS) {
    add([l.name, ...l.also_known_as, l.e_code, l.ins_code], {
      reason: l.what_happens_above_limit,
      health_effects: null,
      who_should_avoid: null,
      banned_in_countries: [],
      healthier_alternative: alternativesFor(l.name),
    });
  }
  return m;
})();

function lookup(name: string): RefDetail | null {
  if (!name) return null;
  return INDEX.get(norm(name)) ?? null;
}

function mergeIngredient(ing: IngredientAnalysis): IngredientAnalysis {
  const d = lookup(ing.name);
  if (!d) return ing;

  const fromRef = ing.source === "reference_database";
  // For a reference-database hit the local text is authoritative; for an
  // ai_knowledge hit keep Claude's words and only fill genuine blanks.
  const pick = (local: string | null, model: string | null) =>
    fromRef ? local ?? model ?? null : model ?? local ?? null;

  return {
    ...ing,
    reason: pick(d.reason, ing.reason),
    health_effects: pick(d.health_effects, ing.health_effects),
    who_should_avoid: pick(d.who_should_avoid, ing.who_should_avoid),
    banned_in_countries:
      fromRef && d.banned_in_countries.length
        ? d.banned_in_countries
        : ing.banned_in_countries.length
          ? ing.banned_in_countries
          : d.banned_in_countries,
    healthier_alternative: pick(d.healthier_alternative, ing.healthier_alternative),
  };
}

/** Fill in the long explanations from local reference data. Pure — returns a copy. */
export function enrichAnalysis(analysis: ProductAnalysis): ProductAnalysis {
  if (!Array.isArray(analysis.ingredient_analysis)) return analysis;
  return {
    ...analysis,
    ingredient_analysis: analysis.ingredient_analysis.map(mergeIngredient),
  };
}
