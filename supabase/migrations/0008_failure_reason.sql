-- Adds failure_reason to analyses so every terminal "failed" state
-- carries a short diagnostic string. Without this, the 45%
-- completion-rate investigation on 2026-07-01 hit a wall — three
-- analyses were marked failed but no reason was recorded, so we
-- couldn't tell whether Anthropic 5xx'd, the JSON schema failed
-- to parse, the storage signing died, or the request threw
-- unexpectedly.
--
-- All catch/error branches in /api/analyze/route.ts and
-- /api/cron/process-jobs/route.ts now write a compact code like
-- "signed_url_failed: The resource was not found" or
-- "analyze_failed: anthropic_timeout" into this column.

alter table public.analyses
  add column if not exists failure_reason text
    check (failure_reason is null or char_length(failure_reason) <= 500);

comment on column public.analyses.failure_reason is
  'Short diagnostic string set only when status = failed. Format: "<stage>: <detail>". Cleared when a retry succeeds. Never exposed to end users.';

-- Partial index so future "why did this fail?" dashboards can filter
-- fast without a full-table scan.
create index if not exists analyses_failure_reason_idx
  on public.analyses (created_at desc)
  where status = 'failed' and failure_reason is not null;
