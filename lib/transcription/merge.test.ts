import { describe, expect, it } from "vitest";

import {
  type ChunkResult,
  mergeChunkResults,
  mergeTranscriptText,
  offsetSegments,
} from "./merge";

describe("offsetSegments", () => {
  it("returns segments unchanged for offset 0", () => {
    const segs = [
      { start: 0, end: 1.5, text: "hello" },
      { start: 1.5, end: 3, text: "world" },
    ];
    expect(offsetSegments(segs, 0)).toEqual(segs);
  });

  it("adds the offset to start and end, preserving text", () => {
    const segs = [
      { start: 0, end: 5, text: "a" },
      { start: 5, end: 10, text: "b" },
    ];
    expect(offsetSegments(segs, 600)).toEqual([
      { start: 600, end: 605, text: "a" },
      { start: 605, end: 610, text: "b" },
    ]);
  });

  it("does not mutate the input segments", () => {
    const segs = [{ start: 0, end: 1, text: "x" }];
    offsetSegments(segs, 100);
    expect(segs).toEqual([{ start: 0, end: 1, text: "x" }]);
  });

  it("handles an empty segment array", () => {
    expect(offsetSegments([], 42)).toEqual([]);
  });
});

describe("mergeTranscriptText", () => {
  it("trims, drops empties, and joins with a single space", () => {
    expect(mergeTranscriptText(["  hi ", "", "  there"])).toBe("hi there");
  });

  it("returns an empty string for all-empty input", () => {
    expect(mergeTranscriptText(["", "   "])).toBe("");
    expect(mergeTranscriptText([])).toBe("");
  });
});

describe("mergeChunkResults", () => {
  it("offsets segments per chunk and concatenates in order", () => {
    const chunks: ChunkResult[] = [
      {
        offsetSec: 0,
        text: "first chunk",
        segments: [
          { start: 0, end: 2, text: "first" },
          { start: 2, end: 4, text: "chunk" },
        ],
      },
      {
        offsetSec: 600,
        text: "second chunk",
        segments: [
          { start: 0, end: 3, text: "second" },
          { start: 3, end: 6, text: "chunk" },
        ],
      },
    ];

    const { text, segments } = mergeChunkResults(chunks);

    expect(text).toBe("first chunk second chunk");
    expect(segments).toEqual([
      { start: 0, end: 2, text: "first" },
      { start: 2, end: 4, text: "chunk" },
      { start: 600, end: 603, text: "second" },
      { start: 603, end: 606, text: "chunk" },
    ]);
  });

  it("accumulates offsets across three chunks", () => {
    const chunks: ChunkResult[] = [
      { offsetSec: 0, text: "a", segments: [{ start: 0, end: 1, text: "a" }] },
      {
        offsetSec: 600,
        text: "b",
        segments: [{ start: 0, end: 1, text: "b" }],
      },
      {
        offsetSec: 1200,
        text: "c",
        segments: [{ start: 0, end: 1, text: "c" }],
      },
    ];

    const { text, segments } = mergeChunkResults(chunks);

    expect(text).toBe("a b c");
    expect(segments.map((s) => s.start)).toEqual([0, 600, 1200]);
    expect(segments).toHaveLength(3);
  });

  it("handles chunks with empty segment arrays", () => {
    const chunks: ChunkResult[] = [
      { offsetSec: 0, text: "only", segments: [] },
      {
        offsetSec: 600,
        text: "text",
        segments: [{ start: 0, end: 1, text: "text" }],
      },
    ];
    const { text, segments } = mergeChunkResults(chunks);
    expect(text).toBe("only text");
    expect(segments).toEqual([{ start: 600, end: 601, text: "text" }]);
  });

  it("returns empty results for no chunks", () => {
    expect(mergeChunkResults([])).toEqual({ text: "", segments: [] });
  });
});
