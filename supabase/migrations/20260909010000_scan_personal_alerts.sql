-- Product-level personalised alerts for a scan.
--
-- /api/analyze returns `personal_alerts` — flags that apply to the whole
-- product rather than one ingredient (e.g. "high sodium — risky with
-- hypertension"). Ingredient-specific personal flags already ride along inside
-- `ingredient_analysis`; this column stores the product-level ones so the
-- history detail page and its PDF can reproduce the personalised section.

alter table public.scanned_products
  add column if not exists personal_alerts jsonb not null default '[]'::jsonb;

comment on column public.scanned_products.personal_alerts is
  'Product-level personalised alerts from /api/analyze: array of { ingredient, reason, severity }.';
