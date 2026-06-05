-- 0003_testers.sql
-- Tester access flag for influencer / vet / QA outreach.
--
-- When `profiles.is_tester = true` AND (tester_expires_at is NULL OR > now()),
-- the rate-limit layer in ratelimit.ts short-circuits and treats the account
-- as Premium-tier (no free-tier cap, no daily cap). The global daily ceiling
-- still applies — testers cannot bring down the whole site.
--
-- Set tester_expires_at = NULL for permanent access (vet partners, major
-- creators promised "permanent free Pro" per influencer_brief.md).
-- Set to a future timestamp for time-limited testing (default trial period).
--
-- The note field is human-readable context — fill it in so you remember why
-- this account is flagged ("ChatGPT QA", "Influencer @jacksongalaxy", etc.).

alter table public.profiles
  add column if not exists is_tester           boolean      not null default false,
  add column if not exists tester_granted_at   timestamptz,
  add column if not exists tester_expires_at   timestamptz,
  add column if not exists tester_note         text;

-- Partial index — only rows where is_tester=true are indexed, keeps it tiny
-- and fast for the rate-limit lookup.
create index if not exists idx_profiles_is_tester
  on public.profiles (id)
  where is_tester = true;

comment on column public.profiles.is_tester is
  'When true (and tester_expires_at is null or in future), bypasses all free-tier limits in ratelimit.ts. Use for influencer/vet/QA access.';

comment on column public.profiles.tester_expires_at is
  'NULL = permanent tester access. Set to a future timestamp for time-limited testing.';

comment on column public.profiles.tester_note is
  'Human-readable context: "ChatGPT QA", "Influencer @handle", "Vet beta", etc.';

-- Convenience function: grant tester access by email in one call.
-- Use from Supabase SQL editor:
--   select public.grant_tester_access('test@example.com', '30 days', 'ChatGPT QA');
--   select public.grant_tester_access('vet@example.com', NULL, 'Vet partner');  -- permanent
create or replace function public.grant_tester_access(
  p_email     text,
  p_duration  interval,
  p_note      text default null
) returns table (id uuid, email text, is_tester boolean, tester_expires_at timestamptz) as $$
  with target as (
    select p.id from public.profiles p where lower(p.email) = lower(p_email) limit 1
  )
  update public.profiles
    set is_tester         = true,
        tester_granted_at = now(),
        tester_expires_at = case when p_duration is null then null else now() + p_duration end,
        tester_note       = p_note
    where profiles.id = (select id from target)
    returning profiles.id, profiles.email, profiles.is_tester, profiles.tester_expires_at;
$$ language sql security definer;

revoke all on function public.grant_tester_access(text, interval, text) from public, anon, authenticated;
-- Only the service role can call this. Run from Supabase Dashboard SQL editor (which uses service role).

-- Convenience: revoke tester access in one call.
create or replace function public.revoke_tester_access(p_email text)
returns table (id uuid, email text, is_tester boolean) as $$
  update public.profiles
    set is_tester         = false,
        tester_expires_at = null,
        tester_note       = null
    where lower(profiles.email) = lower(p_email)
    returning profiles.id, profiles.email, profiles.is_tester;
$$ language sql security definer;

revoke all on function public.revoke_tester_access(text) from public, anon, authenticated;
