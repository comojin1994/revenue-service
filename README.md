# revenue-service

YouTube ingestion + transcription pipeline. 사용자가 YouTube URL을 제출하면
검증 → 메타데이터 조회 → `yt-dlp` 다운로드 → Supabase Storage 스트리밍 업로드 →
`jobs` 레코드 생성까지 처리하고(인제스션), 이어서 업로드된 영상에서 `ffmpeg`로
오디오를 추출해 OpenAI Whisper로 트랜스크립트/SRT 자막을 생성하는(트랜스크립션)
Next.js 14 (App Router) 애플리케이션입니다.

## 스택

- Next.js 14 (App Router) + TypeScript (strict)
- Tailwind CSS
- Supabase (`@supabase/supabase-js` v2) — Postgres + Storage
- zod (서버 액션 입력 검증)
- OpenAI Whisper (`openai` SDK — 트랜스크립션)
- Vitest (단위 테스트)
- `yt-dlp` 시스템 바이너리 (런타임 다운로드)
- `ffmpeg` 시스템 바이너리 (런타임 오디오 추출/청크 분할)
- 패키지 매니저: **pnpm**

## 사전 요구사항

| 도구 | 버전 |
|------|------|
| Node.js | 20 이상 (Node 24에서 검증) |
| pnpm | 10 이상 |
| yt-dlp | 최신 (런타임 전용 — 빌드에는 불필요) |
| ffmpeg | 최신 (런타임 전용 — 빌드에는 불필요, `ffprobe` 포함) |

### yt-dlp 설치

다운로드 기능은 시스템 `yt-dlp` 바이너리(PATH 상)에 의존합니다.

```bash
# macOS (Homebrew)
brew install yt-dlp

# Linux / 그 외 (pipx 권장)
pipx install yt-dlp

# 또는 pip
python3 -m pip install -U yt-dlp

# Debian/Ubuntu (apt — 버전이 오래될 수 있음)
sudo apt-get install -y yt-dlp
```

설치 확인:

```bash
yt-dlp --version
```

`yt-dlp`가 PATH에 없으면 런타임에서 `YT_DLP_NOT_FOUND` 에러로 명확히 안내합니다
(빌드/타입체크/테스트는 바이너리 없이도 통과합니다).

### ffmpeg 설치

트랜스크립션 단계는 시스템 `ffmpeg`/`ffprobe` 바이너리(PATH 상)로 영상에서
오디오를 추출하고 25 MB 제한에 맞춰 청크를 분할합니다.

```bash
# macOS (Homebrew)
brew install ffmpeg

# Debian/Ubuntu / CI
sudo apt-get update && sudo apt-get install -y ffmpeg
```

설치 확인:

```bash
ffmpeg -version
```

`ffmpeg`가 PATH에 없으면 런타임에서 `FFMPEG_NOT_FOUND` 에러로, `OPENAI_API_KEY`가
없으면 `OPENAI_KEY_MISSING` 에러로 명확히 안내합니다. 두 의존성 모두 런타임
전용이므로 빌드/타입체크/테스트는 바이너리/키 없이도 통과합니다.

## 셋업

```bash
pnpm install
cp .env.example .env.local   # 값 채우기 (아래 참조)
pnpm dev                     # http://localhost:3000 -> /ingest 로 리다이렉트
```

### 환경 변수 (`.env.local`)

`.env.example`를 복사한 뒤 채웁니다.

| 변수 | 설명 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public 키 (브라우저 노출 가능) |
| `SUPABASE_SERVICE_ROLE_KEY` | **서버 전용** service-role 키. 절대 클라이언트에 노출 금지 |
| `SUPABASE_STORAGE_BUCKET` | 다운로드 영상 저장 버킷 (기본 `videos`) |
| `OPENAI_API_KEY` | **서버 전용** OpenAI API 키 (Whisper 트랜스크립션). 절대 클라이언트에 노출 금지 |
| `SUPABASE_TRANSCRIPTS_BUCKET` | 생성된 SRT 자막 저장 버킷 (기본 `transcripts`) |

> service-role 키와 `OPENAI_API_KEY`는 `server-only` 가드가 적용된 모듈
> (`lib/supabase/server.ts`, `lib/transcription/whisper.ts`)에서만 사용되며
> 클라이언트 번들 유입을 빌드 타임에 차단합니다.

## Supabase 마이그레이션

`supabase/migrations/`에 `jobs` 테이블과 private `videos`/`transcripts`
Storage 버킷 생성 SQL이 있습니다. 트랜스크립션 마이그레이션
(`20260526010000_transcription.sql`)은 `jobs`에 `transcript_text`/`srt_path`
컬럼을 추가하고, `status` CHECK에 `transcribing`/`transcribed`를 더하며,
private `transcripts` 버킷을 idempotent하게 생성합니다.

```bash
# Supabase CLI (권장)
supabase db push

# 또는 Supabase 대시보드 SQL 에디터에 마이그레이션 SQL 내용을 붙여넣어 실행
```

생성되는 `jobs` 스키마:

| 컬럼 | 타입 |
|------|------|
| `id` | uuid PK (`gen_random_uuid()`) |
| `user_id` | uuid (nullable — 인증 도입 전 placeholder) |
| `youtube_url` | text not null |
| `status` | text — `queued \| downloading \| uploaded \| transcribing \| transcribed \| failed` (CHECK) |
| `video_path` | text (`videos` 버킷 경로) |
| `transcript_text` | text (nullable — 트랜스크립션 완료 시 채워짐) |
| `srt_path` | text (nullable — `transcripts` 버킷 SRT 경로) |
| `metadata` | jsonb (`{}` 기본) |
| `created_at` | timestamptz (`now()`) |

RLS는 활성화되어 있으며, 현재는 service-role 키(RLS 우회)만 접근합니다.
실제 인증 도입 시 `user_id` 기반 정책으로 교체합니다 (`TODO(auth)` 주석 참조).

## 스크립트

| 스크립트 | 설명 |
|----------|------|
| `pnpm dev` | 개발 서버 |
| `pnpm build` | 프로덕션 빌드 (`next build`) |
| `pnpm start` | 프로덕션 서버 |
| `pnpm lint` | ESLint (`next lint`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest 단위 테스트 |

## 동작 흐름

1. `/ingest` 폼에서 YouTube URL 제출.
2. 서버 액션 `submitYoutubeUrl`(`app/actions/ingest.ts`)가 검증 →
   메타데이터 조회 → `jobs` insert(`status=queued`) →
   (`TODO(c1)` 크레딧 차감 지점) → `status=downloading` →
   `yt-dlp` 다운로드 + Storage 스트리밍 업로드 → `status=uploaded` 순으로 처리.
3. 저작권/지역 제한/비공개 등은 `COPYRIGHT_OR_RESTRICTED`로 분류되며
   다운로드 실패 시 `status=failed` + `metadata.error`가 기록됩니다.
4. 트랜스크립션 server action `transcribeJob(jobId)`(`app/actions/transcribe.ts`)가
   `uploaded` 상태의 job을 받아 `status=transcribing`으로 전이한 뒤,
   Storage `videos` 버킷에서 영상을 임시 파일로 내려받아 `ffmpeg`로 mono 16 kHz
   mp3 오디오를 추출합니다. 추출물이 Whisper 25 MB 한도를 넘으면 시간 기반으로
   청크 분할(각 청크의 시작 오프셋 보관)한 뒤 청크별로 Whisper(`whisper-1`,
   `verbose_json`)를 호출합니다(일시적 실패는 지수 백오프로 재시도).
5. 청크 segment 타임스탬프에 오프셋을 더해 전체 타임라인으로 보정·병합하고,
   병합 결과를 SRT로 변환해 `transcripts` 버킷의 `{jobId}/{videoId}.srt`에
   업로드(`upsert`)합니다. 그 후 `jobs.transcript_text`/`jobs.srt_path`를 채우고
   `status=transcribed`로 전이합니다.
6. 트랜스크립션 실패 시 `status=failed` + `metadata.error = { code, message }`가
   기록됩니다(`FFMPEG_NOT_FOUND`, `OPENAI_KEY_MISSING`, `WHISPER_API_FAILED` 등).

> 영상/오디오 파일은 전체를 메모리에 적재하지 않고 임시 파일을 사용하며,
> 임시 디렉터리는 성공/실패 모두 `finally`에서 정리됩니다. 인제스션은 영상을
> read stream으로 업로드합니다.

## CI

`.github/workflows/ci.yml`에서 `yt-dlp`/`ffmpeg` 설치 후
`install → lint → typecheck → test → build`를 실행합니다. `OPENAI_API_KEY`는
빌드/테스트에 불필요합니다(런타임 전용).
