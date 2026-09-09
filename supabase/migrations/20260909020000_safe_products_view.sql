-- Verified safe products — an ACCURACY-FIRST recommendation surface.
--
-- There is no hand-curated product list anywhere in HealthRepo. This view and
-- the companion search function derive "safe products" purely from real scan
-- data: a product only appears once it has actually been scanned and scored
-- well (overall_score >= 75 AND compliance_status = 'compliant').
--
-- scanned_products is behind per-user RLS, so — exactly like public.product_search
-- — this is a definer view (security_invoker = false, the default): SELECTs run
-- with the view owner's rights and are NOT filtered by the underlying RLS, which
-- is what lets every visitor discover products other people verified. It exposes
-- no personal columns (no user_id, no raw OCR text).

-- View that automatically surfaces safe products from real scan data
CREATE OR REPLACE VIEW public.verified_safe_products AS
SELECT
  sp.id,
  sp.product_name,
  sp.brand,
  sp.category,
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

-- Allow anyone to read this view (it only shows safe products, no user data)
GRANT SELECT ON public.verified_safe_products TO anon, authenticated;

-- Also create a function to search safe products with filters
CREATE OR REPLACE FUNCTION public.search_safe_products(
  search_query text DEFAULT '',
  category_filter text DEFAULT '',
  min_score integer DEFAULT 75
)
RETURNS TABLE (
  id uuid,
  product_name text,
  brand text,
  category text,
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
  GROUP BY sp.id, sp.product_name, sp.brand, sp.category, sp.image_url,
           sp.overall_score, sp.compliance_status, sp.ingredient_analysis, sp.scanned_at
  ORDER BY sp.overall_score DESC
  LIMIT 50;
$$;

comment on function public.search_safe_products is
  'Filtered search over verified safe products (score + compliance + text + category). SECURITY DEFINER: reads across users but returns no personal columns.';

GRANT EXECUTE ON FUNCTION public.search_safe_products TO anon, authenticated;
