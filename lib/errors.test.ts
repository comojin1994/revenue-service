import { describe, expect, it } from "vitest";

import { classifyYtDlpError } from "./errors";

describe("classifyYtDlpError", () => {
  it("maps copyright stderr to COPYRIGHT_OR_RESTRICTED", () => {
    expect(
      classifyYtDlpError(
        "ERROR: Video unavailable. This video contains content from X, who has blocked it on copyright grounds.",
        1,
      ),
    ).toBe("COPYRIGHT_OR_RESTRICTED");
  });

  it("maps private video to COPYRIGHT_OR_RESTRICTED", () => {
    expect(classifyYtDlpError("ERROR: Private video", 1)).toBe(
      "COPYRIGHT_OR_RESTRICTED",
    );
  });

  it("maps age restriction to COPYRIGHT_OR_RESTRICTED", () => {
    expect(
      classifyYtDlpError("ERROR: Sign in to confirm your age", 1),
    ).toBe("COPYRIGHT_OR_RESTRICTED");
  });

  it("maps geo block to COPYRIGHT_OR_RESTRICTED", () => {
    expect(
      classifyYtDlpError(
        "ERROR: The uploader has not made this video available in your country",
        1,
      ),
    ).toBe("COPYRIGHT_OR_RESTRICTED");
  });

  it("maps ENOENT/command not found to YT_DLP_NOT_FOUND", () => {
    expect(classifyYtDlpError("spawn yt-dlp ENOENT", null)).toBe(
      "YT_DLP_NOT_FOUND",
    );
    expect(classifyYtDlpError("yt-dlp: command not found", 127)).toBe(
      "YT_DLP_NOT_FOUND",
    );
  });

  it("falls back to DOWNLOAD_FAILED for unknown stderr", () => {
    expect(classifyYtDlpError("ERROR: HTTP Error 500", 1)).toBe(
      "DOWNLOAD_FAILED",
    );
    expect(classifyYtDlpError("", 1)).toBe("DOWNLOAD_FAILED");
  });
});
