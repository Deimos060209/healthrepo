-- Scoring model v2 — separate the three dimensions and store the new
-- weighted overall.
--
-- BACKGROUND
-- ----------
-- scanned_products.overall_score has, until now, held the SAFETY score (0-100
-- for banned substances + harmful additives only). /api/analyze was rewritten
-- to compute three dimensions — safety, nutrition, compliance — and a weighted
-- overall (safety x0.35 + nutrition x0.50 + compliance x0.15). History, search
-- and the verified-safe-products list were still reading overall_score as
-- "safety", so they showed the wrong number and filtered on the wrong value.
--
-- WHAT THIS MIGRATION DOES
-- -----------------------
-- 1. Adds the missing per-dimension columns + verdict + the two JSON blobs the
--    history detail page needs to reproduce the Nutritional quality section.
-- 2. Adds scan_version (default 1). Rows written before this migration are
--    v1 — overall_score is their old safety value and there is no nutrition
--    data. The app writes scan_version = 2 from now on, with overall_score
--    holding the weighted overall.
-- 3. Backfills safety_score = overall_score for existing rows (that IS what the
--    old value was). No nutrition backfill — old scans predate the layer.
-- 4. Rebuilds verified_safe_products / search_safe_products to (a) keep
--    filtering on overall_score (now the weighted overall for v2 rows) and
--    (b) add a nutrition floor: a product is only "safe to recommend" if it is
--    also not nutritionally poor. "Safe" and "healthy" are different claims and
--    the search promises the latter.

-- ---------------------------------------------------------------------------
-- 1 + 2. New columns
-- ---------------------------------------------------------------------------
alter table public.scanned_products
  add column if not exists safety_score        integer,
  add column if not exists nutrition_score     integer,   -- null for non-food
  add column if not exists compliance_score    integer,
  add column if not exists verdict             text,
  add column if not exists nutritional_analysis jsonb not null default '{}'::jsonb,
  add column if not exists primary_concern     jsonb not null default '{}'::jsonb,
  add column if not exists scan_version        integer not null default 1;

comment on column public.scanned_products.safety_score is
  'Banned substances + harmful additives only, 0-100. Backfilled from the old overall_score for v1 rows.';
comment on column public.scanned_products.nutrition_score is
  'Nutritional quality, 10-95. NULL for non-food and for every v1 (pre-nutrition-layer) scan.';
comment on column public.scanned_products.compliance_score is
  'Legal Metrology label-completeness score, 0-100.';
comment on column public.scanned_products.verdict is
  'Top-line call: safe | caution | limit | avoid.';
comment on column public.scanned_products.nutritional_analysis is
  'Full nutritional_analysis object from /api/analyze so the history detail page can reproduce the Nutritional quality section. {} for non-food / v1.';
comment on column public.scanned_products.primary_concern is
  'nutritional_analysis.primary_concern — the single biggest contributor to the nutrition penalty. {} when none.';
comment on column public.scanned_products.scan_version is
  '1 = scored before the nutritional layer (overall_score is the old safety value, no nutrition data). 2 = overall_score is the weighted safety/nutrition/compliance blend.';
comment on column public.scanned_products.overall_score is
  'v2: weighted overall = safety x0.35 + nutrition x0.50 + compliance x0.15. v1: legacy safety score.';

-- ---------------------------------------------------------------------------
-- 3. Backfill existing rows — the old overall_score WAS the safety score.
--    New columns stay NULL; scan_version stays 1 (the column default).
-- ---------------------------------------------------------------------------
update public.scanned_products
   set safety_score = overall_score
 where safety_score is null
   and overall_score is not null;

create index if not exists scanned_products_scan_version_idx
  on public.scanned_products (scan_version);
create index if not exists scanned_products_nutrition_score_idx
  on public.scanned_products (nutrition_score);

-- ---------------------------------------------------------------------------
-- 4. Rebuild the safe-products surfaces with the nutrition floor.
--    Same definer-view / SECURITY DEFINER semantics as before — no personal
--    columns exposed, RLS intentionally bypassed for SELECT.
-- ---------------------------------------------------------------------------

-- A product qualifies only if:
--   overall_score >= 75           (weighted overall for v2, legacy safety for v1)
--   compliance_status = 'compliant'
--   nutrition_score >= 60 OR nutrition_score IS NULL   <-- the new floor.
--       NULL covers non-food products and every v1 scan, which are judged on
--       safety + compliance exactly as before.

-- DROP + CREATE, not CREATE OR REPLACE: the earlier view has a different
-- column list, and CREATE OR REPLACE can only APPEND columns. Nothing depends
-- on this view (it is a leaf recommendation surface), so the drop is safe.
DROP VIEW IF EXISTS public.verified_safe_products;
CREATE VIEW public.verified_safe_products AS
SELECT
  sp.id,
  sp.product_name,
  sp.brand,
  sp.category,
  sp.detected_category,
  sp.image_url,
  sp.overall_score,
  sp.safety_score,
  sp.nutrition_score,
  sp.compliance_score,
  sp.verdict,
  sp.scan_version,
  sp.compliance_status,
  sp.ingredient_analysis,
  sp.healthier_alternatives,
  sp.scanned_at,
  COUNT(*) OVER (PARTITION BY sp.product_name, sp.brand) as times_scanned
FROM public.scanned_products sp
WHERE sp.overall_score >= 75
  AND sp.compliance_status = 'compliant'
  AND (sp.nutrition_score IS NULL OR sp.nutrition_score >= 60)
  AND sp.product_name IS NOT NULL
  AND sp.brand IS NOT NULL
ORDER BY sp.overall_score DESC, times_scanned DESC;

comment on view public.verified_safe_products is
  'Read-only, non-personal projection of well-scoring compliant scans that are also not nutritionally poor (nutrition_score >= 60, or NULL for non-food / pre-nutrition scans). Builds itself from real scan data. Intentionally bypasses RLS for SELECT.';

GRANT SELECT ON public.verified_safe_products TO anon, authenticated;

-- Drop every earlier signature so exactly one search_safe_products remains.
DROP FUNCTION IF EXISTS public.search_safe_products(text, text, integer);
DROP FUNCTION IF EXISTS public.search_safe_products(text, text, integer, text);

CREATE OR REPLACE FUNCTION public.search_safe_products(
  search_query text DEFAULT '',
  category_filter text DEFAULT '',
  min_score integer DEFAULT 75,
  detected_category_filter text DEFAULT '',
  min_nutrition_score integer DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  product_name text,
  brand text,
  category text,
  detected_category jsonb,
  image_url text,
  overall_score integer,
  safety_score integer,
  nutrition_score integer,
  compliance_score integer,
  verdict text,
  scan_version integer,
  compliance_status text,
  ingredient_analysis jsonb,
  times_scanned bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    sp.id,
    sp.product_name,
    sp.brand,
    sp.category,
    sp.detected_category,
    sp.image_url,
    sp.overall_score,
    sp.safety_score,
    sp.nutrition_score,
    sp.compliance_score,
    sp.verdict,
    sp.scan_version,
    sp.compliance_status,
    sp.ingredient_analysis,
    COUNT(*) OVER (PARTITION BY sp.product_name, sp.brand) as times_scanned
  FROM scanned_products sp
  WHERE sp.overall_score >= min_score
    AND sp.compliance_status = 'compliant'
    AND (sp.nutrition_score IS NULL OR sp.nutrition_score >= min_nutrition_score)
    AND sp.product_name IS NOT NULL
    AND (
      search_query = ''
      OR sp.product_name ILIKE '%' || search_query || '%'
      OR sp.brand ILIKE '%' || search_query || '%'
      OR sp.category ILIKE '%' || search_query || '%'
    )
    AND (
      category_filter = ''
      OR sp.category ILIKE '%' || category_filter || '%'
    )
    AND (
      detected_category_filter = ''
      OR (sp.detected_category ->> 'category') = detected_category_filter
      OR (
        detected_category_filter = 'baby'
        AND (sp.detected_category ->> 'category') LIKE 'baby_product_%'
      )
    )
  GROUP BY sp.id, sp.product_name, sp.brand, sp.category, sp.detected_category,
           sp.image_url, sp.overall_score, sp.safety_score, sp.nutrition_score,
           sp.compliance_score, sp.verdict, sp.scan_version, sp.compliance_status,
           sp.ingredient_analysis, sp.scanned_at
  ORDER BY sp.overall_score DESC
  LIMIT 50;
$$;

comment on function public.search_safe_products is
  'Filtered search over verified safe products. Now also enforces a nutrition floor (min_nutrition_score, default 60; NULL nutrition passes). SECURITY DEFINER: reads across users but returns no personal columns.';

GRANT EXECUTE ON FUNCTION public.search_safe_products TO anon, authenticated;
