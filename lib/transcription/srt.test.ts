import { describe, expect, it } from "vitest";

import { formatSrtTimestamp, segmentsToSrt } from "./srt";

describe("formatSrtTimestamp", () => {
  it("formats zero", () => {
    expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
  });

  it("formats hours/minutes/seconds with milliseconds", () => {
    expect(formatSrtTimestamp(3661.5)).toBe("01:01:01,500");
  });

  it("clamps negative and NaN to zero", () => {
    expect(formatSrtTimestamp(-5)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(Number.NaN)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(Number.POSITIVE_INFINITY)).toBe("00:00:00,000");
  });

  it("rounds milliseconds and carries into seconds", () => {
    expect(formatSrtTimestamp(0.999)).toBe("00:00:00,999");
    // 0.9995 * 1000 === 999.5 -> Math.round -> 1000 ms -> carries to 1s, 0ms.
    expect(formatSrtTimestamp(0.9995)).toBe("00:00:01,000");
    // 1.0005 * 1000 === 1000.5 -> Math.round -> 1001 ms -> 1s, 1ms.
    expect(formatSrtTimestamp(1.0005)).toBe("00:00:01,001");
  });

  it("carries seconds and minutes correctly", () => {
    expect(formatSrtTimestamp(59.9999)).toBe("00:01:00,000");
    expect(formatSrtTimestamp(3599.9999)).toBe("01:00:00,000");
  });

  it("handles durations beyond one hour without overflow", () => {
    expect(formatSrtTimestamp(7200)).toBe("02:00:00,000");
  });
});

describe("segmentsToSrt", () => {
  it("serializes two segments with 1-based indices and blank-line separators", () => {
    const srt = segmentsToSrt([
      { start: 0, end: 1.5, text: "Hello" },
      { start: 1.5, end: 3, text: "World" },
    ]);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nHello\n" +
        "\n" +
        "2\n00:00:01,500 --> 00:00:03,000\nWorld\n",
    );
  });

  it("skips empty/whitespace-only segments and does not consume their index", () => {
    const srt = segmentsToSrt([
      { start: 0, end: 1, text: "first" },
      { start: 1, end: 2, text: "   " },
      { start: 2, end: 3, text: "second" },
    ]);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nfirst\n" +
        "\n" +
        "2\n00:00:02,000 --> 00:00:03,000\nsecond\n",
    );
  });

  it("trims segment text", () => {
    const srt = segmentsToSrt([{ start: 0, end: 1, text: "  padded  " }]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\npadded\n");
  });

  it("returns an empty string when there are no usable segments", () => {
    expect(segmentsToSrt([])).toBe("");
    expect(segmentsToSrt([{ start: 0, end: 1, text: "  " }])).toBe("");
  });
});
