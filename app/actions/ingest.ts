"use server";

import { z } from "zod";

import { deductCredits } from "@/lib/credits/deduct";
import {
  IngestError,
  type IngestErrorCode,
  userMessageFor,
} from "@/lib/errors";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { JobMetadata, JobRow } from "@/lib/supabase/types";
import { downloadAndUpload } from "@/lib/youtube/download";
import { fetchMetadata } from "@/lib/youtube/metadata";
import { parseYouTubeUrl } from "@/lib/youtube/validate";

// NOTE: child_process + fs require the Node.js runtime (not Edge). A "use server"
// module may only export async functions, so the `runtime = "nodejs"` segment
// config is declared on the consuming route (app/ingest/page.tsx) instead.

export type FormState =
  | { status: "idle" }
  | {
      status: "success";
      jobId: string;
      title: string;
      durationSeconds?: number;
    }
  | { status: "error"; code: IngestErrorCode; message: string };

const schema = z.object({
  youtubeUrl: z
    .string({ required_error: "URL을 입력해 주세요." })
    .trim()
    .min(1, "URL을 입력해 주세요."),
});

function errorState(code: IngestErrorCode): FormState {
  return { status: "error", code, message: userMessageFor(code) };
}

export async function submitYoutubeUrl(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. Validate raw input shape.
  const parsed = schema.safeParse({ youtubeUrl: formData.get("youtubeUrl") });
  if (!parsed.success) {
    return errorState("VALIDATION");
  }

  // 2. Validate the YouTube URL and extract the video id.
  const match = parseYouTubeUrl(parsed.data.youtubeUrl);
  if (!match) {
    return errorState("INVALID_URL");
  }
  const url = parsed.data.youtubeUrl;
  const { videoId } = match;

  const supabase = getServiceRoleClient();

  // 3. Best-effort metadata (non-fatal).
  const meta = await fetchMetadata(url, videoId);
  const initialMetadata: JobMetadata = {
    title: meta.title || undefined,
    durationSeconds: meta.durationSeconds,
    thumbnailUrl: meta.thumbnailUrl,
  };

  // 4. Create the job row (status=queued).
  // TODO(auth): user_id is null until authentication is introduced.
  const userId: string | null = null;

  const { data: inserted, error: insertError } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      youtube_url: url,
      status: "queued",
      metadata: initialMetadata,
    })
    .select()
    .single<JobRow>();

  if (insertError || !inserted) {
    return errorState("DB_ERROR");
  }

  const jobId = inserted.id;

  try {
    // TODO(c1): 크레딧 차감 연동 지점 — 다운로드 시작 전에 크레딧을 차감한다.
    await deductCredits(userId, 1);

    // 5. Mark downloading.
    await supabase
      .from("jobs")
      .update({ status: "downloading" })
      .eq("id", jobId);

    // 6. Download via yt-dlp and stream-upload to Storage.
    const result = await downloadAndUpload({ url, jobId, videoId });

    // 7. Mark uploaded with the resulting storage path.
    await supabase
      .from("jobs")
      .update({ status: "uploaded", video_path: result.videoPath })
      .eq("id", jobId);

    return {
      status: "success",
      jobId,
      title: meta.title,
      durationSeconds: meta.durationSeconds,
    };
  } catch (err) {
    const code: IngestErrorCode =
      err instanceof IngestError ? err.code : "DOWNLOAD_FAILED";
    const message = err instanceof Error ? err.message : String(err);

    // 8. Persist failure on the job (status=failed + metadata.error).
    const failedMetadata: JobMetadata = {
      ...initialMetadata,
      error: { code, message: message.slice(0, 1000) },
    };
    await supabase
      .from("jobs")
      .update({ status: "failed", metadata: failedMetadata })
      .eq("id", jobId)
      .then(undefined, () => {
        /* swallow secondary failure — original error is what matters */
      });

    return errorState(code);
  }
}
