-- HealthRepo initial schema
-- Tables: profiles, scanned_products, complaints
-- Includes Row Level Security so every user can only read/write their own rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  email      text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Public profile data, one row per auth user.';

-- Automatically create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- scanned_products
-- ---------------------------------------------------------------------------
create table if not exists public.scanned_products (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  product_name          text not null,
  brand                 text,
  category              text not null,          -- snacks, beverages, dairy, personal_care, etc.
  image_url             text,
  extracted_text        text,                   -- raw OCR text
  compliance_status     text check (compliance_status in ('compliant', 'non_compliant', 'partial')),
  compliance_details    jsonb not null default '{}'::jsonb,   -- detailed compliance check results
  ingredient_analysis   jsonb not null default '{}'::jsonb,   -- harmful ingredients analysis
  healthier_alternatives jsonb not null default '[]'::jsonb,  -- suggested alternatives
  overall_score         integer check (overall_score between 0 and 100),  -- safety score 0-100
  scanned_at            timestamptz not null default now()
);

comment on table public.scanned_products is 'One row per product a user has photographed and analysed.';

create index if not exists scanned_products_user_id_idx
  on public.scanned_products (user_id);
create index if not exists scanned_products_user_scanned_at_idx
  on public.scanned_products (user_id, scanned_at desc);
create index if not exists scanned_products_category_idx
  on public.scanned_products (category);
create index if not exists scanned_products_compliance_status_idx
  on public.scanned_products (compliance_status);

-- ---------------------------------------------------------------------------
-- complaints
-- ---------------------------------------------------------------------------
create table if not exists public.complaints (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  product_id     uuid not null references public.scanned_products (id) on delete cascade,
  complaint_type text not null check (complaint_type in ('compliance', 'ingredients')),
  status         text not null default 'drafted'
                   check (status in ('drafted', 'submitted', 'redirected')),
  complaint_data jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.complaints is 'Consumer complaints drafted or filed against a scanned product.';

create index if not exists complaints_user_id_idx
  on public.complaints (user_id);
create index if not exists complaints_product_id_idx
  on public.complaints (product_id);
create index if not exists complaints_user_status_idx
  on public.complaints (user_id, status);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.scanned_products  enable row level security;
alter table public.complaints        enable row level security;

-- profiles: a user may only see and edit their own profile.
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can delete their own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- scanned_products: full CRUD limited to the owning user.
create policy "Users can view their own scanned products"
  on public.scanned_products for select
  using (auth.uid() = user_id);

create policy "Users can insert their own scanned products"
  on public.scanned_products for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own scanned products"
  on public.scanned_products for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own scanned products"
  on public.scanned_products for delete
  using (auth.uid() = user_id);

-- complaints: full CRUD limited to the owning user.
create policy "Users can view their own complaints"
  on public.complaints for select
  using (auth.uid() = user_id);

create policy "Users can insert their own complaints"
  on public.complaints for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own complaints"
  on public.complaints for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own complaints"
  on public.complaints for delete
  using (auth.uid() = user_id);
