# 뷰티포스트

1인 뷰티샵 원장님이 사진·영상을 올리면 **업종·콘텐츠 목적·스타일 프리셋**에 맞춰
**게시글 초안(인스타·네이버 블로그·카카오톡), 보정 사진, 릴스·스토리 영상**을 만들어 주는 서비스.
결과는 복사·저장해서 원장님이 직접 올린다 (인스타그램 계정 연동은 보류, `FEATURE_INSTAGRAM`).

구조와 설계 이유: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

## 구성

```
apps/web      화면 (Vite React PWA)          apps/api     API (Hono, Vercel 함수)
apps/worker   영상 렌더 작업자 (Node)          presets/     스타일 프리셋 데이터 (JSON·프롬프트·폰트)
packages/     preset · ai · caption · photocraft · render · platform · shared · ui
../filmcraft  영상 엔진 (별도 저장소, Python + FilmCraft)
```

## 로컬에서 전체 실행 (운영 DB·외부 서비스 없이)

```sh
pnpm install
pnpm build                                   # 패키지 빌드 (프리셋 검증 포함)

# 1) API — 로컬 DB(PGlite) · 로컬 저장소 · 목 AI. 매직링크는 이 터미널에 찍힌다
pnpm --filter @beautypost/api dev:local
#    실제 AI 로 보려면: AI_PROVIDER=live GOOGLE_GENERATIVE_AI_API_KEY=... pnpm --filter @beautypost/api dev:local

# 2) 영상 렌더 작업자 (filmcraft 가 ../../../filmcraft 에 있다고 가정, 아니면 FILMCRAFT_DIR)
RENDER_API_URL=http://localhost:3000 RENDER_WORKER_TOKEN=local-worker-token pnpm --filter @beautypost/worker start

# 3) 화면
pnpm --filter @beautypost/web dev            # http://localhost:5173
```

로그인: 화면에서 이메일 입력 → API 터미널의 `[DEV EMAIL]` 링크를 브라우저로 연다.

## 스타일 프리셋 추가하기 (코드 수정 없음)

| 추가할 것 | 방법 |
|---|---|
| 무드(분위기) | `presets/moods/<새-id>/preset.json` (기존 무드를 복사해서 값만 바꾸기) → `pnpm --filter @beautypost/photocraft previews` 로 썸네일 생성 |
| 콘텐츠 목적 | `presets/purposes/<새-id>.json` — 필요한 사진 역할, 글 구조, 영상 장면(슬롯) |
| 업종 | `presets/industries/<새-id>.json` — 지역 키워드 패턴, 해시태그, 금지어, 보정 한계 |
| 출력 포맷 | `presets/formats/<새-id>.json` — 해상도, 길이, 세이프존, 비워 둘 자리 |
| 금지 표현 | `presets/policy/*.json` 의 `rules` 에 추가 (literal 또는 regex) |
| 프롬프트 개선 | `presets/prompts/<id>@<다음 버전>.md` 새 파일 (가장 높은 버전이 쓰임) |

파일 이름(무드는 폴더 이름)과 `id` 가 같아야 한다. 확인: `pnpm --filter @beautypost/preset generate` (틀리면 어디가 틀렸는지 알려 주고 실패).
에디터에서 `"$schema": "../_schema/<종류>.schema.json"` 을 넣으면 자동완성된다. 배포하면 화면에 바로 나타난다.

## 테스트

```sh
pnpm test                                    # 전체 단위·통합 테스트 (turbo)
pnpm typecheck

# 화면 E2E (위 1~3 을 띄운 상태에서; API 로그를 파일로 남겨야 매직링크를 읽는다)
#   pnpm --filter @beautypost/api dev:local > /tmp/api.log 2>&1 &
API_LOG=/tmp/api.log pnpm --filter @beautypost/web e2e
```

## 영상 렌더 작업자 운영

- 맥에서 상시 실행: 위 2) 명령을 `launchd` 나 터미널에서. 렌더 중 작업자를 꺼도 작업은 사라지지 않는다 (임대 만료 후 다시 처리).
- 필요한 것: filmcraft 저장소(`./br`), FilmCraft CLI, Python 환경 (`filmcraft/scripts/setup.sh`). 작업자가 처음 시작할 때 `presets/fonts/files` 의 폰트를 사용자 폰트 폴더에 설치한다.
- 환경변수: `RENDER_API_URL`, `RENDER_WORKER_TOKEN`(API 와 같은 값), `FILMCRAFT_DIR`, `WORK_DIR`, `FONTS_DIR`, `POLL_INTERVAL_MS`, `LEASE_SEC`, `KEEP_WORK=1`(작업 폴더 남기기).
- 큐 없이 한 편 렌더 (프리셋 확인용): `pnpm --filter @beautypost/worker exec tsx scripts/sample-spec.ts .data/s/spec.json --mood trendy-fast && pnpm --filter @beautypost/worker render-local .data/s/spec.json`

## 배포 (Vercel)

1. 환경변수: `RENDER_WORKER_TOKEN` 추가 (`.env.example` 4-1). 나머지는 기존 그대로.
2. DB 마이그레이션 (0003·0004, 추가만): `pnpm --filter @beautypost/api db:migrate` — **운영 DB 에 적용되므로 배포 전에 직접 실행**.
3. 배포하면 `vercel.json` 의 빌드 명령이 패키지(프리셋 검증 포함)와 화면을 빌드한다. 폰트 파일은 API 함수에 함께 들어간다(`includeFiles`).
