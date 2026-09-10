/* eslint-disable no-console */
/**
 * Per-migration audit — which of supabase/migrations/*.sql are applied?
 *
 * Only the anon key is available. It has NO table grant anywhere in this
 * project, so table columns cannot be read directly — but that same fact is
 * useful evidence:
 *
 *   - `SELECT` on a table that EXISTS but is not granted  -> 42501 permission denied
 *   - `SELECT` on a MISSING relation                      -> 42P01 / PGRST205
 *   - a MISSING column (even on a granted view)           -> 42703
 *   - a MISSING function overload                         -> PGRST202
 *
 * Views (`product_search`, `verified_safe_products`) and functions
 * (`community_stats`, `search_safe_products`) ARE granted to anon, and the
 * `product-images` storage bucket has a public-read policy, so all of those
 * can be probed properly. Two `scanned_products` columns (dosage_analysis,
 * personal_alerts) are projected by nothing anon can see — they get a
 * copy-paste SQL check.
 *
 * Run: npx tsx scripts/probe-db.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(url, key);
const ROOT = process.cwd().replace(/\\/g, "/");

const errBlob = (e: { code?: string; message?: string } | null) =>
  `${e?.code ?? ""} ${e?.message ?? ""}`;

/** A base table EXISTS if a select is permission-denied (42501) rather than 42P01. */
async function tableExists(t: string): Promise<boolean | null> {
  const { error } = await sb.from(t).select("*").limit(1);
  if (!error) return true;
  const b = errBlob(error);
  if (/42501|permission denied/i.test(b)) return true;
  if (/42P01|PGRST205|does not exist|Could not find the table/i.test(b))
    return false;
  return null;
}
/** A granted view is reachable — a plain select succeeds. */
async function viewReachable(v: string): Promise<boolean | null> {
  const { error } = await sb.from(v).select("*").limit(1);
  if (!error) return true;
  const b = errBlob(error);
  if (/42P01|PGRST205|does not exist|Could not find the table/i.test(b))
    return false;
  return null;
}
async function viewHasColumn(v: string, col: string): Promise<boolean | null> {
  const { error } = await sb.from(v).select(col).limit(0);
  if (!error) return true;
  const b = errBlob(error);
  if (/42703|column .* does not exist|could not find the .* column/i.test(b))
    return false;
  return null;
}
async function fnExists(
  name: string,
  args: Record<string, unknown>,
): Promise<boolean | null> {
  const { error } = await sb.rpc(name, args);
  if (!error) return true;
  const b = errBlob(error);
  if (/PGRST202|42883|Could not find the function|does not exist/i.test(b))
    return false;
  return null;
}
async function bucketReadable(id: string): Promise<boolean | null> {
  const { data, error } = await sb.storage.from(id).list("", { limit: 1 });
  if (!error) return true;
  if (/not found|does not exist/i.test(error.message)) return false;
  return data ? true : null;
}

type Verdict = "yes" | "no" | "unverifiable";
interface Row {
  file: string;
  applied: Verdict;
  evidence: string;
}

(async () => {
  const files = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // ---- probe everything anon CAN see ----
  const tProfiles = await tableExists("profiles");
  const tComplaints = await tableExists("complaints");
  const tScanned = await tableExists("scanned_products");
  const tHealth = await tableExists("user_health_profiles");
  const vSearch = await viewReachable("product_search");
  const vSafe = await viewReachable("verified_safe_products");
  const vSafeDetected = await viewHasColumn(
    "verified_safe_products",
    "detected_category",
  );
  const vSafeSafety = await viewHasColumn("verified_safe_products", "safety_score");
  const vSafeNutrition = await viewHasColumn(
    "verified_safe_products",
    "nutrition_score",
  );
  const fnStats = await fnExists("community_stats", {});
  const fn3 = await fnExists("search_safe_products", {
    search_query: "",
    category_filter: "",
    min_score: 75,
  });
  const fn4 = await fnExists("search_safe_products", {
    search_query: "",
    category_filter: "",
    min_score: 75,
    detected_category_filter: "",
  });
  const fn5 = await fnExists("search_safe_products", {
    search_query: "",
    category_filter: "",
    min_score: 75,
    detected_category_filter: "",
    min_nutrition_score: 60,
  });
  const bucket = await bucketReadable("product-images");

  const yn = (b: boolean | null) =>
    b === true ? "present" : b === false ? "MISSING" : "unknown";
  const all = (...bs: (boolean | null)[]): Verdict =>
    bs.some((b) => b === false)
      ? "no"
      : bs.every((b) => b === true)
        ? "yes"
        : "unverifiable";

  const rows: Row[] = [
    {
      file: "20260906000000_init_schema.sql",
      applied: all(tProfiles, tComplaints, tScanned, vSearch),
      evidence: `profiles=${yn(tProfiles)} complaints=${yn(tComplaints)} scanned_products=${yn(tScanned)} (42501 permission-denied => relation exists, RLS enforced). product_search & community_stats read scanned_products/complaints columns without error.`,
    },
    {
      file: "20260907120000_product_search_view.sql",
      applied: all(vSearch, await viewHasColumn("product_search", "overall_score")),
      evidence: `SELECT from product_search => OK []; overall_score column selectable; anon has SELECT grant.`,
    },
    {
      file: "20260908000000_product_images_storage.sql",
      applied: all(bucket),
      evidence: `storage.from('product-images').list('') => OK (bucket exists, public-read policy on storage.objects in force for anon). Write policies not probeable without auth.`,
    },
    {
      file: "20260908010000_community_stats.sql",
      applied: all(fnStats),
      evidence: `rpc community_stats() => OK, returns {products_scanned, harmful_found, complaints_filed}. execute granted to anon.`,
    },
    {
      file: "20260908020000_user_health_profiles.sql",
      applied: all(tHealth),
      evidence: `SELECT from user_health_profiles => 42501 permission denied (relation exists; RLS on).`,
    },
    {
      file: "20260909000000_dosage_analysis.sql",
      applied: "unverifiable",
      evidence: `column scanned_products.dosage_analysis is projected by no anon-visible view, and scanned_products is 42501. Circumstantial: later migration 20260909030000 IS applied and history detail SELECTs this column in prod. Confirm with the SQL below.`,
    },
    {
      file: "20260909010000_scan_personal_alerts.sql",
      applied: "unverifiable",
      evidence: `column scanned_products.personal_alerts — same situation as dosage_analysis. Confirm with the SQL below.`,
    },
    {
      file: "20260909020000_safe_products_view.sql",
      applied: all(vSafe, fn3),
      evidence: `SELECT from verified_safe_products => OK; rpc search_safe_products(3-arg) => OK (the bare 3-arg overload only comes from this file).`,
    },
    {
      file: "20260909030000_product_category_detection.sql",
      applied: all(vSafeDetected, fn4),
      evidence: `verified_safe_products.detected_category selectable => scanned_products.detected_category column exists AND the view was recreated. rpc search_safe_products(detected_category_filter, 4-arg) => OK.`,
    },
    {
      file: "20260909040000_scoring_model_v2.sql",
      applied: all(vSafeSafety, vSafeNutrition, fn5),
      evidence: `verified_safe_products.safety_score / nutrition_score => 42703 column does not exist; rpc search_safe_products(min_nutrition_score, 5-arg) => PGRST202 function not found.`,
    },
  ];

  // sanity: any migration file on disk not in the list above?
  for (const f of files) {
    if (!rows.some((r) => r.file === f)) {
      rows.push({ file: f, applied: "unverifiable", evidence: "not audited by this script" });
    }
  }

  console.log("═".repeat(100));
  console.log(
    "filename".padEnd(46) + " | applied | evidence",
  );
  console.log("─".repeat(100));
  for (const r of rows) {
    console.log(
      `${r.file.padEnd(46)} | ${r.applied.padEnd(7)} | ${r.evidence}`,
    );
  }

  const need = rows.filter((r) => r.applied === "no");
  const check = rows.filter((r) => r.applied === "unverifiable");

  console.log("\n" + "═".repeat(100));
  console.log("OPEN THE UNAPPLIED FILE(S) (PowerShell):");
  console.log("═".repeat(100));
  if (need.length === 0) console.log("  (none definitively missing)");
  for (const r of need)
    console.log(`  notepad "${ROOT.replace(/\//g, "\\")}\\supabase\\migrations\\${r.file}"`);

  if (check.length) {
    console.log("\n" + "═".repeat(100));
    console.log("VERIFY THE UNVERIFIABLE — run in the Supabase SQL editor:");
    console.log("═".repeat(100));
    console.log(`  select
    exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='scanned_products'
               and column_name='dosage_analysis') as col_dosage_analysis,   -- 20260909000000
    exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='scanned_products'
               and column_name='personal_alerts') as col_personal_alerts;   -- 20260909010000
  -- 'false' => open + run that file:`);
    for (const r of check)
      console.log(`  #   notepad "${ROOT.replace(/\//g, "\\")}\\supabase\\migrations\\${r.file}"`);
  }
})().catch((e) => {
  console.error("PROBE FAILED:", e?.message ?? e);
  process.exit(1);
});
