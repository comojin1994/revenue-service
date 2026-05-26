import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getServiceRoleClient,
  getStorageBucket,
  getTranscriptsBucket,
} from "@/lib/supabase/server";

import { extractAndChunkAudio } from "./chunk";
import { TranscriptionError } from "./errors";
import { type ChunkResult, mergeChunkResults } from "./merge";
import { segmentsToSrt } from "./srt";
import { transcribeChunk, withRetry } from "./whisper";

/**
 * Core transcription orchestrator (no DB status writes — those live in the
 * server action). Downloads the source video from Storage, extracts + chunks
 * audio with ffmpeg, transcribes each chunk via Whisper (with retry), merges
 * the offset-corrected segments, renders SRT, and uploads it to the
 * `transcripts` bucket. The temp working directory is always removed (NFR-2).
 */

export interface TranscribeJobInput {
  jobId: string;
  /** Storage object path of the source video (jobs.video_path). */
  videoPath: string;
  /** YouTube video id, used for the SRT object name. */
  videoId: string;
}

export interface TranscribeJobResult {
  transcriptText: string;
  srtPath: string;
  segmentCount: number;
}

function videoFileNameFrom(videoPath: string, videoId: string): string {
  const base = videoPath.split("/").pop() ?? `${videoId}.mp4`;
  return base.includes(".") ? base : `${videoId}.mp4`;
}

export async function transcribeJobCore(
  input: TranscribeJobInput,
): Promise<TranscribeJobResult> {
  const { jobId, videoPath, videoId } = input;

  const supabase = getServiceRoleClient();
  const videosBucket = getStorageBucket();
  const transcriptsBucket = getTranscriptsBucket();

  const workDir = await mkdtemp(join(tmpdir(), `transcribe-${jobId}-`));

  try {
    // 1. Download the source video from Storage to a temp file on disk.
    const { data: blob, error: downloadError } = await supabase.storage
      .from(videosBucket)
      .download(videoPath);

    if (downloadError || !blob) {
      throw new TranscriptionError(
        "STORAGE_DOWNLOAD_FAILED",
        `Failed to download video from Storage: ${
          downloadError?.message ?? "no data"
        }`,
        { cause: downloadError ?? undefined },
      );
    }

    const localVideoPath = join(workDir, videoFileNameFrom(videoPath, videoId));
    // Supabase returns a Blob; write it to disk. (Storage SDK does not expose a
    // Node stream here; the video lives on disk only transiently — NFR-1.)
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(localVideoPath, Buffer.from(arrayBuffer));

    // 2. Extract audio and split into Whisper-sized chunks.
    const chunks = await extractAndChunkAudio(localVideoPath, workDir);

    // 3. Transcribe each chunk in order, with retry, tagging the offset.
    const chunkResults: ChunkResult[] = [];
    for (const chunk of chunks) {
      const raw = await withRetry(() => transcribeChunk(chunk.path));
      chunkResults.push({
        offsetSec: chunk.offsetSec,
        text: raw.text,
        segments: raw.segments,
      });
    }

    // 4. Offset-correct + merge into a single global transcript.
    const { text, segments } = mergeChunkResults(chunkResults);

    // 5. Render SRT and upload to the transcripts bucket (upsert — NFR-7).
    const srt = segmentsToSrt(segments);
    const srtPath = `${jobId}/${videoId}.srt`;

    const { error: uploadError } = await supabase.storage
      .from(transcriptsBucket)
      .upload(srtPath, Buffer.from(srt, "utf-8"), {
        contentType: "application/x-subrip",
        upsert: true,
      });

    if (uploadError) {
      throw new TranscriptionError(
        "TRANSCRIBE_UPLOAD_FAILED",
        `Failed to upload SRT to Storage: ${uploadError.message}`,
        { cause: uploadError },
      );
    }

    return {
      transcriptText: text,
      srtPath,
      segmentCount: segments.length,
    };
  } finally {
    // Always clean up the temp dir (success or failure) — NFR-2.
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
  }
}
