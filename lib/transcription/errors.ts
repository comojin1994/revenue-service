/**
 * Structured error codes for the transcription pipeline plus a Whisper-error
 * classifier and a retryability predicate. Mirrors the ingestion `lib/errors.ts`
 * pattern (IngestError) so failure handling stays consistent across stages.
 *
 * Pure module — no I/O. Tested by `errors.test.ts`.
 */

export type TranscriptionErrorCode =
  | "OPENAI_KEY_MISSING"
  | "FFMPEG_NOT_FOUND"
  | "AUDIO_EXTRACTION_FAILED"
  | "STORAGE_DOWNLOAD_FAILED"
  | "WHISPER_API_FAILED"
  | "TRANSCRIBE_UPLOAD_FAILED"
  | "JOB_NOT_TRANSCRIBABLE"
  | "DB_ERROR";

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  /** Underlying HTTP status when the error originated from the Whisper API. */
  readonly status?: number;
  /** Explicit retryability override; when undefined `isRetryable` infers it. */
  readonly retryable?: boolean;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    options?: { cause?: unknown; status?: number; retryable?: boolean },
  ) {
    super(message, options);
    this.name = "TranscriptionError";
    this.code = code;
    this.status = options?.status;
    this.retryable = options?.retryable;
  }
}

/** User-facing (Korean) messages keyed by error code. */
export const USER_MESSAGES: Record<TranscriptionErrorCode, string> = {
  OPENAI_KEY_MISSING:
    "서버에 OpenAI API 키가 설정되어 있지 않습니다. 관리자에게 문의해 주세요.",
  FFMPEG_NOT_FOUND:
    "서버에 ffmpeg가 설치되어 있지 않습니다. 관리자에게 문의해 주세요.",
  AUDIO_EXTRACTION_FAILED:
    "영상에서 오디오를 추출하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  STORAGE_DOWNLOAD_FAILED:
    "영상 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  WHISPER_API_FAILED:
    "음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  TRANSCRIBE_UPLOAD_FAILED:
    "자막 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  JOB_NOT_TRANSCRIBABLE:
    "이 작업은 트랜스크립션을 진행할 수 없는 상태입니다.",
  DB_ERROR: "처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

export function userMessageFor(code: TranscriptionErrorCode): string {
  return USER_MESSAGES[code] ?? USER_MESSAGES.WHISPER_API_FAILED;
}

/**
 * Map a Whisper/OpenAI HTTP failure onto a TranscriptionErrorCode. All HTTP
 * transcription failures collapse onto WHISPER_API_FAILED; retryability is
 * decided separately (by status) in `isRetryable`, not by the code.
 *
 * - 401 / 403 -> auth failure (non-retryable)
 * - 400 / 404 / 413 / 422 -> validation/request failure (non-retryable)
 * - 429 / 5xx -> transient failure (retryable)
 * - null status (network) -> transient failure (retryable)
 */
export function classifyWhisperError(
  status: number | null,
  body?: string,
): TranscriptionErrorCode {
  void body;
  void status;
  return "WHISPER_API_FAILED";
}

/** Network error codes that indicate a transient, retryable failure. */
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
]);

/** True for HTTP statuses that warrant a retry (rate limit / server error). */
export function isRetryableStatus(status: number | null | undefined): boolean {
  if (status == null) return false;
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Decide whether an arbitrary error thrown during a chunk transcription should
 * be retried. HTTP 429/5xx and transient network errors retry; auth/validation
 * errors, missing key, and missing ffmpeg do not.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TranscriptionError) {
    // Explicit override wins.
    if (typeof err.retryable === "boolean") return err.retryable;
    // Never retry configuration/environment failures.
    if (err.code === "OPENAI_KEY_MISSING" || err.code === "FFMPEG_NOT_FOUND") {
      return false;
    }
    if (isRetryableStatus(err.status)) return true;
    // No status attached (e.g. wrapped network error) -> inspect cause below.
    if (err.status == null) {
      return hasRetryableNetworkCode(err.cause);
    }
    return false;
  }

  // Raw OpenAI SDK / fetch errors expose `status` and/or a network `code`.
  const status = extractStatus(err);
  if (isRetryableStatus(status)) return true;
  return hasRetryableNetworkCode(err);
}

function hasRetryableNetworkCode(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code)) {
      return true;
    }
  }
  return false;
}

function extractStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}
