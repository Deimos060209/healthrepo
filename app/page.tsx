import Link from "next/link";
import {
  HeartPulse,
  Camera,
  Search,
  ScrollText,
  ScanLine,
  FlaskConical,
  FileBarChart2,
  ShieldAlert,
  Megaphone,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { getCommunityStats } from "@/lib/stats";
import { HealthProfilePrompt } from "@/components/HealthProfilePrompt";

/** Re-fetch the community counters at most every 5 minutes (ISR). */
export const revalidate = 300;

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Camera,
    title: "Scan",
    body: "Click a photo of any packaged product.",
  },
  {
    icon: FlaskConical,
    title: "Analyze",
    body: "AI checks compliance and ingredients.",
  },
  {
    icon: FileBarChart2,
    title: "Report",
    body: "Get a detailed safety report with alternatives.",
  },
];

const SECONDARY: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}[] = [
  {
    href: "/search",
    icon: Search,
    title: "Search Products",
    subtitle: "Find safe, healthy alternatives",
  },
  {
    href: "/history",
    icon: ScrollText,
    title: "Scan History",
    subtitle: "View your previously scanned products",
  },
];

const inr = new Intl.NumberFormat("en-IN");

export default async function Home() {
  const stats = await getCommunityStats();
  // Hide the section entirely when there is nothing real to report — an empty
  // or unavailable database should show no numbers rather than zeros.
  const showStats = stats !== null && stats.productsScanned > 0;

  return (
    <>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-8 md:pb-12">
        {/* 1. Top section --------------------------------------------------- */}
        <header className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm shadow-teal-600/30">
              <HeartPulse className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-2xl font-bold tracking-tight">HealthRepo</span>
          </div>
          <p className="mt-3 text-sm font-semibold text-teal-700 dark:text-teal-400">
            Your Health. Your Right. Your Repo.
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Scan any packaged product to check if it&rsquo;s safe and legally
            compliant.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            {["FSSAI compliance", "Legal Metrology", "Ingredient safety"].map(
              (chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </header>

        {/* 2. Primary action — the biggest element ------------------------- */}
        <Link
          href="/scan"
          className="group mt-8 block rounded-3xl bg-gradient-to-br from-teal-500 to-teal-700 p-6 text-white shadow-lg shadow-teal-600/25 ring-1 ring-inset ring-white/10 transition-transform active:scale-[0.99] sm:p-8"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <Camera className="h-9 w-9" aria-hidden />
          </span>
          <span className="mt-5 flex items-center gap-1 text-2xl font-bold">
            Scan Product
            <ChevronRight
              className="h-6 w-6 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
          <span className="mt-1 block text-sm text-teal-50/90">
            Click a photo or upload an image
          </span>
        </Link>

        {/* 2b. Health profile nudge (client — only for signed-in users) --- */}
        <HealthProfilePrompt />

        {/* 3. Secondary actions ------------------------------------------- */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {SECONDARY.map(({ href, icon: Icon, title, subtitle }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-teal-500/40 dark:hover:bg-teal-500/[0.06]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600/10 text-teal-700 dark:text-teal-400">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </span>
            </Link>
          ))}
        </div>

        {/* 4. How it works ---------------------------------------------- */}
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            How it works
          </h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li
                key={title}
                className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <Icon
                    className="h-4 w-4 text-teal-700 dark:text-teal-400"
                    aria-hidden
                  />
                  <span className="text-sm font-semibold">{title}</span>
                </div>
                <p className="mt-2 text-xs leading-snug text-zinc-600 dark:text-zinc-400">
                  {body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* 5. Quick stats — omitted entirely until there is real data --- */}
        {showStats && stats && (
          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Community impact
            </h2>
            <dl className="mt-3 grid grid-cols-3 divide-x divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white text-center dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-col items-center gap-1 p-4">
                <ScanLine
                  className="h-4 w-4 text-teal-600 dark:text-teal-400"
                  aria-hidden
                />
                <dt className="sr-only">Products scanned</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {inr.format(stats.productsScanned)}
                </dd>
                <span className="text-[11px] leading-tight text-zinc-500">
                  Products Scanned
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 p-4">
                <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden />
                <dt className="sr-only">Harmful products found</dt>
                <dd className="text-xl font-bold tabular-nums text-red-600">
                  {inr.format(stats.harmfulFound)}
                </dd>
                <span className="text-[11px] leading-tight text-zinc-500">
                  Harmful Products Found
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 p-4">
                <Megaphone className="h-4 w-4 text-amber-500" aria-hidden />
                <dt className="sr-only">Complaints filed</dt>
                <dd className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-500">
                  {inr.format(stats.complaintsFiled)}
                </dd>
                <span className="text-[11px] leading-tight text-zinc-500">
                  Complaints Filed
                </span>
              </div>
            </dl>
          </section>
        )}
      </main>
    </>
  );
}
