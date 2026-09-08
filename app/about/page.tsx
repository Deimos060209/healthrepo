import type { Metadata } from "next";
import Link from "next/link";
import {
  Camera,
  FlaskConical,
  FileBarChart2,
  Scale,
  ShieldCheck,
  Megaphone,
  BookOpen,
  ArrowLeft,
} from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description:
    "What HealthRepo does, how it works, the laws behind it, and how consumers can act on what they find.",
};

const STEPS = [
  {
    icon: Camera,
    title: "Scan",
    body: "Photograph a packaged product. Text is read on your device with Tesseract.js OCR.",
  },
  {
    icon: FlaskConical,
    title: "Analyze",
    body: "Claude checks the label against the Legal Metrology rules and screens every ingredient against FSSAI's banned and restricted lists.",
  },
  {
    icon: FileBarChart2,
    title: "Report",
    body: "Get a safety score, a compliance checklist, plain-language ingredient explanations, healthier alternatives, and a PDF you can attach to a complaint.",
  },
];

/**
 * Add your team's names here to show a credits section on the About page.
 * Left empty the section is omitted entirely — better a missing section than a
 * page that reads "[Team member 1]" in front of an audience.
 */
const TEAM: string[] = [];

const RIGHTS = [
  "Refuse to pay more than the printed MRP — selling above MRP is a cognizable offence.",
  "Demand complete declarations: net quantity, manufacture date, best-before, and full manufacturer address with PIN code.",
  "Report missing or misleading labels to the Legal Metrology department via the National Consumer Helpline (1915).",
  "Report unsafe, banned, or mislabelled ingredients to FSSAI through Food Safety Connect (foscos.fssai.gov.in) or the toll-free helpline 1800-11-4420.",
  "File a case in the Consumer Commission online at edaakhil.nic.in if a seller or manufacturer does not respond.",
];

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pb-28 pt-6 md:pb-16">
      <div className="flex flex-col gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-foreground dark:text-zinc-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">About HealthRepo</h1>
      </div>

      {/* What it does */}
      <section className="flex flex-col gap-2">
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold">HealthRepo</span> helps Indian consumers
          check whether a packaged product is <em>safe</em> and{" "}
          <em>legally compliant</em> before they buy or consume it. Photograph the
          label and HealthRepo extracts the text, verifies the mandatory
          declarations required under the Legal Metrology (Packaged Commodities)
          Rules, 2011, and analyses the ingredients for substances that FSSAI has
          banned or restricted — explaining, in plain language, why each one
          matters and what to use instead.
        </p>
      </section>

      {/* How it works */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              className="rounded-2xl border border-zinc-200 p-4 dark:border-white/10"
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

      {/* Legal references */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Legal references
        </h2>
        <div className="flex flex-col gap-2">
          <div className="flex gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
            <Scale
              className="h-5 w-5 shrink-0 text-teal-700 dark:text-teal-400"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold">
                Legal Metrology Act, 2009 &amp; the Legal Metrology (Packaged
                Commodities) Rules, 2011
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Govern how pre-packaged goods must be labelled — name of the
                commodity, net quantity, MRP inclusive of all taxes, month/year of
                manufacture, manufacturer/importer address, consumer-care details
                and country of origin (Rules 6 &amp; 7).
              </p>
            </div>
          </div>
          <div className="flex gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
            <ShieldCheck
              className="h-5 w-5 shrink-0 text-teal-700 dark:text-teal-400"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold">
                Food Safety and Standards Act, 2006 (FSSAI)
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                And the regulations under it — Food Products Standards and Food
                Additives Regulations, 2011; Prohibition and Restrictions on Sales
                Regulations, 2011; Labelling and Display Regulations, 2020 — which
                set permitted additives, maximum limits, allergen declarations and
                the FSSAI licence-number requirement.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Know your rights */}
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          <Megaphone className="h-4 w-4" aria-hidden />
          Know your rights
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          As a consumer in India, you can:
        </p>
        <ul className="flex flex-col gap-2">
          {RIGHTS.map((r, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-xl bg-teal-600/[0.06] px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <span className="font-bold text-teal-700 dark:text-teal-400">
                {i + 1}.
              </span>
              {r}
            </li>
          ))}
        </ul>
      </section>

      {/* Team — hidden until TEAM is filled in, so no placeholder ever ships */}
      {TEAM.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Team
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Built at a hackathon by{" "}
            <span className="font-medium text-foreground">
              {TEAM.join(" · ")}
            </span>
            .
          </p>
        </section>
      )}

      {/* Disclaimer */}
      <section className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <BookOpen
          className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          <span className="font-semibold">Disclaimer:</span> HealthRepo provides
          AI-powered analysis for educational and awareness purposes only. It is
          not a lab test or legal advice. Regulatory limits change — verify
          against the current FSSAI and Legal Metrology notifications and consult
          the relevant authorities before taking official action.
        </p>
      </section>
    </main>
  );
}
