# revenue-service

YouTube ingestion pipeline 진입점. 사용자가 YouTube URL을 제출하면 검증 →
메타데이터 조회 → `yt-dlp` 다운로드 → Supabase Storage 스트리밍 업로드 →
`jobs` 레코드 생성까지 처리하는 Next.js 14 (App Router) 애플리케이션입니다.

## 스택

- Next.js 14 (App Router) + TypeScript (strict)
- Tailwind CSS
- Supabase (`@supabase/supabase-js` v2) — Postgres + Storage
- zod (서버 액션 입력 검증)
- Vitest (단위 테스트)
- `yt-dlp` 시스템 바이너리 (런타임 다운로드)
- 패키지 매니저: **pnpm**

## 사전 요구사항

| 도구 | 버전 |
|------|------|
| Node.js | 20 이상 (Node 24에서 검증) |
| pnpm | 10 이상 |
| yt-dlp | 최신 (런타임 전용 — 빌드에는 불필요) |

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

> service-role 키는 `lib/supabase/server.ts`에서만 사용되며 `server-only`
> import 가드로 클라이언트 번들 유입을 빌드 타임에 차단합니다.

## Supabase 마이그레이션

`supabase/migrations/`에 `jobs` 테이블과 private `videos` Storage 버킷 생성
SQL이 있습니다.

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
| `status` | text — `queued \| downloading \| uploaded \| failed` (CHECK) |
| `video_path` | text (Storage 경로) |
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

> 영상 파일은 전체를 메모리에 적재하지 않고 임시 파일 → read stream으로
> Storage에 업로드되며, 임시 파일은 성공/실패 모두 정리됩니다.

## CI

`.github/workflows/ci.yml`에서 `yt-dlp` 설치 후
`install → lint → typecheck → test → build`를 실행합니다.
