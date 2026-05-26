import "server-only";

import { createReadStream } from "node:fs";

import OpenAI from "openai";

import {
  classifyWhisperError,
  isRetryable,
  TranscriptionError,
} from "./errors";
import type { TranscriptSegment } from "./merge";

/**
 * OpenAI Whisper client + per-chunk transcription with retry (FR-3, NFR-5).
 *
 * SECURITY: `OPENAI_API_KEY` is server-only. The `server-only` import above
 * guarantees this module never reaches a client bundle (NFR-4).
 */

export interface ChunkRawResult {
  text: string;
  segments: TranscriptSegment[];
}

let cachedClient: OpenAI | null = null;

/** Lazily build the OpenAI client; missing key -> non-retryable error. */
export function getOpenAI(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new TranscriptionError(
      "OPENAI_KEY_MISSING",
      "Missing required environment variable: OPENAI_API_KEY.",
    );
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/** Extract an HTTP status from an OpenAI SDK / fetch error, if present. */
function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

/**
 * Transcribe a single audio chunk file with `whisper-1` in `verbose_json` mode
 * and project the response onto our minimal segment shape. HTTP failures are
 * wrapped in a TranscriptionError carrying the status so the retry layer can
 * decide whether to retry.
 */
export async function transcribeChunk(
  filePath: string,
): Promise<ChunkRawResult> {
  const client = getOpenAI();

  try {
    const result = await client.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-1",
      response_format: "verbose_json",
    });

    const segments: TranscriptSegment[] = (result.segments ?? []).map(
      (seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
      }),
    );

    return { text: result.text ?? "", segments };
  } catch (err) {
    if (err instanceof TranscriptionError) throw err;
    const status = statusOf(err);
    const message = err instanceof Error ? err.message : String(err);
    throw new TranscriptionError(
      classifyWhisperError(status, message),
      `Whisper transcription failed (status ${status ?? "n/a"}): ${message.slice(
        0,
        500,
      )}`,
      { cause: err, status: status ?? undefined },
    );
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying only on retryable failures (HTTP 429/5xx, transient
 * network errors) with exponential backoff. Non-retryable errors are thrown
 * immediately. Defaults: 3 retries (4 total attempts), 500 ms base delay.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw lastErr;
}
