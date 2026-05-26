import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getServiceRoleClient, getStorageBucket } from "@/lib/supabase/server";
import { classifyYtDlpError, IngestError } from "@/lib/errors";

/**
 * Download a YouTube video with yt-dlp into a temp file and stream it to
 * Supabase Storage.
 *
 * MEMORY: The full media file is NEVER loaded into memory. yt-dlp writes to a
 * temp file on disk (format merging is disk-based), then the file is piped to
 * Supabase Storage via a Node read stream — no Buffer.concat / readFile of the
 * whole video. The temp directory is always removed in `finally` (NFR-1/NFR-6).
 */

export interface DownloadResult {
  videoPath: string;
  ext: string;
  bytes: number;
}

interface DownloadOptions {
  url: string;
  jobId: string;
  videoId: string;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4a: "audio/mp4",
  mov: "video/quicktime",
};

function contentTypeFor(ext: string): string {
  return CONTENT_TYPE_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

async function runYtDlp(url: string, outputTemplate: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // bv*+ba/b: best video+audio merged, fall back to best single stream.
    const args = [
      "-f",
      "bv*+ba/b",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "-o",
      outputTemplate,
      url,
    ];

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let settled = false;

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (err.code === "ENOENT") {
        reject(
          new IngestError(
            "YT_DLP_NOT_FOUND",
            "yt-dlp binary not found on PATH.",
            { cause: err },
          ),
        );
        return;
      }
      reject(
        new IngestError("DOWNLOAD_FAILED", err.message, { cause: err }),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const errorCode = classifyYtDlpError(stderr, code);
      reject(
        new IngestError(
          errorCode,
          `yt-dlp exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
        ),
      );
    });
  });
}

export async function downloadAndUpload(
  opts: DownloadOptions,
): Promise<DownloadResult> {
  const { url, jobId, videoId } = opts;

  // Dedicated temp dir per job so the output filename (extension chosen by
  // yt-dlp after format merge) can be discovered reliably.
  const workDir = await mkdtemp(join(tmpdir(), `ingest-${jobId}-`));
  const outputTemplate = join(workDir, `${videoId}.%(ext)s`);

  try {
    await runYtDlp(url, outputTemplate);

    const entries = await readdir(workDir);
    const fileName = entries.find((name) => name.startsWith(`${videoId}.`));
    if (!fileName) {
      throw new IngestError(
        "DOWNLOAD_FAILED",
        "yt-dlp reported success but produced no output file.",
      );
    }

    const localPath = join(workDir, fileName);
    const fileStat = await stat(localPath);
    const ext = fileName.split(".").pop() ?? "bin";
    const storagePath = `${jobId}/${videoId}.${ext}`;

    const supabase = getServiceRoleClient();
    const bucket = getStorageBucket();

    // Stream the file from disk straight to Storage — no full in-memory buffer.
    const readStream = createReadStream(localPath);

    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, readStream as unknown as ReadableStream, {
        contentType: contentTypeFor(ext),
        upsert: false,
        // duplex is required by undici/fetch when the body is a stream.
        duplex: "half",
      } as never);

    if (error) {
      throw new IngestError(
        "UPLOAD_FAILED",
        `Supabase Storage upload failed: ${error.message}`,
        { cause: error },
      );
    }

    return { videoPath: storagePath, ext, bytes: fileStat.size };
  } finally {
    // Always clean up the temp dir (success or failure) — NFR-6.
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
  }
}
