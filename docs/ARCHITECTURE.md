# 뷰티포스트 아키텍처 — 스타일 프리셋 기반 글·사진·영상 생성

> 상태: **구현 완료 (2026-10-24)** · 이 문서는 실제 코드 기준이다. 처음 설계안(2026-10-23)에서 바뀐 점은 [8. 결정 기록](#8-결정-기록)에.

## 0. 한 장 요약

원장님이 **업종**(반영구 눈썹·네일·헤어 …)과 **콘텐츠 목적**(비포·애프터·시술 과정 …)을 고르고 **역할별로 사진·영상을 올리면**,
**스타일(무드) 프리셋**에 맞춰 세 가지를 만든다. 결과는 원장님이 직접 올린다.

| 결과물 | 만드는 곳 | 원장님이 하는 일 |
|---|---|---|
| 게시글 초안 (인스타 후보 3 · 네이버 블로그 후보 2 · 카카오톡) | API 안에서 바로 (`packages/caption`) | **복사** 버튼 → 붙여넣기 |
| 보정 사진 (비포·애프터 콜라주 + 사진마다, 4:5·1:1·9:16) | API 안에서 바로 (`packages/photocraft`) | **저장** (휴대폰은 공유 시트 → 사진 앱) |
| 영상 (릴스·스토리·피드) | 작업 큐 → 렌더 작업자 → filmcraft | 완성 알림 → **저장** → 인스타 앱에서 음악 추가 |

- **인스타그램·페이스북 계정 연동은 보류** (2026-10-24 결정). 기존 연동·자동 게시 코드는 지우지 않고 `FEATURE_INSTAGRAM=true` 일 때만 메뉴에 나온다.
- **새 스타일·목적·업종·포맷·프롬프트는 `presets/` 에 파일을 추가하면 끝**이다. 빌드 때 스키마로 검증되고, 틀리면 빌드가 멈춘다.
- **사진과 영상이 같은 프리셋 스키마**를 쓴다 → 같은 무드로 만든 사진·영상의 톤이 같다.

## 1. 모듈 구성

```
presets/                    데이터 (코드 아님) — 무드·목적·업종·포맷·폰트·정책·프롬프트
packages/
  preset/                   스키마(zod) · 레지스트리(교차 검증) · 해석기(우선순위·한계값) · 빌드 스크립트
  ai/                       AI 모델 라우터 (역할별 모델·폴백, 목 클라이언트)
  caption/                  사진 분석 · 채널별 초안 · 정책 검사 · 자동 수정 · 영상 화면 자막
  photocraft/               사진 보정 (sharp): 전역 색보정·자동 WB·포맷 크롭·얼굴 가림·콜라주·문구/로고·카드
  render/                   filmcraft 어댑터: 장면(슬롯) 계획 → filmcraft profile.json · plan.json
  platform/                 브라우저 API 경계 (업로드·저장/공유·클립보드·영상 정보) — 앱 전환 대비
  shared/ ui/               기존 공용 타입·UI
apps/
  api/                      Hono API (Vercel 함수). routes 는 얇게, 로직은 services → packages
    src/services/           context(샵·브랜드·프리셋) · media(분석·동의) · drafts · photos · videos
    src/jobs/queue.ts       DB 작업 큐 (임대·하트비트·재시도)
    src/storage/            저장소 어댑터 (Vercel Blob / 로컬 디스크)
  web/                      Vite React PWA (얇은 화면: 고르기·올리기·보여 주기)
  worker/                   렌더 작업자 (Node). API 로만 통신 → filmcraft `./br render` 실행
../filmcraft                영상 엔진 (Python + FilmCraft). 이 저장소 밖, 별도 git
```

의존 방향: `web → (HTTP) → api → packages`, `worker → (HTTP) → api`, `worker → render/photocraft/preset`, `worker → (CLI) → filmcraft`.
패키지끼리는 export 한 타입·함수로만 의존한다. 각 패키지는 `dist/` 로 빌드되고 API·작업자는 빌드된 패키지를 쓴다.

## 2. 프리셋 시스템 (`presets/` + `packages/preset`)

| 종류 | 위치 | 들어 있는 것 |
|---|---|---|
| 무드 | `presets/moods/<id>/preset.json` + `thumb.jpg` | 팔레트, 색보정(Grade), 사진 프레임·문구 서체, 영상 길이·컷 길이·전환·모션·자막 서체 3종·음악 장르/BPM, 문구 톤·이모지 수 |
| 콘텐츠 목적 | `presets/purposes/<id>.json` | 필요한 사진 역할(최소·최대), 글 구조(후킹→공감→포인트→신뢰→예약), **영상 장면 템플릿(슬롯)**, 사진 레이아웃, 같은 보정값을 강제할 역할 |
| 업종 | `presets/industries/<id>.json` | 지역 키워드 패턴(`{region} 눈썹문신`), 해시태그 씨앗, 어휘, 업종 금지어, **보정 한계값** |
| 포맷 | `presets/formats/<id>.json` | 해상도·fps·길이·세이프존·예약 스티커 자리·인코딩 |
| 폰트 | `presets/fonts/<id>.json` + `files/` | 상업적 사용 가능 폰트(OFL)와 굵기별 파일 |
| 정책 | `presets/policy/<id>.json` | 의료·효과 단정(block), 과장(warn), AI 상투어(warn) 규칙과 대체 제안 |
| 프롬프트 | `presets/prompts/<id>@<버전>.md` | 사진 분석·인스타·블로그·자동 수정·영상 자막 프롬프트 |

현재: 무드 5 · 목적 6 · 업종 9(반영구 눈썹·속눈썹·네일·헤어·두피문신·입술·왁싱·피부·메이크업) · 포맷 4 · 폰트 4 · 정책 3 · 프롬프트 5.

**값의 우선순위** (`resolvePreset`): 무드 < 목적 < 업종 < 브랜드(샵 기본값) < 이번 요청의 조정.
업종 보정 한계와 정책 금지어는 마지막에 다시 적용해 **어떤 조정으로도 넘을 수 없다**. 브랜드의 시각 차이값은 브랜드 기준 무드일 때만 쓴다.

**빌드**: `pnpm --filter @beautypost/preset generate` 가 `presets/**` 를 읽고 → zod 검증 + 교차 검증(폰트·굵기·역할·정규식·세이프존·폰트 파일 존재)
→ `src/generated/registry.ts`(번들에 들어가는 모듈, 썸네일 base64 포함)와 `presets/_schema/*.schema.json`(에디터 자동완성)을 만든다.
Vercel 빌드 명령에 포함돼 있어 **파일을 추가하고 배포하면 끝**이다. 무드 썸네일은 `pnpm --filter @beautypost/photocraft previews` 로 실제 보정 코드가 만든다.

## 3. 게시글 초안 (`packages/caption`)

```
업로드 → 사진 분석(비전, 사진당 1회 캐시: media.analysis — 보이는 것만, 얼굴 영역, 시술 부위 중심)
       → 인스타 후보 3 (후킹 방식이 다른) + 블로그 후보 2 (병렬)
       → 해시태그 정리(지역+시술 우선, 10~15개) · 블로그 제목 키워드 보장 · 사진 위치 [사진 N] 보정
       → 정책 검사 → block 이 있으면 그 표현만 1회 자동 수정 → 남은 문제는 화면에 표시
       → 원장님이 복사(=선택)·수정 → generations 에 저장 → 다음 생성의 말투 샘플
```

- 프롬프트는 버전 파일. 생성 기록에 `caption-instagram@1` 처럼 버전과 모델이 남는다. `PROMPT_<ID>=<n>` 으로 버전 고정.
- 모델: `packages/ai` — 역할(`vision`·`copy`)별 후보 순서(기본 Gemini → AI Gateway Claude), `AI_MODELS_<ROLE>` 로 교체. AI SDK v6 `generateText + Output.object`.
- 말투: 브랜드 설정의 "내 말투 샘플"(style_examples) + 최근 복사한 인스타 글 3개.
- 카카오톡 문구는 인스타 후보에서 해시태그를 빼고 매장·예약 줄을 붙여 만든다.

## 4. 사진 보정 (`packages/photocraft`)

- **전역 연산만**: 채널별 톤 커브 LUT(노출·화이트밸런스·대비·하이라이트·섀도·페이드) + 픽셀 자신의 색만 보는 채도·바이브런스.
  같은 색 픽셀은 위치와 상관없이 같은 색이 된다 → 시술 부위의 모양·질감을 바꿀 수 없다 (테스트로 고정).
  형태 변형·부분 보정·피부 보정 기능은 **존재하지 않는다**.
- **같은 보정값**: 한 요청의 사진 전체를 합친 통계로 자동 밝기·WB 를 한 번 계산 → 비포·애프터 콜라주는 `grade` 를 하나만 받는다.
- **자동 교정은 틀어진 쪽으로만**: 어두우면 밝게(밝게 잘 찍힌 사진은 그대로, 확실한 과노출만 낮춤), 푸른·초록 조명은 중립 쪽으로 70%,
  따뜻한 쪽은 피부 클로즈업의 자연스러운 따뜻함을 넘는 부분만. 업종 보정 한계는 스타일(무드·조정)에만 걸고 자동 교정에는 걸지 않는다
  (틀어진 조명을 되돌리는 것은 과장이 아니므로). 원래 색을 모르는 심한 색 틀어짐은 중립까지만 되돌린다
- 얼굴 (`services/media.ts consentOk` 가 유일한 기준, API 가 409 로 막음):
  - 사진: 분석에서 얼굴이 보이면 **게시 동의**(granted) 또는 **얼굴 가림**(blurred). 얼굴이 보이는 사진에 "얼굴 없음"은 서버가 거부. 역할을 바꿔 다시 분석했는데 얼굴이 나오면 다시 묻는다
  - 영상: 대표 화면 한 장으로는 얼굴이 없다고 할 수 없어 **항상 원장님께 묻는다** ("얼굴 안 나와요" 또는 고객 동의). 영상 얼굴 가림은 아직 없다
- 글자: 폰트 파일 글리프를 SVG 경로로 그린다(opentype.js) → 서버에 폰트가 없어도, 맥/리눅스 어디서나 같은 결과. 없는 글리프는 Pretendard 로 대체.
- EXIF(위치 등)는 출력에 남기지 않는다.

## 5. 영상 (작업 큐 → 렌더 작업자 → filmcraft)

```
web ──POST /api/create/videos──▶ api: 분석·동의 확인 → 장면 계획 → 화면 자막(AI·정책 검사) → RenderSpec → jobs 에 등록 → 202 즉시 응답
worker ──POST /api/worker/claim──▶ api: SQL 한 문장으로 임대 (FOR UPDATE SKIP LOCKED, 임대 토큰 발급)
worker: 내려받기 → (사진 얼굴 가림) → 카드 PNG(photocraft) → plan.json·profile.json(render) → filmcraft `./br render` → QA
worker ──upload-ticket → 저장소에 직접 업로드──▶ complete ──▶ api: media 등록 · 알림 "영상이 완성됐어요"
web: GET /api/create/jobs/:id 폴링 (단계·진행률) → 완성되면 재생·저장
```

- **유실 방지**: 작업 중 하트비트(10초)로 임대 연장. 작업자가 죽으면 임대가 만료되고 다음 claim 이 이어받는다(시도 횟수 +1, 3회까지, 백오프 30s·2m·10m).
  임대마다 토큰이 달라 늦게 도착한 옛 작업자의 보고는 무시된다. SIGTERM/Ctrl+C 면 임대를 반납해 바로 대기열로 돌아간다.
  (2026-10-24 실측: 렌더 중 `kill -9` → 새 작업자가 2번째 시도로 완료 / SIGTERM → 즉시 pending)
- **작업자 ↔ DB**: 작업자는 DB 에 붙지 않는다. 필요한 설정은 `RENDER_API_URL`·`RENDER_WORKER_TOKEN` 과 filmcraft 경로뿐 → 맥·VPS·컨테이너 어디로든 옮길 수 있다.
- **filmcraft 일반화** (복사 없이): `BABYREEL_CONFIG` 로 채널 프로필을 바꿔 끼우고, `./br render <작업폴더> --profile profile.json` 로 세로 영상 한 편을 만든다
  (에피소드 부수 효과 없음). 색보정(Lumetri 추가 파라미터)·자막 색·강조 서체 굵기·전환은 **기본값이 기존 값과 같은 설정 키**로 추가했다.
  → 기존 육아 채널 빌드가 보내는 FilmCraft 명령 898개가 변경 전후 **완전히 같음**을 확인, 단위 테스트 102개·selftest 통과.
- 음악: 기본은 **BGM 없이** 내보내고, 결과 화면에 무드의 추천 장르·BPM 을 보여 준다 (인스타 앱 음원이 도달에 유리, 저작권 표기 부담 없음).
- 이식성: FilmCraft 는 linux x86_64/aarch64 빌드가 있다. 뷰티 프로필은 macOS 전용 기능(Vision 얼굴 인식, Swift 썸네일)을 쓰지 않는다 → Docker 로 옮길 때 FilmCraft 리눅스 빌드·Python·폰트만 넣으면 된다.

## 6. 저장소·DB

- 저장소 어댑터: `BLOB_READ_WRITE_TOKEN` 이 있으면 Vercel Blob(브라우저·작업자는 **클라이언트 토큰으로 직접 업로드** → 함수 본문 4.5MB 제한 회피), 없으면 로컬 디스크(`.data/storage`, `/api/files/*` 서명 업로드).
- DB 변경(마이그레이션 0003·0004, 추가만): `brand_profiles`, `generations`, `media`(역할·분석·동의·얼굴·출처·포맷), `jobs`(임대·재시도·진행률), 알림 종류 `render_failed`.
  `jobs.status` 기존 enum 을 그대로 쓴다: pending=대기(재시도 대기 포함) · processing=임대 중 · completed · failed=재시도 소진.
- 로컬 개발·테스트는 PGlite(프로세스 안 Postgres, UTC 세션)로 운영 Neon 을 건드리지 않는다.

## 7. 테스트

| 범위 | 위치 | 내용 |
|---|---|---|
| 프리셋 | `packages/preset/test` | 모든 프리셋 파일 검증, 파일 추가만으로 등록, 잘못된 값·폰트·id·정규식 검출, 우선순위·한계값, 정책 정규식("반영구" 오탐 방지) |
| 게시글 | `packages/caption/test` | 프롬프트 버전·렌더, 정책 검사, 해시태그·지역 키워드·블로그 사진 자리, 후보 생성, 금지 표현 자동 수정, 영상 자막 |
| 사진 | `packages/photocraft/test` | 전역 연산 성질, 업종 한계, 자동 WB, 포맷 크기·EXIF 제거, 얼굴 가림, 예약 스티커 자리, 콜라주 동일 보정, 카드 |
| 영상 어댑터 | `packages/render/test` | 슬롯 배정·길이 분배·컷 수 조절·펀치줌, 프로필(색보정·서체·전환·스토리 세이프존), plan.json |
| API | `apps/api/test` | 작업 큐(임대·인계·백오프·반납), 전체 흐름 통합(업로드·동의·초안·사진·영상 작업·작업자 보고), refresh 토큰 |
| 작업자 | `apps/worker/test` | 가짜 filmcraft 로 파이프라인 전체·오류 분류·대기 중단·폰트 설치 |
| 화면 E2E | `apps/web/e2e` | Playwright(아이폰 화면): 로그인 → 만들기 4단계 → 복사·저장 → 실제 영상 완성 → 만든 영상 → 브랜드 설정 |
| filmcraft | `../filmcraft` | `./br selftest`, 단위 테스트, 빌드 명령 동일성 |

## 8. 결정 기록

| 날짜 | 결정 | 이유 |
|---|---|---|
| 10-23 | 본인 계정 컨셉 유지 → 브랜드 프리셋을 생성 기본값으로 | 원장님은 기존 릴스와 같은 컨셉을 원함 |
| 10-24 | **인스타·페이스북 연동 보류**, 결과는 복사·저장으로 | API 연동이 초보 원장님께 진입장벽. 계정 분석·자동 게시는 모듈로 남겨 나중에 추가 |
| 10-24 | 렌더 작업자를 Python 이 아닌 **Node(apps/worker)** 로, filmcraft 는 CLI(`./br render`) 로 호출 | 업로드(Vercel Blob 클라이언트)·카드 그리기·스키마를 TS 패키지와 공유, filmcraft 는 엔진으로만 |
| 10-24 | photocraft 는 MCP 가 아닌 라이브러리 | 프리셋 값을 결정적으로 적용하는 일이라 에이전트 루프가 필요 없음 |
| 10-24 | 글자는 Pango 대신 opentype.js | sharp 의 Pango `fontfile` 이 맥(CoreText)에서 무시됨 → 플랫폼마다 결과가 달라짐 |
| 10-24 | 영상 BGM 기본 없음 + 추천 장르 안내 | 인스타 앱 음원 사용이 유리, CC BY 표기 부담 제거 |
| 10-24 | 독립 코드 리뷰 반영: 동의 우회 차단, 짧은 영상 길이, 실패 후 재시도, 해시태그 정책 검사, 완료 보고 중복 방지, 저장소 소유 확인(head), 잠금 최대 대기 | 리뷰에서 찾은 9건 모두 수정·테스트 추가 |
| 10-24 | Business Discovery 미사용 | Facebook Login 전용·별도 심사, 다른 계정 영상 URL 제한 → 스크린샷 업로드가 같은 목적을 달성 |

## 9. 나중에 붙일 수 있는 것 (모듈 자리만 있음)

- 본인 인스타 계정 분석 → 브랜드 프리셋 자동 생성 (`BrandPreset.source: 'own-account'`, Instagram Login `instagram_business_basic`)
- 레퍼런스 스크린샷 → 가장 가까운 무드 + 차이값(커스텀 프리셋) (`media-analysis` 확장 + `BrandPreset.overrides`)
- 영상 속 얼굴 가림(얼굴 추적), BGM 자동 선택, 무드별 샘플 영상, Docker 작업자 이미지
