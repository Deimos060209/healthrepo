/**
 * Server-side read of the verified-safe-products surface, for the home page.
 *
 * Mirrors lib/stats.ts: never throws (runs during prerender / ISR), imports the
 * Supabase client lazily inside the try (lib/supabase.ts throws at module scope
 * when env vars are absent), and returns [] rather than inventing anything when
 * the view/migration is unavailable.
 */

import type { SafeProductRow } from "./safe-products";
import { dedupeSafeProducts, type SafeProduct } from "./safe-products";

/**
 * Top verified-safe products, de-duplicated by product + brand and sorted by
 * score. Returns [] on any failure (migration not applied, network down, empty
 * database). Callers decide what to show for a short list.
 */
export async function getVerifiedSafeProducts(limit = 6): Promise<SafeProduct[]> {
  try {
    const { supabase } = await import("./supabase");

    const { data, error } = await supabase
      .from("verified_safe_products")
      .select(
        "id, product_name, brand, category, detected_category, image_url, overall_score, compliance_status, ingredient_analysis, times_scanned",
      )
      .order("overall_score", { ascending: false })
      .limit(200)
      .abortSignal(AbortSignal.timeout(5000));

    if (error || !data) return [];

    return dedupeSafeProducts(data as unknown as SafeProductRow[]).slice(0, limit);
  } catch {
    return [];
  }
}
