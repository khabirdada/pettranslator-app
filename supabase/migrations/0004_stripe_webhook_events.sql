-- Stripe webhook event log — used as the idempotency key for the
-- /api/billing/webhook handler. Stripe re-delivers events on network
-- retries and on our 5xx responses; without this table we'd double-
-- process subscription state on every retry.
--
-- We insert the event id on receipt; the unique constraint on `id`
-- rejects duplicates with code 23505, which the handler treats as
-- "already processed, acknowledge with 200".
--
-- Row payload is intentionally tiny (id + type + ts). The full event
-- is always retrievable from Stripe via the Events API for the next
-- 30 days if we need to forensically replay.

create table if not exists public.stripe_webhook_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- RLS off — only the service role writes here from the webhook handler.
alter table public.stripe_webhook_events disable row level security;

-- Auto-purge events older than 90 days. Storage cost is trivial but
-- bounded growth is cleaner. Run via the existing cron sweeper or
-- Supabase's pg_cron — for now a manual `delete` is fine.
comment on table public.stripe_webhook_events is
  'Idempotency log for /api/billing/webhook. Auto-purge >90d when cron lands.';
