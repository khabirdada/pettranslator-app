-- Adds frame_paths text[] to analyses so a single row can reference the
-- 5 frame JPEGs extracted from a user's video. Single-image analyses
-- continue to use the existing storage_path column unchanged.
--
-- We deliberately keep storage_path nullable rather than collapsing both
-- columns into one — that way the existing image flow doesn't need any
-- DB-write changes, and a quick `where frame_paths is not null` query
-- isolates video analyses for usage analytics.

alter table public.analyses
  add column if not exists frame_paths text[];

comment on column public.analyses.frame_paths is
  'For video analyses: ordered list of Supabase Storage paths to the extracted JPEG frames (5 frames evenly spaced across the source video). NULL for single-image analyses (which use storage_path instead).';

-- Index for the analytics query "show me all video analyses" — only
-- non-null rows hit the index, so it stays tiny.
create index if not exists analyses_frame_paths_present_idx
  on public.analyses ((frame_paths is not null))
  where frame_paths is not null;
