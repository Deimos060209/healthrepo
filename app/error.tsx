"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for debugging; a real deployment would forward this to Sentry etc.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="text-lg font-bold">Something went wrong</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-white/15"
        >
          <Home className="h-4 w-4" aria-hidden />
          Home
        </Link>
      </div>
    </main>
  );
}
