-- Adds processing_priority to analyses so the cron job sweeper can drain
-- queued/orphaned analyses in the order paying customers expect:
--   Pro     →  10   (highest)
--   Premium →  50
--   Tester  →  50
--   Free    → 100   (lowest)
--
-- The hot path (POST /api/analyze) is still synchronous, so for normal
-- traffic priority never matters — every request gets its own Vercel
-- function and finishes in 6-15s. Priority kicks in when:
--   1. An analyze function times out (>60s) and the cron sweeper picks
--      it up to retry.
--   2. The global daily ceiling is hit and we want to fairly drain
--      held-back jobs once a new day rolls in.
--   3. A future async-queue refactor (Edge Functions or BullMQ) can use
--      this column unchanged.
--
-- Smaller number = higher priority — matches PostgreSQL ORDER BY default.

alter table public.analyses
  add column if not exists processing_priority integer not null default 100
    check (processing_priority between 0 and 1000);

comment on column public.analyses.processing_priority is
  'Lower = higher priority. Pro=10, Premium/Tester=50, Free=100. Used by /api/cron/process-jobs to drain in tier-fair order.';

-- Backfill existing rows by current subscription_tier so Pro subscribers
-- get correct treatment on already-pending analyses. Joins against
-- profiles where the subscription_tier column lives (added in 0005).
update public.analyses a
  set processing_priority = case
    when p.subscription_status = 'active' and p.subscription_tier = 'pro' then 10
    when p.subscription_status = 'active' and p.subscription_tier = 'premium' then 50
    when p.is_tester then 50
    else 100
  end
  from public.profiles p
  where a.user_id = p.id
    and a.status in ('pending', 'processing');

-- Index to make the priority-ordered sweeper query cheap.
create index if not exists analyses_priority_pending_idx
  on public.analyses (processing_priority, created_at)
  where status in ('pending', 'processing');
