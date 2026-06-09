-- Adds a subscription_tier column to profiles so the rate limiter can
-- distinguish Premium ($4.99 / 30-per-month) from Pro ($9.99 / 75-per-month).
--
-- The existing subscription_status column tells us if an account IS paying
-- (active / past_due / canceled / free / incomplete) — orthogonal axis.
-- Together: an account with status='active' + tier='pro' gets the Pro cap.
--
-- Default 'free' for every existing row. The webhook maps Stripe price IDs
-- to tier values; checkout creates rows with tier set on success.

alter table public.profiles
  add column if not exists subscription_tier text default 'free'
    check (subscription_tier in ('free', 'premium', 'pro'));

comment on column public.profiles.subscription_tier is
  'Which paid tier the account is on. Free / Premium ($4.99, 30/mo) / Pro ($9.99, 75/mo, 15 pets, priority queue, vet PDFs). Set by the Stripe webhook from the price ID.';

-- Backfill — every existing active subscriber is Premium until proven
-- otherwise (we just shipped Pro). Stripe webhook on next billing cycle
-- will update if they upgrade.
update public.profiles
  set subscription_tier = 'premium'
  where subscription_status = 'active'
    and (subscription_tier is null or subscription_tier = 'free');
