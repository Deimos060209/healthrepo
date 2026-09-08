-- Personal health profile, one row per user.
--
-- Drives the "Personalized alerts" feature: the scan flow sends this profile to
-- /api/analyze, and Claude flags any ingredient that conflicts with the user's
-- allergies, diet, health conditions, or custom avoid-list — even ingredients
-- that are safe for the general population.

create table if not exists public.user_health_profiles (
  id                       uuid default gen_random_uuid() primary key,
  user_id                  uuid references auth.users (id) on delete cascade unique,
  allergies                text[] default '{}',   -- e.g. ['Nuts', 'Gluten', 'Dairy/Lactose']
  dietary_preferences      text[] default '{}',   -- e.g. ['No sugar', 'Vegan', 'No palm oil']
  health_conditions        text[] default '{}',   -- e.g. ['Diabetic', 'Hypertension (high BP)', 'Pregnant']
  custom_avoid_ingredients text[] default '{}',   -- free text, e.g. ['palm oil', 'gelatin', 'carmine']
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

comment on table public.user_health_profiles is
  'Per-user dietary criteria and health conditions used to personalise ingredient analysis.';

create index if not exists user_health_profiles_user_id_idx
  on public.user_health_profiles (user_id);

alter table public.user_health_profiles enable row level security;

create policy "Users can view own profile"
  on public.user_health_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.user_health_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.user_health_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own profile"
  on public.user_health_profiles for delete
  using (auth.uid() = user_id);
