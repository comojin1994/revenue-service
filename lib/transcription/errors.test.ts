import { describe, expect, it } from "vitest";

import {
  classifyWhisperError,
  isRetryable,
  isRetryableStatus,
  TranscriptionError,
} from "./errors";

describe("classifyWhisperError", () => {
  it("maps any Whisper HTTP failure to WHISPER_API_FAILED", () => {
    expect(classifyWhisperError(429)).toBe("WHISPER_API_FAILED");
    expect(classifyWhisperError(503)).toBe("WHISPER_API_FAILED");
    expect(classifyWhisperError(400)).toBe("WHISPER_API_FAILED");
    expect(classifyWhisperError(401)).toBe("WHISPER_API_FAILED");
    expect(classifyWhisperError(null)).toBe("WHISPER_API_FAILED");
  });
});

describe("isRetryableStatus", () => {
  it("treats 429 and 5xx as retryable", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it("treats 4xx (non-429) and null as non-retryable", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(null)).toBe(false);
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe("isRetryable", () => {
  it("retries on TranscriptionError with 429/5xx status", () => {
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "rate limit", {
          status: 429,
        }),
      ),
    ).toBe(true);
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "server error", {
          status: 503,
        }),
      ),
    ).toBe(true);
  });

  it("does not retry on TranscriptionError with 4xx auth/validation status", () => {
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "bad request", {
          status: 400,
        }),
      ),
    ).toBe(false);
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "unauthorized", {
          status: 401,
        }),
      ),
    ).toBe(false);
  });

  it("never retries OPENAI_KEY_MISSING or FFMPEG_NOT_FOUND", () => {
    expect(
      isRetryable(new TranscriptionError("OPENAI_KEY_MISSING", "no key")),
    ).toBe(false);
    expect(
      isRetryable(new TranscriptionError("FFMPEG_NOT_FOUND", "no ffmpeg")),
    ).toBe(false);
  });

  it("honors an explicit retryable override on TranscriptionError", () => {
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "x", {
          status: 400,
          retryable: true,
        }),
      ),
    ).toBe(true);
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "x", {
          status: 503,
          retryable: false,
        }),
      ),
    ).toBe(false);
  });

  it("retries on transient network error codes (raw or wrapped)", () => {
    expect(isRetryable({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryable({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryable({ code: "EAI_AGAIN" })).toBe(true);
    expect(
      isRetryable(
        new TranscriptionError("WHISPER_API_FAILED", "net", {
          cause: { code: "ECONNRESET" },
        }),
      ),
    ).toBe(true);
  });

  it("retries on raw SDK errors carrying a retryable status", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 401 })).toBe(false);
  });

  it("does not retry unknown/plain errors", () => {
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable("nope")).toBe(false);
    expect(isRetryable({ code: "ENOSPC" })).toBe(false);
  });
});
