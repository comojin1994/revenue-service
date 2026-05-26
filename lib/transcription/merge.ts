/**
 * Chunk timestamp offset correction + transcript merging.
 *
 * Whisper transcribes each audio chunk independently, so every chunk's segment
 * timestamps are local to that chunk (start at ~0). To produce a single global
 * transcript we add each chunk's start offset to its segments and concatenate
 * the chunks in order. This is the core of FR-4 and is kept I/O-free so it can
 * be unit tested (see `merge.test.ts`).
 */

export interface TranscriptSegment {
  /** Segment start time in seconds (global timeline after offsetting). */
  start: number;
  /** Segment end time in seconds. */
  end: number;
  text: string;
}

export interface ChunkResult {
  /** Start offset of this chunk on the global timeline, in seconds. */
  offsetSec: number;
  /** Full text returned by Whisper for this chunk. */
  text: string;
  /** Chunk-local segments (will be offset during merge). */
  segments: TranscriptSegment[];
}

/**
 * Shift every segment's start/end by `offsetSec`. Text is preserved. Returns a
 * new array; inputs are not mutated.
 */
export function offsetSegments(
  segments: TranscriptSegment[],
  offsetSec: number,
): TranscriptSegment[] {
  return segments.map((seg) => ({
    start: seg.start + offsetSec,
    end: seg.end + offsetSec,
    text: seg.text,
  }));
}

/**
 * Normalize and join chunk texts into a single transcript string. Each chunk's
 * text is trimmed; empty chunks are dropped; the rest are joined with a single
 * space.
 */
export function mergeTranscriptText(texts: string[]): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(" ");
}

/**
 * Merge ordered chunk results into a single global transcript: offset each
 * chunk's segments, concatenate them in chunk order, and merge the chunk texts.
 */
export function mergeChunkResults(chunks: ChunkResult[]): {
  text: string;
  segments: TranscriptSegment[];
} {
  const segments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    segments.push(...offsetSegments(chunk.segments, chunk.offsetSec));
  }
  const text = mergeTranscriptText(chunks.map((c) => c.text));
  return { text, segments };
}
