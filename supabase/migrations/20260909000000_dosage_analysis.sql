-- Additive dosage / FSSAI prescribed-limit analysis.
--
-- /api/analyze now returns a `dosage_analysis` block (additive counts, per-additive
-- FSSAI limit checks, cumulative risk, daily-intake guidance and combination
-- warnings). Persist it alongside the rest of the scan so the product detail page
-- and the FSSAI complaint builder can use it.

alter table public.scanned_products
  add column if not exists dosage_analysis jsonb not null default '{}'::jsonb;

comment on column public.scanned_products.dosage_analysis is
  'Additive dosage analysis from /api/analyze: additive_count, limit_checks[], cumulative_risk, daily_intake_warning, combination_warnings[].';
