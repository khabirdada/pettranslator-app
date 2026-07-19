-- Onboarding email state tracked per-user on profiles.
--
-- onboarding_stage — monotonic 0 → 4 counter, incremented as each
-- drip email sends. 0 = signup not yet touched, 4 = full sequence
-- complete. The cron sweeper checks (stage, created_at) to decide
-- who's due next. Never decrement — once an email has fired the
-- user should NEVER receive it again even if they hit some retry
-- path.
--
--   0: nothing sent
--   1: welcome email sent (day 0)
--   2: day-3 email sent
--   3: day-7 email sent
--   4: day-14 email sent (sequence complete)
--
-- email_opt_out — set to true when the user clicks their unsubscribe
-- link. The cron sweeper filters this out. All product transactional
-- email (analysis-complete, receipts, password reset) ignores this
-- flag — opt-out applies to marketing/drip only.

alter table public.profiles
  add column if not exists onboarding_stage integer not null default 0
    check (onboarding_stage between 0 and 4);

alter table public.profiles
  add column if not exists email_opt_out boolean not null default false;

comment on column public.profiles.onboarding_stage is
  '0 = untouched, 1 = welcome sent, 2 = day-3 sent, 3 = day-7 sent, 4 = day-14 sent (complete)';
comment on column public.profiles.email_opt_out is
  'Set true when user clicks unsubscribe link. Cron sweeper skips them. Transactional email ignores this flag.';

-- Partial index so the daily cron scan is O(pending users), not O(all users).
create index if not exists profiles_onboarding_pending_idx
  on public.profiles (created_at)
  where onboarding_stage < 4 and email_opt_out = false;
