import { stat } from "node:fs/promises";
import { join } from "node:path";

import { probeDurationSec, runFfmpeg } from "./ffmpeg";

/**
 * Audio extraction + 25 MB-aware time-based chunking (FR-1, FR-2).
 *
 * The pure helpers (`safeChunkDurationSec`, `planChunks`) carry no I/O and are
 * unit tested in `chunk.test.ts`. The I/O functions (`extractAudio`,
 * `extractAndChunkAudio`) shell out to ffmpeg/ffprobe and write temp files into
 * the caller-provided workDir; cleanup is the caller's responsibility.
 */

/** OpenAI audio API hard limit per upload. */
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Bitrate (kbps) used for the extracted mono 16 kHz mp3. Low enough that a
 * single chunk holds a long span while staying well under the 25 MB limit.
 */
export const EXTRACT_BITRATE_KBPS = 48;

export interface AudioChunk {
  /** Absolute path to the chunk file on disk. */
  path: string;
  /** Start offset of this chunk on the global timeline, in seconds. */
  offsetSec: number;
  /** Chunk index (0-based, ascending). */
  index: number;
}

export interface ChunkPlanEntry {
  index: number;
  offsetSec: number;
  durationSec: number;
}

/**
 * Largest chunk duration (seconds) that keeps a chunk's file size under
 * `limitBytes * marginRatio` at the given bitrate. Always >= 1 second.
 */
export function safeChunkDurationSec(
  bitrateKbps: number,
  limitBytes: number = WHISPER_MAX_BYTES,
  marginRatio = 0.9,
): number {
  const bytesPerSec = (bitrateKbps * 1000) / 8;
  if (bytesPerSec <= 0) return 1;
  return Math.max(1, Math.floor((limitBytes * marginRatio) / bytesPerSec));
}

/**
 * Split a total duration into ordered (offset, duration) windows of at most
 * `chunkDurationSec`. The final window carries the remainder. A total duration
 * <= one chunk yields a single window.
 */
export function planChunks(
  totalDurationSec: number,
  chunkDurationSec: number,
): ChunkPlanEntry[] {
  if (totalDurationSec <= 0) return [];
  const dur = Math.max(1, chunkDurationSec);
  const entries: ChunkPlanEntry[] = [];

  let index = 0;
  let offset = 0;
  while (offset < totalDurationSec) {
    const remaining = totalDurationSec - offset;
    entries.push({
      index,
      offsetSec: offset,
      durationSec: Math.min(dur, remaining),
    });
    offset += dur;
    index += 1;
  }
  return entries;
}

/**
 * Extract a mono, 16 kHz, low-bitrate mp3 audio track from `localVideoPath`
 * into `workDir`. Returns the audio path and the bitrate used.
 */
export async function extractAudio(
  localVideoPath: string,
  workDir: string,
): Promise<{ audioPath: string; bitrateKbps: number }> {
  const audioPath = join(workDir, "audio.mp3");
  await runFfmpeg([
    "-i",
    localVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    `${EXTRACT_BITRATE_KBPS}k`,
    "-y",
    audioPath,
  ]);
  return { audioPath, bitrateKbps: EXTRACT_BITRATE_KBPS };
}

/**
 * Extract audio and split it into Whisper-sized chunks. When the extracted
 * audio fits under the limit (with margin) a single chunk is returned;
 * otherwise it is cut with `ffmpeg -ss/-t` into ordered chunks, each tagged
 * with its global start offset (FR-2).
 *
 * All output files are written inside `workDir`; the caller is responsible for
 * removing the directory afterward.
 */
export async function extractAndChunkAudio(
  localVideoPath: string,
  workDir: string,
): Promise<AudioChunk[]> {
  const { audioPath, bitrateKbps } = await extractAudio(localVideoPath, workDir);

  const { size } = await stat(audioPath);
  const limit = WHISPER_MAX_BYTES * 0.9;

  if (size <= limit) {
    return [{ path: audioPath, offsetSec: 0, index: 0 }];
  }

  const totalDurationSec = await probeDurationSec(audioPath);
  const chunkDurationSec = safeChunkDurationSec(bitrateKbps);
  const plan = planChunks(totalDurationSec, chunkDurationSec);

  const chunks: AudioChunk[] = [];
  for (const entry of plan) {
    const chunkPath = join(workDir, `chunk_${entry.index}.mp3`);
    // -ss before -i seeks fast; re-encode is unnecessary (-c copy) since we are
    // cutting an already-encoded mp3. -t bounds the chunk length.
    await runFfmpeg([
      "-ss",
      String(entry.offsetSec),
      "-t",
      String(entry.durationSec),
      "-i",
      audioPath,
      "-c",
      "copy",
      "-y",
      chunkPath,
    ]);
    chunks.push({
      path: chunkPath,
      offsetSec: entry.offsetSec,
      index: entry.index,
    });
  }

  return chunks;
}
