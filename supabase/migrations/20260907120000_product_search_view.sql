-- Community-wide product search.
--
-- public.scanned_products is behind per-user RLS ("view your own scanned
-- products"), so users cannot search products other people have scanned.
-- This view is a read-only, NON-PERSONAL projection of that table — it drops
-- user_id and the raw OCR text — and, because it is a definer view
-- (security_invoker = false, the default), SELECTs through it run with the
-- view owner's rights and are not filtered by the underlying table's RLS.
--
-- Result: everyone can search everyone's scans; nobody gains access to the
-- personal columns or to write access.

create or replace view public.product_search
with (security_invoker = false) as
select
  id,
  product_name,
  brand,
  category,
  image_url,
  compliance_status,
  ingredient_analysis,
  overall_score,
  scanned_at
from public.scanned_products;

comment on view public.product_search is
  'Read-only, non-personal projection of scanned_products for community-wide search. Intentionally bypasses RLS for SELECT.';

grant select on public.product_search to anon, authenticated;
