/**
 * SRT subtitle serialization (FR-5). Pure module — no I/O. Tested by
 * `srt.test.ts`.
 */

import type { TranscriptSegment } from "./merge";

/**
 * Format a number of seconds as an SRT timestamp `HH:MM:SS,mmm` (comma
 * millisecond separator). Negative/NaN inputs clamp to 0; milliseconds are
 * rounded and any carry propagates up through seconds/minutes/hours.
 */
export function formatSrtTimestamp(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;

  // Work in integer milliseconds to avoid float drift, rounding at the ms level.
  let totalMs = Math.round(safe * 1000);

  const ms = totalMs % 1000;
  totalMs = (totalMs - ms) / 1000; // now integer seconds

  const seconds = totalMs % 60;
  totalMs = (totalMs - seconds) / 60; // now integer minutes

  const minutes = totalMs % 60;
  const hours = (totalMs - minutes) / 60;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(ms)}`;
}

/**
 * Serialize merged transcript segments into an SRT document. Segments are
 * indexed from 1; segments with empty/whitespace-only text are skipped (and do
 * not consume an index). Returns a string ending with a single trailing
 * newline (empty string when no usable segments).
 */
export function segmentsToSrt(segments: TranscriptSegment[]): string {
  const blocks: string[] = [];
  let index = 1;

  for (const seg of segments) {
    const text = seg.text.trim();
    if (text.length === 0) continue;

    const start = formatSrtTimestamp(seg.start);
    const end = formatSrtTimestamp(seg.end);
    blocks.push(`${index}\n${start} --> ${end}\n${text}\n`);
    index += 1;
  }

  if (blocks.length === 0) return "";
  return blocks.join("\n");
}
