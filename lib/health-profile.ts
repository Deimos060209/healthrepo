/**
 * Personal health profile — client-side helpers.
 *
 * The profile is a single row per user in `public.user_health_profiles`. Values
 * are stored as the human-readable chip labels (e.g. "No sugar", "Hypertension
 * (high BP)") so both the UI and Claude can use them directly with no slug map.
 */

import { supabase } from "./supabase";
import type { UserHealthProfileInput } from "@/types/analysis";

// ---------------------------------------------------------------------------
// Chip options (labels are the stored values)
// ---------------------------------------------------------------------------

export const ALLERGY_OPTIONS = [
  "Nuts",
  "Peanuts",
  "Gluten",
  "Dairy/Lactose",
  "Eggs",
  "Soy",
  "Shellfish",
  "Fish",
  "Wheat",
  "Sesame",
  "Mustard",
  "Celery",
] as const;

export const DIET_OPTIONS = [
  "No sugar",
  "Low sugar",
  "No artificial sweeteners",
  "Low sodium/salt",
  "Low fat",
  "No trans fat",
  "No artificial colors",
  "No artificial preservatives",
  "Vegetarian",
  "Vegan",
  "Keto",
  "No palm oil",
  "No high fructose corn syrup",
  "Organic only",
  "No MSG",
] as const;

export const CONDITION_OPTIONS = [
  "Diabetic",
  "Pre-diabetic",
  "Hypertension (high BP)",
  "Heart condition",
  "Kidney condition",
  "Pregnant",
  "Breastfeeding",
  "Child under 5",
  "Child under 12",
  "ADHD (self/child)",
  "Phenylketonuria (PKU)",
  "Asthma",
] as const;

// ---------------------------------------------------------------------------
// Shape + helpers
// ---------------------------------------------------------------------------

export type HealthProfile = UserHealthProfileInput;

export const EMPTY_HEALTH_PROFILE: HealthProfile = {
  allergies: [],
  dietary_preferences: [],
  health_conditions: [],
  custom_avoid_ingredients: [],
};

const cleanList = (v: unknown): string[] =>
  Array.isArray(v)
    ? Array.from(
        new Set(
          v
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      )
    : [];

/** Coerce a raw DB row (or anything) into a well-formed HealthProfile. */
export function toHealthProfile(raw: unknown): HealthProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    allergies: cleanList(r.allergies),
    dietary_preferences: cleanList(r.dietary_preferences),
    health_conditions: cleanList(r.health_conditions),
    custom_avoid_ingredients: cleanList(r.custom_avoid_ingredients),
  };
}

/** True when the profile carries no criteria at all. */
export function isHealthProfileEmpty(p: HealthProfile | null | undefined): boolean {
  if (!p) return true;
  return (
    p.allergies.length === 0 &&
    p.dietary_preferences.length === 0 &&
    p.health_conditions.length === 0 &&
    p.custom_avoid_ingredients.length === 0
  );
}

/** Total number of criteria across every section. */
export function healthProfileCount(p: HealthProfile | null | undefined): number {
  if (!p) return 0;
  return (
    p.allergies.length +
    p.dietary_preferences.length +
    p.health_conditions.length +
    p.custom_avoid_ingredients.length
  );
}

/**
 * Fetch the signed-in user's health profile.
 * Returns `null` when signed out or when no row exists yet.
 */
export async function fetchHealthProfile(): Promise<HealthProfile | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("user_health_profiles")
      .select(
        "allergies, dietary_preferences, health_conditions, custom_avoid_ingredients",
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) return null;
    return toHealthProfile(data);
  } catch {
    return null;
  }
}

/** Upsert the signed-in user's health profile. Throws on failure. */
export async function saveHealthProfile(profile: HealthProfile): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const clean = toHealthProfile(profile);
  const { error } = await supabase.from("user_health_profiles").upsert(
    {
      user_id: user.id,
      ...clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}
