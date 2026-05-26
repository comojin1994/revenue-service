-- Migration: transcription stage support (Issue #3).
-- Adds the `transcribing`/`transcribed` job states, transcript storage columns,
-- and the private `transcripts` Storage bucket. Builds on the `jobs` table from
-- 20260526000000_create_jobs.sql.

-- 1. Extend the status CHECK to allow the transcription states.
-- The original constraint is an inline column CHECK, which Postgres names
-- `jobs_status_check` by default.
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in (
    'queued',
    'downloading',
    'uploaded',
    'transcribing',
    'transcribed',
    'failed'
  ));

-- 2. Transcript storage columns (1 job : 1 transcript). Nullable until a job
-- reaches the transcribed state.
alter table public.jobs add column if not exists transcript_text text;
alter table public.jobs add column if not exists srt_path text;

-- 3. Private storage bucket for generated SRT transcripts. Idempotent insert.
insert into storage.buckets (id, name, public)
values ('transcripts', 'transcripts', false)
on conflict (id) do nothing;

-- TODO(auth): add storage RLS policies on storage.objects scoped to the
-- owning user once authentication is introduced. For now only the
-- service-role key can write to the private `transcripts` bucket.
