import { spawn } from "node:child_process";

import { TranscriptionError } from "./errors";

/**
 * Thin wrappers around the system `ffmpeg` / `ffprobe` binaries. Mirrors the
 * yt-dlp spawn pattern in `lib/youtube/download.ts`: collect stderr, map ENOENT
 * to a "not found" code, and a reasonable kill timeout (NFR-6).
 *
 * ffmpeg is a runtime-only system dependency — never an npm package — so the
 * build/typecheck/test path stays binary-free (NFR-3).
 */

const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per ffmpeg invocation.
const FFPROBE_TIMEOUT_MS = 60 * 1000;

/**
 * Run ffmpeg with the given args, resolving on exit code 0. ENOENT (binary
 * missing) -> FFMPEG_NOT_FOUND; any other non-zero exit -> AUDIO_EXTRACTION_FAILED.
 */
export async function runFfmpeg(
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? FFMPEG_TIMEOUT_MS;

  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new TranscriptionError(
          "AUDIO_EXTRACTION_FAILED",
          `ffmpeg timed out after ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new TranscriptionError(
            "FFMPEG_NOT_FOUND",
            "ffmpeg binary not found on PATH.",
            { cause: err },
          ),
        );
        return;
      }
      reject(
        new TranscriptionError("AUDIO_EXTRACTION_FAILED", err.message, {
          cause: err,
        }),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new TranscriptionError(
          "AUDIO_EXTRACTION_FAILED",
          `ffmpeg exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
        ),
      );
    });
  });
}

/**
 * Probe the duration (in seconds) of a media file via `ffprobe`. ffprobe ships
 * alongside ffmpeg. ENOENT -> FFMPEG_NOT_FOUND; other failures ->
 * AUDIO_EXTRACTION_FAILED.
 */
export async function probeDurationSec(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new TranscriptionError(
          "AUDIO_EXTRACTION_FAILED",
          `ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms.`,
        ),
      );
    }, FFPROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new TranscriptionError(
            "FFMPEG_NOT_FOUND",
            "ffprobe binary not found on PATH (ships with ffmpeg).",
            { cause: err },
          ),
        );
        return;
      }
      reject(
        new TranscriptionError("AUDIO_EXTRACTION_FAILED", err.message, {
          cause: err,
        }),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const seconds = Number.parseFloat(stdout.trim());
      if (code !== 0 || !Number.isFinite(seconds)) {
        reject(
          new TranscriptionError(
            "AUDIO_EXTRACTION_FAILED",
            `ffprobe could not determine duration (code ${code}): ${stderr
              .trim()
              .slice(0, 300)}`,
          ),
        );
        return;
      }
      resolve(seconds);
    });
  });
}
