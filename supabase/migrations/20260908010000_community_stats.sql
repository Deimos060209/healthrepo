-- Community impact counters for the home page.
--
-- scanned_products and complaints are both behind per-user RLS ("view your
-- own..."), so a client query counts only the caller's own rows — useless for a
-- community total, and there is no public view over complaints at all.
--
-- This SECURITY DEFINER function is the read surface: it runs with the owner's
-- rights so it can see every row, but it returns ONLY three aggregate numbers.
-- No row, no user id, and no product detail can be recovered through it.

create or replace function public.community_stats()
returns table (
  products_scanned bigint,
  harmful_found    bigint,
  complaints_filed bigint
)
language sql
security definer
-- Pinned search_path: required for SECURITY DEFINER so the body cannot be
-- hijacked by a caller-controlled search_path.
set search_path = public, pg_temp
stable
as $$
  select
    (select count(*) from public.scanned_products),

    -- Products where at least one analysed ingredient came back harmful or
    -- banned. ingredient_analysis defaults to '{}'::jsonb (an OBJECT), and
    -- jsonb_array_elements() errors on a non-array, so the type guard below is
    -- load-bearing for rows that were never analysed.
    (select count(*)
       from public.scanned_products p
      where jsonb_typeof(p.ingredient_analysis) = 'array'
        and exists (
          select 1
            from jsonb_array_elements(p.ingredient_analysis) as e
           where e ->> 'safety_status' in ('harmful', 'banned')
        )),

    (select count(*) from public.complaints);
$$;

comment on function public.community_stats() is
  'Aggregate-only community counters for the landing page. SECURITY DEFINER by design: returns counts, never rows.';

revoke all on function public.community_stats() from public;
grant execute on function public.community_stats() to anon, authenticated;
