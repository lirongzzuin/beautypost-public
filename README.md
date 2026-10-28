# 뷰티포스트

1인 뷰티샵 원장님이 사진·영상을 올리면 **업종·콘텐츠 목적·스타일 프리셋**에 맞춰
**게시글 초안(인스타·네이버 블로그·카카오톡), 게시용 사진(밝기·색감 맞춤 + 인스타 크기), 릴스·스토리 영상**을 만들어 주는 서비스.
글·영상 문법은 잘 되는 시술샵 계정들(시술 기록형 글, 고정 예약 안내, 해시태그 3~5개, 클로즈업·위아래 비포·애프터·세리프 이름표 영상)을 기준으로 맞췄다 (docs/ARCHITECTURE.md 9장).
결과는 복사·저장해서 원장님이 직접 올린다 (인스타그램 계정 연동은 보류, `FEATURE_INSTAGRAM`).

구조와 설계 이유: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · 기능 요약과 운영 설정 순서: **[docs/SETUP.md](docs/SETUP.md)**

## 구성

```
apps/web      화면 (Vite React PWA)          apps/api     API (Hono, Vercel 함수)
apps/worker   영상 렌더 작업자 (Node)          presets/     스타일 프리셋 데이터 (JSON·프롬프트·폰트)
packages/     preset · ai · caption · photocraft · render · reel · platform · shared · ui
              reel = 기본 영상 엔진 (프레임 직접 합성 + ffmpeg, 영상 한 편 수 초)
../filmcraft  예전 영상 엔진 (별도 저장소, RENDER_ENGINE=filmcraft 일 때만)
```

## 로컬에서 전체 실행 (운영 DB·외부 서비스 없이)

```sh
pnpm install
pnpm build                                   # 패키지 빌드 (프리셋 검증 포함)

# 1) API — 로컬 DB(PGlite) · 로컬 저장소 · 목 AI. 매직링크는 이 터미널에 찍힌다
pnpm --filter @beautypost/api dev:local
#    실제 AI 로 보려면: AI_PROVIDER=live GOOGLE_GENERATIVE_AI_API_KEY=... pnpm --filter @beautypost/api dev:local

# 2) 영상 렌더 작업자 (기본 엔진은 ffmpeg 만 있으면 된다 — pnpm install 이 ffmpeg-static 으로 받아 둔다)
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
| 프롬프트 개선 | `presets/prompts/<id>@<다음 버전>.md` 새 파일 (가장 높은 버전이 쓰임, `PROMPT_<ID>=<버전>` 으로 되돌리기) |
| 폰트 | `presets/fonts/<id>.json` + `presets/fonts/files/` 에 OFL 등 상업적 사용 가능 파일 |

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

- 맥에서 상시 실행: `RENDER_API_URL=… RENDER_WORKER_TOKEN=… apps/worker/scripts/install-launchd.sh` (로그인 때 자동 시작·꺼지면 재시작, 로그 `~/Library/Logs/beautypost-worker.log`). 렌더 중 작업자를 꺼도 작업은 사라지지 않는다 (임대 만료 후 다시 처리).
- 기본 엔진(`packages/reel`)은 Node + ffmpeg 만 쓴다 (`ffmpeg-static`, 다른 ffmpeg 를 쓰려면 `FFMPEG_PATH`). 맥·리눅스·컨테이너 어디서나 같다.
- 예전 엔진: `RENDER_ENGINE=filmcraft` — filmcraft 저장소(`./br`), FilmCraft CLI, Python 환경이 필요하고 영상 한 편에 2~3분 걸린다.
- 환경변수: `RENDER_API_URL`, `RENDER_WORKER_TOKEN`(API 와 같은 값), `RENDER_ENGINE`, `WORK_DIR`, `POLL_INTERVAL_MS`(기본 3초), `LEASE_SEC`, `KEEP_WORK=1`(작업 폴더 남기기), filmcraft 엔진만 `FILMCRAFT_DIR`·`FONTS_DIR`.
- 내 사진으로 엔진만 바로 돌려 보기: `pnpm --filter @beautypost/reel try <비포.jpg> <애프터.jpg> [과정.jpg|mp4] --mood warm-natural --format reel --out /tmp/reel`
- 큐 없이 작업 입력(spec)으로 한 편: `pnpm --filter @beautypost/worker exec tsx scripts/sample-spec.ts .data/s/spec.json --mood trendy-fast && pnpm --filter @beautypost/worker render-local .data/s/spec.json`

## 배포 (Vercel)

1. 환경변수: `RENDER_WORKER_TOKEN` 추가 (`.env.example` 4-1). 나머지는 기존 그대로.
2. DB 마이그레이션 (0003~0005, 추가만): `pnpm --filter @beautypost/api db:migrate` — **운영 DB 에 적용되므로 배포 전에 직접 실행**. 새 코드는 0005(`brand_profiles.content_settings`)가 없으면 동작하지 않는다.
3. 렌더 작업자를 새 코드로 다시 켠다 (새 API 가 만드는 작업 입력은 예전 작업자가 읽지 못한다): `pnpm install && pnpm build && launchctl kickstart -k gui/$(id -u)/com.beautypost.worker` (install 이 ffmpeg 를 받고, 작업자는 빌드된 패키지를 쓴다)
4. 배포하면 `vercel.json` 의 빌드 명령이 패키지(프리셋 검증 포함)와 화면을 빌드한다. 폰트 파일은 API 함수에 함께 들어간다(`includeFiles`).
