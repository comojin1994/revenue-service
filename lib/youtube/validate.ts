/**
 * Pure YouTube URL parsing/validation. No I/O — unit-tested directly.
 *
 * Supported formats:
 *   - https://www.youtube.com/watch?v=<id>
 *   - https://youtu.be/<id>
 *   - https://www.youtube.com/shorts/<id>
 *   - https://www.youtube.com/embed/<id>
 *   - https://m.youtube.com/watch?v=<id>
 *
 * A valid YouTube video id is exactly 11 characters from [A-Za-z0-9_-].
 * Extra query params (t, list, si, ...) are tolerated; only the id is taken.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

export interface ParsedYouTubeUrl {
  videoId: string;
}

function isValidVideoId(candidate: string | null | undefined): candidate is string {
  return typeof candidate === "string" && VIDEO_ID_RE.test(candidate);
}

export function parseYouTubeUrl(input: unknown): ParsedYouTubeUrl | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return isValidVideoId(id) ? { videoId: id } : null;
  }

  // youtube.com/watch?v=<id>
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "watch") {
    const id = url.searchParams.get("v");
    return isValidVideoId(id) ? { videoId: id } : null;
  }

  // youtube.com/shorts/<id> and youtube.com/embed/<id>
  if (segments[0] === "shorts" || segments[0] === "embed") {
    const id = segments[1];
    return isValidVideoId(id) ? { videoId: id } : null;
  }

  // Bare /watch with ?v handled above; nothing else is supported.
  return null;
}
