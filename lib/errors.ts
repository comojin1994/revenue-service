/**
 * Structured error codes for the ingestion pipeline and a classifier that
 * maps yt-dlp stderr/exit codes to user-meaningful categories.
 */

export type IngestErrorCode =
  | "VALIDATION"
  | "INVALID_URL"
  | "METADATA_FAILED"
  | "YT_DLP_NOT_FOUND"
  | "DOWNLOAD_FAILED"
  | "COPYRIGHT_OR_RESTRICTED"
  | "UPLOAD_FAILED"
  | "DB_ERROR";

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IngestError";
    this.code = code;
  }
}

/**
 * Keywords that indicate the video cannot be downloaded for rights/availability
 * reasons rather than a transient failure. Matched case-insensitively against
 * yt-dlp stderr.
 */
const RESTRICTED_PATTERNS: RegExp[] = [
  /copyright/i,
  /blocked .*(country|your country)/i,
  /available in your country/i,
  /private video/i,
  /this video is private/i,
  /age[- ]?restricted/i,
  /confirm your age/i,
  /has been removed/i,
  /video unavailable/i,
  /is unavailable/i,
  /sign in to confirm/i,
  /members[- ]only/i,
  /premieres in/i,
];

/**
 * Classify a yt-dlp failure into an IngestErrorCode.
 * - ENOENT-style "command not found" -> YT_DLP_NOT_FOUND
 * - rights/availability keywords -> COPYRIGHT_OR_RESTRICTED
 * - everything else -> DOWNLOAD_FAILED
 */
export function classifyYtDlpError(
  stderr: string,
  exitCode: number | null,
): IngestErrorCode {
  const text = stderr ?? "";

  if (/ENOENT|not found|command not found/i.test(text)) {
    return "YT_DLP_NOT_FOUND";
  }

  for (const pattern of RESTRICTED_PATTERNS) {
    if (pattern.test(text)) {
      return "COPYRIGHT_OR_RESTRICTED";
    }
  }

  // exitCode is informational; non-zero with no recognized reason is generic.
  void exitCode;
  return "DOWNLOAD_FAILED";
}

/** User-facing (Korean) messages keyed by error code. See ux.md. */
export const USER_MESSAGES: Record<IngestErrorCode, string> = {
  VALIDATION: "올바른 YouTube URL을 입력해 주세요.",
  INVALID_URL: "올바른 YouTube URL을 입력해 주세요.",
  METADATA_FAILED: "영상 정보를 가져오지 못했습니다. URL을 확인해 주세요.",
  YT_DLP_NOT_FOUND: "서버에 yt-dlp가 설치되어 있지 않습니다. 관리자에게 문의해 주세요.",
  DOWNLOAD_FAILED: "다운로드에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  COPYRIGHT_OR_RESTRICTED:
    "이 영상은 저작권/지역 제한으로 다운로드할 수 없습니다.",
  UPLOAD_FAILED: "업로드 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  DB_ERROR: "처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

export function userMessageFor(code: IngestErrorCode): string {
  return USER_MESSAGES[code] ?? USER_MESSAGES.DOWNLOAD_FAILED;
}
