/**
 * Shared types for the `jobs` table and Supabase storage.
 * Mirrors supabase/migrations/<ts>_create_jobs.sql.
 */

export type JobStatus =
  | "queued"
  | "downloading"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "failed";

export interface JobErrorMeta {
  code: string;
  message: string;
}

export interface JobMetadata {
  title?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  error?: JobErrorMeta;
  // Arbitrary additional fields (e.g. raw provider metadata) are allowed.
  [key: string]: unknown;
}

export interface JobRow {
  id: string;
  user_id: string | null;
  youtube_url: string;
  status: JobStatus;
  video_path: string | null;
  transcript_text: string | null;
  srt_path: string | null;
  metadata: JobMetadata;
  created_at: string;
}

/** Columns required to insert a new job. */
export interface JobInsert {
  user_id?: string | null;
  youtube_url: string;
  status?: JobStatus;
  video_path?: string | null;
  transcript_text?: string | null;
  srt_path?: string | null;
  metadata?: JobMetadata;
}
