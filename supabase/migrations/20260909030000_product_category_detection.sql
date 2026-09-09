-- Product category detection.
--
-- /api/analyze now runs a PHASE 1 category-detection step and returns a
-- `detected_category` object (food_and_beverages / personal_care /
-- household_cleaning / baby_product_food / baby_product_care / unknown) plus the
-- regulator, act and complaint portal that govern that category.
--
-- We persist that object on each scan so the history screen, the complaint
-- drafter, the PDF report and the safe-products search can all apply the
-- category-correct rules, and so safe-products search can filter by broad
-- category with a category-specific score threshold.

alter table public.scanned_products
  add column if not exists detected_category jsonb;

comment on column public.scanned_products.detected_category is
  'PHASE 1 output of /api/analyze: { category, confidence, signals_found[], regulatory_body, applicable_act, complaint_portal }.';

-- ---------------------------------------------------------------------------
-- Re-create the verified-safe-products view to carry detected_category.
-- (Same definer-view semantics as before — no personal columns exposed.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.verified_safe_products AS
SELECT
  sp.id,
  sp.product_name,
  sp.brand,
  sp.category,
  sp.detected_category,
  sp.image_url,
  sp.overall_score,
  sp.compliance_status,
  sp.ingredient_analysis,
  sp.healthier_alternatives,
  sp.scanned_at,
  COUNT(*) OVER (PARTITION BY sp.product_name, sp.brand) as times_scanned
FROM public.scanned_products sp
WHERE sp.overall_score >= 75
  AND sp.compliance_status = 'compliant'
  AND sp.product_name IS NOT NULL
  AND sp.brand IS NOT NULL
ORDER BY sp.overall_score DESC, times_scanned DESC;

comment on view public.verified_safe_products is
  'Read-only, non-personal projection of well-scoring compliant scans. Builds itself from real scan data — no curated list. Intentionally bypasses RLS for SELECT.';

GRANT SELECT ON public.verified_safe_products TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-create search_safe_products with a broad-category filter + detected_category
-- in the result. `detected_category_filter` matches detected_category->>'category'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_safe_products(
  search_query text DEFAULT '',
  category_filter text DEFAULT '',
  min_score integer DEFAULT 75,
  detected_category_filter text DEFAULT ''
)
RETURNS TABLE (
  id uuid,
  product_name text,
  brand text,
  category text,
  detected_category jsonb,
  image_url text,
  overall_score integer,
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
    sp.compliance_status,
    sp.ingredient_analysis,
    COUNT(*) OVER (PARTITION BY sp.product_name, sp.brand) as times_scanned
  FROM scanned_products sp
  WHERE sp.overall_score >= min_score
    AND sp.compliance_status = 'compliant'
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
           sp.image_url, sp.overall_score, sp.compliance_status,
           sp.ingredient_analysis, sp.scanned_at
  ORDER BY sp.overall_score DESC
  LIMIT 50;
$$;

comment on function public.search_safe_products is
  'Filtered search over verified safe products (score + compliance + text + shelf category + broad regulatory category). SECURITY DEFINER: reads across users but returns no personal columns.';

GRANT EXECUTE ON FUNCTION public.search_safe_products TO anon, authenticated;
