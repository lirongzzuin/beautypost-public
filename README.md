# 뷰티포스트 (BeautyPost)

> 1인 뷰티샵 원장님이 시술 사진을 올리면 **인스타·블로그 게시글 초안, 게시용 사진, 릴스 영상**을 한 번에 만들어 주는 서비스
> 기획 · 설계 · 개발 · 운영 1인 · 2026.10 ~ · 운영 [beautypost.shop](https://beautypost.shop)

`TypeScript` `React (Vite PWA)` `Hono` `Vercel Functions` `Neon Postgres` `Drizzle` `AI SDK v6 (Gemini · Claude)` `sharp` `ffmpeg` `Turborepo` `Vitest` `Playwright`

---

## 무엇을 해결하나

1인 샵 원장님은 시술이 끝날 때마다 사진을 고르고, 밝기를 맞추고, 비포·애프터를 붙이고, 글을 쓰고, 릴스를 편집합니다. 이 과정에 30분~1시간이 들어서 결국 꾸준히 올리지 못합니다.

뷰티포스트에서는 **업종(반영구 눈썹·네일·헤어…) → 콘텐츠 목적(비포·애프터, 시술 과정…) → 분위기(무드)** 를 고르고 사진을 올리기만 하면 됩니다.

| 결과물 | 만드는 방식 | 걸리는 시간 |
|---|---|---|
| 게시글 초안 (인스타 3안 · 블로그 2안 · 카카오톡) | 사진 분석 + 원장님 메모 → LLM → 금지 표현 검사·자동 수정 | 수 초 |
| 게시용 사진 (비포·애프터 콜라주, 4:5·1:1·9:16) | 직접 만든 보정 엔진 (sharp, 전역 색보정만) | 1초 안팎 |
| 릴스·스토리 영상 | 작업 큐 → 렌더 작업자 → 직접 만든 영상 엔진 (프레임 합성 + ffmpeg) | 12초 영상 약 4초 |

결과는 복사·저장해서 원장님이 직접 올립니다. 인스타 API 연동은 초보 사용자에게 진입장벽이 되어 일부러 보류했고(기능 플래그로 남겨 둠), 이렇게 판단한 근거는 [결정 기록](docs/ARCHITECTURE.md#8-결정-기록)에 남겼습니다.

## 아키텍처

```
┌──────────── apps/web (React PWA) ────────────┐
│  고르기 · 올리기 · 결과 복사/저장 (얇은 화면)  │
└──────────────────┬───────────────────────────┘
                   │ HTTP
┌──────────────────▼───────────────────────────┐        ┌─────────── apps/worker (Node) ───────────┐
│  apps/api (Hono on Vercel Functions)          │◀─HTTP──│  claim → 렌더 → 업로드 → complete          │
│  routes(얇게) → services → packages           │        │  DB 에 직접 붙지 않음 → 어디로든 이식 가능   │
│  jobs 큐: 임대 · 하트비트 · 재시도 · 백오프     │        └─────────────────┬─────────────────────────┘
└───────┬──────────────┬───────────────────────┘                          │
        │              │                                                  │
   Neon Postgres   Vercel Blob (클라이언트 직접 업로드)                     │
                                                                          │
packages/  preset(zod 스키마·레지스트리) · ai(모델 라우터·폴백) · caption(글·정책 검사)
           photocraft(사진 보정·구도) · render(장면 계획) · reel(영상 엔진) · platform(브라우저 API 경계)
presets/   무드 5 · 목적 6 · 업종 9 · 포맷 4 · 폰트 4 · 정책 3 · 프롬프트 — 코드가 아닌 데이터
```

자세한 구조와 설계 이유는 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** 에 있습니다.

## 기술적으로 집중한 문제

### 1. 영상 렌더링 37배 단축: 150초 → 4초
- **문제:** 처음에는 기존 영상 편집 자동화 도구(filmcraft)를 엔진으로 썼습니다. 편집기를 명령 수백 개로 조작하는 방식이라 15초 영상 한 편에 2~3분이 걸렸고, 클로즈업이나 위아래 비교 같은 장면 문법도 세밀하게 다루지 못했습니다.
- **해결:** Node + sharp + ffmpeg 만 쓰는 영상 엔진(`packages/reel`)을 새로 만들었습니다.
  - 사진을 한 번 보정해 2배 해상도의 '무대'로 두고, 프레임마다 확대 비율만 바꿔 잘라 냅니다 (천천히 다가가기·펀치 줌).
  - 글자는 RGBA 레이어로 미리 만들어 섞고, 프레임 6장을 앞질러 병렬로 만든 뒤 libx264로 굽습니다.
- **결과:** 12초 릴스(352프레임)를 **약 4초**에 만듭니다. 외부 런타임이 필요 없어 Docker로 그대로 옮길 수 있습니다.
- 예전 엔진은 지우지 않고 `RENDER_ENGINE=filmcraft` 로 고를 수 있게 남겼습니다. 기존 채널의 빌드 명령 898개가 변경 전후 **완전히 같은지** 비교해, 기존 사용처에 회귀가 없음을 확인했습니다.

### 2. 서버리스에서 유실 없는 작업 큐 (Redis 없이 Postgres만으로)
- 영상 작업은 API가 바로 `202` 로 응답하고, 렌더 작업자가 가져가서 처리합니다.
- 작업 임대는 SQL 한 문장(`FOR UPDATE SKIP LOCKED`)으로 하고, 임대할 때마다 새 토큰을 발급합니다. 늦게 도착한 옛 작업자의 보고는 무시됩니다.
- 하트비트(10초)로 임대를 연장하고, 작업자가 죽으면 임대가 만료되어 다음 작업자가 이어받습니다. 최대 3회, 백오프 30초·2분·10분.
- 실제로 렌더 도중 `kill -9` 를 하면 새 작업자가 두 번째 시도에서 완료했고, `SIGTERM` 을 보내면 작업이 바로 대기열로 돌아가는 것을 확인했습니다.

### 3. 무료 등급 AI 한도 안에서 운영하기
- **문제:** 운영 중에 글·사진·영상 생성이 모두 실패했습니다. 원인은 Gemini 무료 등급(분당 5회)에 사진마다, 요청마다 분석 호출이 몰린 것(429)이었습니다.
- **해결:**
  - 사진 여러 장을 한 요청으로 분석하고 결과를 캐시합니다. 그 결과 **만들기 1회당 AI 요청이 약 3번**으로 줄었습니다.
  - 역할별 모델 라우터에서 Gemini가 막히면 AI Gateway(Claude)로 넘어가고, 모델당 45초가 넘으면 다음 후보로 넘어갑니다.
  - 결제 수단이 없는 모델은 10분 동안 건너뜁니다.
- **안 될 때도 쓸 수 있게:** AI를 쓸 수 없으면 사진·영상은 AI 없이 만들고, 글만 "다시 시도" 안내를 보여 줍니다(`AiUnavailableError` → 503). 근거 없이 글을 지어내지 않게 하려는 것입니다.

### 4. "과장 없는 보정"을 코드 구조로 보장
- 뷰티 업계에서는 과한 보정이 신뢰 문제로 이어집니다. 그래서 보정 엔진에는 **전역 연산만** 넣었습니다: 톤 커브 LUT와, 픽셀 자기 색만 보는 채도 조정입니다.
- 같은 색의 픽셀은 위치와 상관없이 같은 색이 되므로 시술 부위의 모양을 바꿀 수 없습니다. 이 성질은 테스트로 고정했습니다.
- 비포·애프터에는 반드시 같은 보정값을 쓰고, 업종별 보정 한계는 어떤 조정으로도 넘을 수 없게 했습니다.
- 생성된 글은 의료·효과를 단정하는 표현(차단), 과장(경고), AI 상투어(경고)를 정책 규칙으로 검사합니다. 차단 표현이 있으면 그 부분만 자동으로 고쳐 씁니다.
- 고객 얼굴이 보이면 게시 동의나 얼굴 가림 없이는 결과물을 만들지 않습니다. 이 검사는 서버 한 곳에서만 하고, 통과하지 못하면 409로 막습니다.

### 5. 운영 결과물에서 찾은 구도 문제 해결
- **문제:** 눈썹 비포·애프터에 눈썹 대신 미간만 보였습니다. 원인은 양쪽 눈썹의 '중심'만 기준으로 좁게 잘랐기 때문입니다.
- **해결:**
  - 사진 분석이 시술 부위 상자를 Gemini 학습 형식(`[ymin,xmin,ymax,xmax]`)으로 돌려주게 했습니다.
  - 사진과 영상이 같은 구도 규칙(`photocraft/crop.ts`)을 쓰게 했습니다.
  - 비포·애프터 배치는 부위가 잘리지 않고 크게 보이는 쪽(위아래/좌우)을 자동으로 고릅니다.
  - 원장님이 구도를 직접 맞출 수 있게 했고, 이 값은 AI 분석보다 우선합니다.
- 실제 샵 계정의 공개 게시물·쇼츠·블로그 글 약 40개를 분석해 레이아웃, 글자 위치, 장면 길이를 정했습니다 ([레퍼런스 분석](docs/ARCHITECTURE.md#10-레퍼런스-분석-2026-10-28)).

### 6. 확장은 코드가 아닌 데이터로: 프리셋 시스템
- 새 무드·목적·업종·포맷·금지 표현·프롬프트는 `presets/` 에 JSON이나 Markdown **파일을 추가하는 것만으로** 늘어납니다.
- 빌드할 때 zod 스키마와 교차 검증(폰트 파일 존재 여부, 정규식, 세이프존 등)을 거치고, 틀리면 빌드가 멈춥니다. 에디터 자동완성용 JSON Schema도 함께 만들어집니다.
- 값은 무드 < 목적 < 업종 < 브랜드 < 요청 순서로 덮어씁니다. 업종 보정 한계와 금지어는 마지막에 다시 적용됩니다.
- 프롬프트는 버전이 붙은 파일(`caption-instagram@2.md`)로 관리합니다. 생성 기록에 프롬프트 버전과 모델이 남아 품질을 비교하거나 이전 버전으로 되돌릴 수 있습니다.

### 7. 로컬 개발 환경: 운영 DB 없이 전체 흐름 실행
- PGlite(프로세스 안에서 도는 Postgres, WASM)와 로컬 저장소, 목 AI로 운영 Neon DB를 건드리지 않고 전체 흐름을 돌립니다.
- 개발 서버가 여러 개 동시에 떠서 같은 DB 폴더에 쓰다가 WAL이 깨진 일이 있었습니다. 원인을 추적한 뒤 pid 기반 잠금(죽은 프로세스의 잠금은 넘겨받음)과 종료 시 체크포인트를 추가해 다시 일어나지 않게 했습니다.

## 품질

- 단위·통합 테스트 **123개** (Vitest, 패키지 8개)
  - 영상 엔진: 실제 mp4를 만들어 길이·해상도·오디오 트랙을 검사
  - API: 작업 큐의 임대·인계·백오프와, 업로드부터 작업자 보고까지 전체 흐름을 통합 테스트
- 화면 E2E (Playwright, 아이폰 화면): 로그인 → 만들기 4단계 → 복사·저장 → 실제 영상 완성까지
- 독립 코드 리뷰로 찾은 9건(동의 우회, 완료 보고 중복 등)을 모두 고치고 테스트를 추가했습니다.
- 설계 결정은 날짜, 결정, 이유와 함께 [결정 기록](docs/ARCHITECTURE.md#8-결정-기록)에 남깁니다.

## 저장소 구성

```
apps/web      화면 (Vite React PWA)          apps/api     API (Hono, Vercel 함수)
apps/worker   영상 렌더 작업자 (Node)          presets/     스타일 프리셋 데이터 (JSON·프롬프트·폰트)
packages/     preset · ai · caption · photocraft · render · reel · platform · shared · ui
```

## 로컬에서 실행하기 (외부 서비스 없이)

```sh
pnpm install
pnpm build                                   # 패키지 빌드 (프리셋 검증 포함)

# 1) API — 로컬 DB(PGlite) · 로컬 저장소 · 목 AI. 매직링크는 이 터미널에 찍힌다
pnpm --filter @beautypost/api dev:local
#    실제 AI 로 보려면: AI_PROVIDER=live GOOGLE_GENERATIVE_AI_API_KEY=... pnpm --filter @beautypost/api dev:local

# 2) 영상 렌더 작업자 (ffmpeg 는 pnpm install 이 ffmpeg-static 으로 받아 둔다)
RENDER_API_URL=http://localhost:3000 RENDER_WORKER_TOKEN=local-worker-token pnpm --filter @beautypost/worker start

# 3) 화면
pnpm --filter @beautypost/web dev            # http://localhost:5173
```

로그인: 화면에서 이메일 입력 → API 터미널의 `[DEV EMAIL]` 링크를 브라우저로 연다.

```sh
pnpm test && pnpm typecheck                  # 전체 테스트
API_LOG=/tmp/api.log pnpm --filter @beautypost/web e2e    # 화면 E2E (API 로그를 파일로 남긴 상태에서)

# 엔진만 내 사진으로
pnpm --filter @beautypost/reel try <비포.jpg> <애프터.jpg> --mood warm-natural --format reel --out /tmp/reel
pnpm --filter @beautypost/photocraft try <비포.jpg> <애프터.jpg> --mood warm-natural --out /tmp/photos
```

## 스타일 프리셋 추가하기 (코드 수정 없음)

| 추가할 것 | 방법 |
|---|---|
| 무드(분위기) | `presets/moods/<새-id>/preset.json` (기존 무드를 복사해서 값만 바꾸기) → `pnpm --filter @beautypost/photocraft previews` 로 썸네일 생성 |
| 콘텐츠 목적 | `presets/purposes/<새-id>.json` — 필요한 사진 역할, 글 구조, 영상 장면(슬롯) |
| 업종 | `presets/industries/<새-id>.json` — 지역 키워드 패턴, 해시태그, 금지어, 보정 한계 |
| 출력 포맷 | `presets/formats/<새-id>.json` — 해상도, 길이, 세이프존, 비워 둘 자리 |
| 금지 표현 | `presets/policy/*.json` 의 `rules` 에 추가 (literal 또는 regex) |
| 프롬프트 개선 | `presets/prompts/<id>@<다음 버전>.md` 새 파일 (가장 높은 버전이 쓰임, `PROMPT_<ID>=<버전>` 으로 되돌리기) |
| 폰트 | `presets/fonts/<id>.json` + `presets/fonts/files/` 에 OFL 등 상업적 사용 가능 파일 |

파일 이름(무드는 폴더 이름)과 `id` 가 같아야 한다. 확인: `pnpm --filter @beautypost/preset generate` (틀리면 어디가 틀렸는지 알려 주고 실패).

## 운영

- **렌더 작업자:**
  - 맥에서 상시 실행합니다: `apps/worker/scripts/install-launchd.sh` (자동 시작·재시작, 로그 `~/Library/Logs/beautypost-worker.log`).
  - Node + ffmpeg 만 있으면 되므로 리눅스나 컨테이너로 그대로 옮길 수 있습니다.
  - 환경변수: `RENDER_API_URL`, `RENDER_WORKER_TOKEN`, `RENDER_ENGINE`, `WORK_DIR`, `POLL_INTERVAL_MS`, `LEASE_SEC`, `KEEP_WORK=1`
- **배포 (Vercel):** `vercel.json` 의 빌드 명령이 패키지(프리셋 검증 포함)와 화면을 빌드합니다. DB 마이그레이션은 데이터를 지우지 않는 추가만 하며, 배포 전에 `pnpm --filter @beautypost/api db:migrate` 를 직접 실행합니다.
- 기능 요약과 운영 설정 순서: [docs/SETUP.md](docs/SETUP.md)
