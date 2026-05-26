import { spawn } from "node:child_process";

/**
 * Fetch lightweight video metadata.
 *
 * Strategy:
 *   1. oEmbed (no auth, fast) for title/author/thumbnail.
 *   2. Fall back to `yt-dlp --dump-json` for title + duration when oEmbed
 *      fails or duration is needed.
 *
 * Metadata fetching is treated as best-effort and NON-fatal: if both paths
 * fail we return an empty title so the download can still proceed. The caller
 * decides how to surface a missing title.
 */

export interface YtMetadata {
  title: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  raw: unknown;
}

const OEMBED_TIMEOUT_MS = 8_000;
const YT_DLP_TIMEOUT_MS = 30_000;

interface OEmbedResponse {
  title?: string;
  thumbnail_url?: string;
  author_name?: string;
}

async function fetchOEmbed(url: string): Promise<YtMetadata | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    url,
  )}&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as OEmbedResponse;
    if (!data.title) return null;
    return {
      title: data.title,
      thumbnailUrl: data.thumbnail_url,
      raw: data,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface YtDlpDump {
  title?: string;
  duration?: number;
  thumbnail?: string;
  is_live?: boolean;
  availability?: string;
}

async function fetchViaYtDlp(url: string): Promise<YtMetadata | null> {
  return new Promise<YtMetadata | null>((resolve) => {
    const child = spawn(
      "yt-dlp",
      ["--dump-json", "--no-warnings", "--no-playlist", url],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let settled = false;
    const finish = (value: YtMetadata | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, YT_DLP_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || stdout.trim() === "") {
        finish(null);
        return;
      }
      try {
        // --dump-json may emit one JSON object per line; take the first.
        const firstLine = stdout.split("\n").find((l) => l.trim() !== "") ?? "";
        const data = JSON.parse(firstLine) as YtDlpDump;
        finish({
          title: data.title ?? "",
          durationSeconds:
            typeof data.duration === "number" ? data.duration : undefined,
          thumbnailUrl: data.thumbnail,
          raw: data,
        });
      } catch {
        finish(null);
      }
    });
  });
}

export async function fetchMetadata(
  url: string,
  _videoId: string,
): Promise<YtMetadata> {
  void _videoId;

  const oembed = await fetchOEmbed(url);
  // oEmbed lacks duration; enrich with yt-dlp when available, but never fail
  // the whole pipeline on metadata problems.
  const ytdlp = await fetchViaYtDlp(url);

  if (oembed && ytdlp) {
    return {
      title: oembed.title || ytdlp.title,
      durationSeconds: ytdlp.durationSeconds,
      thumbnailUrl: oembed.thumbnailUrl ?? ytdlp.thumbnailUrl,
      raw: { oembed: oembed.raw, ytdlp: ytdlp.raw },
    };
  }

  if (oembed) return oembed;
  if (ytdlp) return ytdlp;

  // Both failed — non-fatal. Return an empty title so the caller can proceed.
  return { title: "", raw: null };
}
