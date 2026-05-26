import { describe, expect, it } from "vitest";

import {
  planChunks,
  safeChunkDurationSec,
  WHISPER_MAX_BYTES,
} from "./chunk";

describe("safeChunkDurationSec", () => {
  it("computes a sensible duration for a 48 kbps stream", () => {
    // bytesPerSec = 48000/8 = 6000. limit*0.9 = 23592960*... -> floor.
    const expected = Math.floor((WHISPER_MAX_BYTES * 0.9) / (48000 / 8));
    expect(safeChunkDurationSec(48)).toBe(expected);
    // Sanity: ~58 minutes, comfortably long.
    expect(safeChunkDurationSec(48)).toBeGreaterThan(3000);
  });

  it("respects a custom margin ratio (lower margin -> shorter chunk)", () => {
    const full = safeChunkDurationSec(48, WHISPER_MAX_BYTES, 1.0);
    const margined = safeChunkDurationSec(48, WHISPER_MAX_BYTES, 0.8);
    expect(margined).toBeLessThan(full);
  });

  it("scales inversely with bitrate", () => {
    expect(safeChunkDurationSec(96)).toBeLessThan(safeChunkDurationSec(48));
  });

  it("never returns less than 1 second", () => {
    expect(safeChunkDurationSec(1_000_000)).toBe(1);
    expect(safeChunkDurationSec(0)).toBe(1);
  });
});

describe("planChunks", () => {
  it("returns a single window when the total fits in one chunk", () => {
    expect(planChunks(300, 600)).toEqual([
      { index: 0, offsetSec: 0, durationSec: 300 },
    ]);
    // Exactly equal to chunk length is still one window.
    expect(planChunks(600, 600)).toEqual([
      { index: 0, offsetSec: 0, durationSec: 600 },
    ]);
  });

  it("splits an evenly divisible total into equal windows", () => {
    expect(planChunks(1200, 600)).toEqual([
      { index: 0, offsetSec: 0, durationSec: 600 },
      { index: 1, offsetSec: 600, durationSec: 600 },
    ]);
  });

  it("puts the remainder in the final window", () => {
    expect(planChunks(1500, 600)).toEqual([
      { index: 0, offsetSec: 0, durationSec: 600 },
      { index: 1, offsetSec: 600, durationSec: 600 },
      { index: 2, offsetSec: 1200, durationSec: 300 },
    ]);
  });

  it("returns no windows for non-positive duration", () => {
    expect(planChunks(0, 600)).toEqual([]);
    expect(planChunks(-10, 600)).toEqual([]);
  });
});
