-- ─────────────────────────────────────────────────────────────────────────────
-- PetTranslator.ai — initial schema (0001)
-- Generated from mvp_architecture.md §3.
-- Run this once in the Supabase SQL Editor.
-- Idempotent: safe to re-run; uses IF NOT EXISTS / CREATE OR REPLACE everywhere.
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- profiles — extends auth.users with app-level data + Stripe subscription status
-- ============================================================================
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  created_at             timestamptz default now(),
  stripe_customer_id     text unique,
  subscription_status    text default 'free' check (subscription_status in ('free','active','canceled','past_due','incomplete')),
  subscription_tier      text check (subscription_tier in ('premium_monthly','premium_annual')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean default false
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- pet_profiles — user's pets (one user → many pets)
-- ============================================================================
create table if not exists public.pet_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text,
  species           text check (species in ('dog','cat')),
  approximate_age   text check (approximate_age in ('puppy','adult','senior')),
  breed             text,
  created_at        timestamptz default now()
);

create index if not exists idx_pet_profiles_user_id on public.pet_profiles (user_id);

-- ============================================================================
-- analyses — each AI behavior analysis (per system_prompt_v1)
-- ============================================================================
create table if not exists public.analyses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  pet_id              uuid references public.pet_profiles(id) on delete set null,
  storage_path        text not null,
  user_context        text,
  status              text not null default 'pending' check (status in ('pending','processing','complete','failed','refused')),
  result_json         jsonb,
  refusal_code        text,
  prompt_version      text not null,
  model               text not null,
  inference_cost_usd  numeric(10,6),
  duration_ms         integer,
  created_at          timestamptz default now(),
  completed_at        timestamptz
);

create index if not exists idx_analyses_user_id_created
  on public.analyses (user_id, created_at desc);
create index if not exists idx_analyses_status_pending
  on public.analyses (status) where status in ('pending','processing');

-- ============================================================================
-- usage_daily — free-tier rate limit counter per logged-in user
-- ============================================================================
create table if not exists public.usage_daily (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  date            date not null,
  analyses_count  integer not null default 0,
  primary key (user_id, date)
);

-- ============================================================================
-- anon_usage_daily — pre-signup free analyses tracked by fingerprint
-- ============================================================================
create table if not exists public.anon_usage_daily (
  fingerprint_hash text not null,
  date             date not null,
  analyses_count   integer not null default 0,
  primary key (fingerprint_hash, date)
);

-- ============================================================================
-- analysis_jobs — simple queue table, picked up by Vercel cron
-- ============================================================================
create table if not exists public.analysis_jobs (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null unique references public.analyses(id) on delete cascade,
  status        text not null default 'queued' check (status in ('queued','in_flight','done','dead')),
  attempts      integer not null default 0,
  last_error    text,
  created_at    timestamptz default now(),
  picked_at     timestamptz,
  completed_at  timestamptz
);

create index if not exists idx_analysis_jobs_status_created
  on public.analysis_jobs (status, created_at);

-- ============================================================================
-- ROW LEVEL SECURITY — users can only see / modify their own data
-- ============================================================================

-- profiles
alter table public.profiles enable row level security;
drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- pet_profiles
alter table public.pet_profiles enable row level security;
drop policy if exists "pet_profiles_self_all" on public.pet_profiles;
create policy "pet_profiles_self_all" on public.pet_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- analyses (read-only for users; writes go via service_role from API routes)
alter table public.analyses enable row level security;
drop policy if exists "analyses_self_select" on public.analyses;
create policy "analyses_self_select" on public.analyses
  for select using (auth.uid() = user_id);

-- usage_daily — same pattern (read-only for users)
alter table public.usage_daily enable row level security;
drop policy if exists "usage_daily_self_select" on public.usage_daily;
create policy "usage_daily_self_select" on public.usage_daily
  for select using (auth.uid() = user_id);

-- analysis_jobs + anon_usage_daily — service-role only (no policies = denied by default)
alter table public.analysis_jobs enable row level security;
alter table public.anon_usage_daily enable row level security;

-- ============================================================================
-- DONE. Verify in dashboard:
--   - Database → Tables shows: profiles, pet_profiles, analyses, usage_daily, anon_usage_daily, analysis_jobs
--   - Authentication → Policies shows the RLS rules above
-- ============================================================================
