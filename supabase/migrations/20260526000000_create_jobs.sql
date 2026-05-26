-- Migration: create the `jobs` table for the YouTube ingestion pipeline.
-- Entry point for the repurposing pipeline: each submitted YouTube URL
-- becomes one row whose status advances queued -> downloading -> uploaded,
-- or transitions to failed on error.

create extension if not exists "pgcrypto";

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  youtube_url text not null,
  status text not null default 'queued'
    check (status in ('queued', 'downloading', 'uploaded', 'failed')),
  video_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists jobs_user_id_idx on public.jobs (user_id);
create index if not exists jobs_status_idx on public.jobs (status);

-- Row Level Security is enabled now so the table is locked down by default.
alter table public.jobs enable row level security;

-- TODO(auth): Real authentication is out of scope for this issue. user_id is
-- currently nullable/placeholder. When auth lands, replace the comment below
-- with user_id-scoped policies, e.g.:
--
--   create policy "jobs_select_own" on public.jobs
--     for select using (auth.uid() = user_id);
--   create policy "jobs_insert_own" on public.jobs
--     for insert with check (auth.uid() = user_id);
--
-- Until then, only the service-role key (which bypasses RLS) can read/write
-- this table, which matches the current server-action-only access pattern.

-- Private storage bucket for downloaded videos. Idempotent insert.
insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

-- TODO(auth): add storage RLS policies on storage.objects scoped to the
-- owning user once authentication is introduced. For now only the
-- service-role key can write to the private `videos` bucket.
