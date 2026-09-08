/**
 * Community impact counters for the landing page.
 *
 * Backed by the `community_stats()` SECURITY DEFINER function (see
 * supabase/migrations/20260908010000_community_stats.sql) because both source
 * tables are behind per-user RLS — a direct client query would only ever count
 * the caller's own rows.
 */

export interface CommunityStats {
  productsScanned: number;
  harmfulFound: number;
  complaintsFiled: number;
}

/** Row shape returned by the RPC. count(*) is bigint, which may arrive as a string. */
interface StatsRow {
  products_scanned: number | string | null;
  harmful_found: number | string | null;
  complaints_filed: number | string | null;
}

const toCount = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Fetch the counters, or `null` if they are unavailable (migration not applied,
 * network down, Supabase unreachable). Callers should hide the section on null
 * rather than showing zeros — never invent numbers here.
 *
 * Never throws: this runs during prerender, and a landing page must not fail to
 * build because a database is briefly unreachable.
 *
 * The Supabase client is imported *inside* the try on purpose — lib/supabase.ts
 * throws at module scope when the env vars are absent, and a static import here
 * would make that crash the home page build rather than degrade to no stats.
 */
export async function getCommunityStats(): Promise<CommunityStats | null> {
  try {
    const { supabase } = await import("./supabase");

    const { data, error } = await supabase
      .rpc("community_stats")
      // Bounded so a hung request cannot stall a build or a request.
      .abortSignal(AbortSignal.timeout(5000))
      .single();

    if (error || !data) return null;

    const row = data as StatsRow;
    return {
      productsScanned: toCount(row.products_scanned),
      harmfulFound: toCount(row.harmful_found),
      complaintsFiled: toCount(row.complaints_filed),
    };
  } catch {
    return null;
  }
}
