/* eslint-disable no-console */
/**
 * Probe the REAL Supabase project with the anon key to see which schema objects
 * actually exist. Anon has no session, so RLS-protected rows return 0 — that is
 * expected and is reported as "exists, RLS-gated", not as "missing".
 * Run: npx tsx scripts/probe-db.ts
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log(`Project: ${URL_}\n`);

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

function verdict(status: number, body: string): string {
  if (status === 200 || status === 206) return "EXISTS (readable)";
  if (status === 401 || status === 403) return "EXISTS (permission denied — RLS)";
  if (/PGRST205|PGRST202|does not exist|Could not find the/i.test(body)) return "*** MISSING ***";
  if (status === 404) return "*** MISSING (404) ***";
  return `status ${status}`;
}

async function probeTable(name: string, select = "*") {
  const r = await fetch(`${URL_}/rest/v1/${name}?select=${select}&limit=3`, {
    headers: { ...H, Prefer: "count=exact" },
  });
  const body = await r.text();
  const count = r.headers.get("content-range");
  let rows = 0;
  try {
    rows = JSON.parse(body).length ?? 0;
  } catch {
    /* error body */
  }
  console.log(
    `  ${name.padEnd(26)} ${verdict(r.status, body).padEnd(34)} rows_visible=${rows} range=${count ?? "-"}`,
  );
  if (verdict(r.status, body).includes("MISSING")) console.log(`      ↳ ${body.slice(0, 180)}`);
  return { status: r.status, body, rows };
}

async function probeRpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(args),
  });
  const body = await r.text();
  let n: number | string = "-";
  try {
    const j = JSON.parse(body);
    n = Array.isArray(j) ? j.length : typeof j === "object" ? "obj" : String(j);
  } catch {
    /* error body */
  }
  console.log(`  rpc ${name.padEnd(22)} ${verdict(r.status, body).padEnd(34)} returned=${n}`);
  if (r.status !== 200) console.log(`      ↳ ${body.slice(0, 220)}`);
  return { status: r.status, body };
}

async function probeColumn(table: string, col: string) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=${col}&limit=1`, { headers: H });
  const body = await r.text();
  const missing = /PGRST204|PGRST205|does not exist|column .* does not exist/i.test(body) || r.status === 404;
  console.log(`    ${table}.${col.padEnd(22)} ${missing ? "*** MISSING ***" : "exists"}`);
  if (missing) console.log(`        ↳ ${body.slice(0, 160)}`);
  return !missing;
}

async function main() {
  console.log("── TABLES / VIEWS ──────────────────────────────────────────────");
  await probeTable("profiles");
  await probeTable("scanned_products");
  await probeTable("complaints");
  await probeTable("user_health_profiles");
  await probeTable("product_search");
  await probeTable("verified_safe_products");

  console.log("\n── scanned_products COLUMNS (migration drift check) ────────────");
  for (const c of [
    "id", "user_id", "product_name", "brand", "image_url", "extracted_text",
    "analysis_result", "overall_score", "compliance_status", "scanned_at",
    "dosage_analysis", "personal_alerts", "detected_category",
  ]) {
    await probeColumn("scanned_products", c);
  }

  console.log("\n── FUNCTIONS ───────────────────────────────────────────────────");
  await probeRpc("community_stats", {});
  await probeRpc("search_safe_products", { search_query: "", category_filter: null, limit_count: 10 });

  console.log("\n── STORAGE ─────────────────────────────────────────────────────");
  const b = await fetch(`${URL_}/storage/v1/bucket/product-images`, { headers: H });
  const bb = await b.text();
  console.log(`  bucket product-images       ${b.status === 200 ? "EXISTS" : `status ${b.status}`}  ${bb.slice(0, 160)}`);

  console.log("\n── AUTH REACHABLE ──────────────────────────────────────────────");
  const s = await fetch(`${URL_}/auth/v1/settings`, { headers: H });
  const sj = await s.text();
  console.log(`  /auth/v1/settings           status ${s.status}`);
  try {
    const j = JSON.parse(sj);
    console.log(`  external providers enabled: ${Object.entries(j.external ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}`);
    console.log(`  email signup disabled? ${j.disable_signup}`);
  } catch {
    console.log(`  ${sj.slice(0, 200)}`);
  }
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
