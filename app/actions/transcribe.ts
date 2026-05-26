"use server";

import {
  TranscriptionError,
  type TranscriptionErrorCode,
  userMessageFor,
} from "@/lib/transcription/errors";
import { transcribeJobCore } from "@/lib/transcription/transcribe";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { JobMetadata, JobRow } from "@/lib/supabase/types";
import { parseYouTubeUrl } from "@/lib/youtube/validate";

// NOTE: this action drives a pipeline that uses child_process/fs (ffmpeg) and
// must run on the Node.js runtime. A "use server" module may only export async
// functions, so `runtime = "nodejs"` is declared on the consuming route.

export type TranscribeState =
  | { status: "idle" }
  | {
      status: "success";
      jobId: string;
      srtPath: string;
      segmentCount: number;
    }
  | { status: "error"; code: TranscriptionErrorCode; message: string };

function errorState(code: TranscriptionErrorCode): TranscribeState {
  return { status: "error", code, message: userMessageFor(code) };
}

/**
 * Transcribe an uploaded job: guard state, advance uploaded -> transcribing,
 * run the core orchestrator, then persist transcript_text/srt_path and
 * transcribed. On failure the job moves to failed with metadata.error.
 */
export async function transcribeJob(jobId: string): Promise<TranscribeState> {
  const supabase = getServiceRoleClient();

  // 1. Load the job.
  const { data: job, error: loadError } = await supabase
    .from("jobs")
    .select("id, status, video_path, youtube_url, metadata")
    .eq("id", jobId)
    .single<
      Pick<
        JobRow,
        "id" | "status" | "video_path" | "youtube_url" | "metadata"
      >
    >();

  if (loadError || !job) {
    return errorState("JOB_NOT_TRANSCRIBABLE");
  }

  // 2. Guard: only uploaded jobs with a stored video can be transcribed.
  if (job.status !== "uploaded" || !job.video_path) {
    return errorState("JOB_NOT_TRANSCRIBABLE");
  }

  // 3. Re-derive the video id from the original URL (falls back to the
  //    storage filename if parsing fails).
  const match = parseYouTubeUrl(job.youtube_url);
  const videoId =
    match?.videoId ??
    (job.video_path.split("/").pop()?.split(".")[0] || jobId);

  const baseMetadata: JobMetadata = job.metadata ?? {};

  // 4. Advance to transcribing.
  await supabase
    .from("jobs")
    .update({ status: "transcribing" })
    .eq("id", jobId);

  try {
    const result = await transcribeJobCore({
      jobId,
      videoPath: job.video_path,
      videoId,
    });

    // 5. Persist the transcript and mark transcribed.
    await supabase
      .from("jobs")
      .update({
        status: "transcribed",
        transcript_text: result.transcriptText,
        srt_path: result.srtPath,
      })
      .eq("id", jobId);

    return {
      status: "success",
      jobId,
      srtPath: result.srtPath,
      segmentCount: result.segmentCount,
    };
  } catch (err) {
    const code: TranscriptionErrorCode =
      err instanceof TranscriptionError ? err.code : "WHISPER_API_FAILED";
    const message = err instanceof Error ? err.message : String(err);

    // 6. Persist failure (status=failed + metadata.error), swallowing any
    //    secondary update failure — the original error is what matters.
    const failedMetadata: JobMetadata = {
      ...baseMetadata,
      error: { code, message: message.slice(0, 1000) },
    };
    await supabase
      .from("jobs")
      .update({ status: "failed", metadata: failedMetadata })
      .eq("id", jobId)
      .then(undefined, () => {
        /* swallow secondary failure */
      });

    return errorState(code);
  }
}
