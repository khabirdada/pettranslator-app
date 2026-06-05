-- 0002_lifetime_pricing.sql
-- Pricing model migration: 3 lifetime free + 30/month Premium
-- (PROD APPLIES this AFTER the testers migration; that ordering is fine
-- because there are no cross-dependencies — both are additive.)
--
-- Locked pricing as of June 2026:
--   Free:    3 analyses LIFETIME (not per day)
--   Premium: $4.99/mo or $39.99/yr (33% annual discount) — 30 analyses/month
--   Power:   (future) $14.99/mo or $119.99/yr — 150/month — only ship if ≥10%
--            of Premium subs hit the 30/mo cap.
--
-- This migration is ADDITIVE ONLY. It:
--   1. Adds billing columns to profiles (provider-agnostic; PayPal at launch,
--      Stripe in v1.x).
--   2. Adds current_period_start to anchor the "this month" calculation
--      for Premium rate-limiting.
--   3. Marks the legacy usage_daily / anon_usage_daily tables DEPRECATED
--      (via comment) — does NOT drop them, in case there's in-flight state.
--
-- The actual rate-limit logic in ratelimit.ts counts rows in the analyses
-- table directly; no explicit counter columns required. This keeps the
-- schema simple and the counters always consistent.

alter table public.profiles
  add column if not exists payment_provider       text
    check (payment_provider in ('paypal', 'stripe')),
  add column if not exists paypal_subscription_id text unique,
  add column if not exists paypal_payer_id        text,
  add column if not exists current_period_start   timestamptz;

comment on column public.profiles.payment_provider is
  'Which billing system owns this subscription. paypal at launch; stripe migration in v1.x.';

comment on column public.profiles.paypal_subscription_id is
  'PayPal Subscriptions API subscription_id (I-XXXXXXX format). Unique. NULL until first paid sub.';

comment on column public.profiles.current_period_start is
  'Set by billing webhook on each renewal. Anchors the "this month" window for the 30-analyses-per-period cap. NULL for free-tier users.';

-- Legacy tables: mark deprecated. Do NOT drop — keeps in-flight state safe.
-- Production rate-limit logic no longer reads from these.
comment on table public.usage_daily is
  'DEPRECATED (v1.2+). Replaced by row-counting in public.analyses. Free tier is now 3 LIFETIME (not per-day), Premium is 30/MONTH counted from current_period_start. Safe to drop after 60 days of no reads.';

comment on table public.anon_usage_daily is
  'DEPRECATED (v1.2+). Anonymous uploads not currently supported (auth required). Reintroduce + replace this with anon_lifetime_usage when/if anon-uploads ship.';

-- Lock in the new subscription_tier values via comment (no constraint to avoid
-- breaking existing rows; ratelimit.ts is the runtime check).
comment on column public.profiles.subscription_tier is
  'Valid values (June 2026 pricing): null | premium_monthly | premium_annual | power_monthly | power_annual. Power tiers reserved for v1.1+; do not create Stripe/PayPal products until usage data demands it.';
