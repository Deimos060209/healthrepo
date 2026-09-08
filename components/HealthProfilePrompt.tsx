"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldPlus, ShieldCheck, ChevronRight } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { fetchHealthProfile, isHealthProfileEmpty } from "@/lib/health-profile";

/**
 * Home-page nudge for the personal health profile.
 * - signed out / still loading -> renders nothing
 * - no profile set             -> full "set up" banner
 * - profile set                -> small "active" chip with an edit link
 */
export function HealthProfilePrompt() {
  const { user, loading } = useAuth();
  const [state, setState] = useState<"unknown" | "empty" | "active">("unknown");

  useEffect(() => {
    if (loading || !user) {
      setState("unknown");
      return;
    }
    let alive = true;
    fetchHealthProfile()
      .then((p) => {
        if (!alive) return;
        setState(isHealthProfileEmpty(p) ? "empty" : "active");
      })
      .catch(() => {
        if (alive) setState("unknown");
      });
    return () => {
      alive = false;
    };
  }, [user, loading]);

  if (!user || state === "unknown") return null;

  if (state === "active") {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-green-500/30 bg-green-50/70 px-3 py-2 text-sm dark:border-green-500/25 dark:bg-green-500/[0.08]">
        <span className="inline-flex items-center gap-1.5 font-medium text-green-800 dark:text-green-300">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Health profile active
        </span>
        <Link
          href="/profile/health"
          className="font-medium text-green-800 underline underline-offset-2 dark:text-green-300"
        >
          Edit
        </Link>
      </div>
    );
  }

  return (
    <Link
      href="/profile/health"
      className="group mt-4 flex items-start gap-3 rounded-2xl border border-teal-500/30 bg-teal-50/70 p-4 transition-colors hover:bg-teal-50 dark:border-teal-500/25 dark:bg-teal-500/[0.08] dark:hover:bg-teal-500/[0.12]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
        <ShieldPlus className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">
          🛡️ Set up your health profile for personalized alerts
        </span>
        <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-400">
          Tell us your allergies, diet, and health conditions — we&rsquo;ll flag
          risky ingredients just for you.
        </span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
          Set up now
          <ChevronRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </span>
    </Link>
  );
}
