"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Plus,
  X,
  Save,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/components/AuthProvider";
import {
  ALLERGY_OPTIONS,
  DIET_OPTIONS,
  CONDITION_OPTIONS,
  EMPTY_HEALTH_PROFILE,
  fetchHealthProfile,
  saveHealthProfile,
  healthProfileCount,
  type HealthProfile,
} from "@/lib/health-profile";

const AUTOSAVE_MS = 900;

type ListKey =
  | "allergies"
  | "dietary_preferences"
  | "health_conditions"
  | "custom_avoid_ingredients";

export default function HealthProfilePage() {
  const toast = useToast();
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState<HealthProfile>(EMPTY_HEALTH_PROFILE);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState("");

  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- load -----
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // RouteGuard is redirecting to /login — just stop the spinner.
      setLoadState("ready");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const p = await fetchHealthProfile();
        if (!alive) return;
        setProfile(p ?? EMPTY_HEALTH_PROFILE);
        setLoadState("ready");
      } catch {
        if (alive) setLoadState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, authLoading]);

  const persist = useCallback(
    async (next: HealthProfile, opts?: { silent?: boolean }) => {
      setSaving(true);
      try {
        await saveHealthProfile(next);
        dirtyRef.current = false;
        if (!opts?.silent) toast.success("Saved ✓");
      } catch {
        toast.error("Could not save — check your connection and try again");
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );

  // ----- debounced auto-save -----
  useEffect(() => {
    if (loadState !== "ready" || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist(profile);
    }, AUTOSAVE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [profile, loadState, persist]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const toggle = (key: ListKey, value: string) => {
    dirtyRef.current = true;
    setProfile((p) => {
      const set = new Set(p[key]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...p, [key]: Array.from(set) };
    });
  };

  const addCustom = () => {
    const trimmed = custom.trim();
    if (!trimmed) return;
    const exists = profile.custom_avoid_ingredients.some(
      (x) => x.toLowerCase() === trimmed.toLowerCase(),
    );
    setCustom("");
    if (exists) return;
    dirtyRef.current = true;
    setProfile((p) => ({
      ...p,
      custom_avoid_ingredients: [...p.custom_avoid_ingredients, trimmed],
    }));
  };

  const removeCustom = (value: string) => {
    dirtyRef.current = true;
    setProfile((p) => ({
      ...p,
      custom_avoid_ingredients: p.custom_avoid_ingredients.filter(
        (x) => x !== value,
      ),
    }));
  };

  const saveNow = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await persist(profile);
  };

  const count = healthProfileCount(profile);

  // ----- states -----
  if (loadState === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
        <PageHeader title="Health profile" />
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading your profile…
        </div>
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
        <PageHeader title="Health profile" />
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5 text-sm">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden
          />
          <div>
            <p className="font-semibold text-red-700 dark:text-red-300">
              Couldn&rsquo;t load your health profile.
            </p>
            <p className="mt-1 text-red-700/90 dark:text-red-300/90">
              Check your connection and refresh the page.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:pb-12">
      <PageHeader title="Health profile" />

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Tell us your allergies, diet, and health conditions. When you scan a
        product, we&rsquo;ll flag any ingredient that&rsquo;s risky{" "}
        <span className="font-medium">for you</span> — even if it&rsquo;s fine for
        most people. Changes save automatically.
      </p>

      <Section emoji="🚫" title="Allergies">
        <ChipGrid>
          {ALLERGY_OPTIONS.map((label) => (
            <Chip
              key={label}
              label={label}
              active={profile.allergies.includes(label)}
              onClick={() => toggle("allergies", label)}
            />
          ))}
        </ChipGrid>
      </Section>

      <Section emoji="🥗" title="Dietary preferences">
        <ChipGrid>
          {DIET_OPTIONS.map((label) => (
            <Chip
              key={label}
              label={label}
              active={profile.dietary_preferences.includes(label)}
              onClick={() => toggle("dietary_preferences", label)}
            />
          ))}
        </ChipGrid>
      </Section>

      <Section
        emoji="💊"
        title="Health conditions"
        note="This helps us flag ingredients that are specifically risky for your condition."
      >
        <ChipGrid>
          {CONDITION_OPTIONS.map((label) => (
            <Chip
              key={label}
              label={label}
              active={profile.health_conditions.includes(label)}
              onClick={() => toggle("health_conditions", label)}
            />
          ))}
        </ChipGrid>
      </Section>

      <Section emoji="✏️" title="Custom ingredients to avoid">
        <div className="flex gap-2">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="e.g. palm oil, gelatin, carmine"
            className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 dark:border-white/15"
          />
          <button
            type="button"
            onClick={addCustom}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </button>
        </div>
        {profile.custom_avoid_ingredients.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.custom_avoid_ingredients.map((value) => (
              <span
                key={value}
                className="inline-flex items-center gap-1.5 rounded-full border border-green-500 bg-green-50 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-500/[0.12] dark:text-green-200"
              >
                {value}
                <button
                  type="button"
                  onClick={() => removeCustom(value)}
                  aria-label={`Remove ${value}`}
                  className="rounded-full text-green-700/70 hover:text-green-900 dark:text-green-300/70 dark:hover:text-green-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
      </Section>

      <div className="sticky bottom-16 -mx-4 mt-2 flex items-center justify-between gap-3 border-t border-zinc-200 bg-background/95 px-4 py-3 backdrop-blur dark:border-white/10 md:bottom-0">
        <span className="text-xs text-zinc-500">
          {saving ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Saving…
            </span>
          ) : count > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              {count} {count === 1 ? "criterion" : "criteria"} set
            </span>
          ) : (
            "No criteria set yet"
          )}
        </span>
        <button
          type="button"
          onClick={saveNow}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden />
          Save profile
        </button>
      </div>

      <p className="text-center text-xs text-zinc-500">
        Your health profile is private to your account and is only used to
        personalise your own scans.{" "}
        <Link
          href="/scan"
          className="font-medium text-teal-700 underline underline-offset-2 dark:text-teal-300"
        >
          Scan a product →
        </Link>
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function Section({
  emoji,
  title,
  note,
  children,
}: {
  emoji: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-5 dark:border-white/10">
      <h2 className="text-sm font-semibold">
        <span aria-hidden>{emoji}</span> {title}
      </h2>
      {note && (
        <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>
      )}
      {children}
    </section>
  );
}

function ChipGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
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
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-green-500 bg-green-50 text-green-800 ring-1 ring-green-500/30 dark:bg-green-500/[0.12] dark:text-green-200"
          : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-foreground dark:border-white/15 dark:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
