import type { Metadata } from "next";
import Link from "next/link";
import { Compass, Home, ScanLine } from "lucide-react";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-600/10 text-teal-600 dark:text-teal-400">
        <Compass className="h-8 w-8" aria-hidden />
      </span>
      <p className="text-3xl font-extrabold tracking-tight text-zinc-300 dark:text-white/20">
        404
      </p>
      <h1 className="text-lg font-bold">Page not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
      </p>
      <div className="mt-2 flex gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Home className="h-4 w-4" aria-hidden />
          Back to home
        </Link>
        <Link
          href="/scan"
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-white/15"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          Scan a product
        </Link>
      </div>
    </main>
  );
}
