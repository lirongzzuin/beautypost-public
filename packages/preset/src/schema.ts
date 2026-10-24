import { z } from 'zod'

// 프리셋 스키마 — presets/**/*.json 파일이 따라야 하는 형식.
// 사진(photocraft)과 영상(filmcraft)이 같은 스키마를 공유해 톤을 맞춘다. 설계: docs/ARCHITECTURE.md 3장.

export const Id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id 는 소문자·숫자·하이픈만 (예: clean-white)')
export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, '색은 #RRGGBB')
export const Range = z
  .tuple([z.number(), z.number()])
  .refine(([a, b]) => a <= b, '범위는 [작은 값, 큰 값]')

// ─── 색보정 ────────────────────────────────────────────────────────────────────
// 전역(화면 전체에 균일하게) 연산만 있다. 형태 변형·부분 보정·피부 보정은 스키마에 아예 없다 (과장 광고 방지).
// 단위는 사진·영상 공통의 정규화 값이며, photocraft(sharp)와 filmcraft(Lumetri) 어댑터가 각자 엔진 값으로 바꾼다.

export const GRADE_BOUNDS = {
  exposure: [-1, 1], // EV
  temperature: [-30, 30], // + 따뜻하게 / - 차갑게
  tint: [-30, 30], // + 마젠타 / - 그린
  contrast: [-30, 30],
  saturation: [-40, 30],
  vibrance: [-30, 30],
  highlights: [-40, 40],
  shadows: [-40, 40],
  fade: [0, 30], // 블랙 들어올림 (필름 톤)
} as const satisfies Record<string, readonly [number, number]>

export type GradeKey = keyof typeof GRADE_BOUNDS
export const GRADE_KEYS = Object.keys(GRADE_BOUNDS) as GradeKey[]

const gradeField = (k: GradeKey) => z.number().min(GRADE_BOUNDS[k][0]).max(GRADE_BOUNDS[k][1])

export const Grade = z.object(
  Object.fromEntries(GRADE_KEYS.map((k) => [k, gradeField(k).default(0)])) as {
    [K in GradeKey]: z.ZodDefault<z.ZodNumber>
  },
)
export const GradePatch = z.object(
  Object.fromEntries(GRADE_KEYS.map((k) => [k, gradeField(k).optional()])) as {
    [K in GradeKey]: z.ZodOptional<z.ZodNumber>
  },
)
// 업종별 보정 한계: 브랜드 프리셋·수동 조정으로도 넘을 수 없다 (예: 네일은 채도를 크게 못 올림)
export const GradeLimits = z.object(
  Object.fromEntries(GRADE_KEYS.map((k) => [k, Range.optional()])) as {
    [K in GradeKey]: z.ZodOptional<typeof Range>
  },
)

// ─── 글자 ──────────────────────────────────────────────────────────────────────

export const TextStyle = z.object({
  font: Id, // presets/fonts 에 등록된 id
  weight: z.enum(['Regular', 'Medium', 'Bold']).default('Bold'),
  color: Hex,
  stroke: Hex.nullable().default(null),
  background: Hex.nullable().default(null),
  position: z.enum(['top', 'center', 'lower-third', 'bottom']).default('lower-third'),
  animation: z.enum(['none', 'fade', 'pop', 'typewriter']).default('fade'),
})

export const Palette = z.object({ primary: Hex, accent: Hex, background: Hex, text: Hex })

// ─── 무드 프리셋 (presets/moods/<id>/preset.json) ──────────────────────────────

export const MoodPreset = z.object({
  $schema: z.string().optional(),
  id: Id,
  version: z.number().int().positive(),
  label: z.string().min(1), // 원장님 화면에 보이는 이름: "깔끔·화이트톤"
  description: z.string(), // 관리용 설명 (원장님 화면에는 미리보기로 대신)
  order: z.number().int().default(100), // 목록 정렬
  palette: Palette,
  grade: Grade,
  photo: z.object({
    frame: z.enum(['none', 'border', 'polaroid']).default('none'),
    overlay: TextStyle,
  }),
  video: z.object({
    durationSec: Range, // 선호 길이 (포맷 범위와 교집합)
    cutSec: Range, // 컷 하나 길이
    transition: z.enum(['cut', 'crossfade', 'whip', 'zoom', 'flash']),
    transitionSec: z.number().min(0).max(1),
    motion: z.enum(['static', 'slow-push', 'punch']),
    captions: z.object({ main: TextStyle, emphasis: TextStyle, label: TextStyle }),
    music: z.object({
      genres: z.array(z.string()).min(1),
      bpm: Range,
      energy: z.enum(['low', 'mid', 'high']),
    }),
  }),
  copy: z.object({
    tone: z.enum(['calm', 'friendly', 'bright', 'premium', 'witty']),
    emojiPerParagraph: Range,
    sentenceLength: z.enum(['short', 'medium']),
  }),
})

// ─── 콘텐츠 목적 (presets/purposes/<id>.json) ─────────────────────────────────

export const MEDIA_ROLES = ['before', 'after', 'process', 'detail', 'shop', 'owner', 'review', 'product', 'any'] as const
export const MediaRole = z.enum(MEDIA_ROLES)

export const Slot = z.object({
  role: z.enum(['hook', 'before', 'process', 'after', 'detail', 'shop', 'owner', 'review', 'info', 'cta']),
  durationSec: Range,
  source: z.enum(['media', 'card']), // card = 브랜드 배경 위 문구 (CTA 등)
  mediaRole: MediaRole.optional(),
  optional: z.boolean().default(false),
  caption: z.object({ intent: z.string(), maxChars: z.number().int().positive() }).optional(),
})

export const COPY_SECTIONS = ['hook', 'empathy', 'point', 'trust', 'cta', 'info', 'care-tip'] as const

export const PurposePreset = z.object({
  $schema: z.string().optional(),
  id: Id,
  version: z.number().int().positive(),
  label: z.string().min(1),
  description: z.string(),
  order: z.number().int().default(100),
  legacyThemes: z.array(z.string()).default([]), // 기존 POST_THEMES id (하위호환)
  requiredMedia: z.array(
    z.object({ role: MediaRole, min: z.number().int().min(0), max: z.number().int().positive() })
      .refine((m) => m.min <= m.max, 'min ≤ max'),
  ),
  copyStructure: z.array(z.enum(COPY_SECTIONS)).min(1),
  video: z.object({ slots: z.array(Slot).min(1) }),
  photo: z.object({ layout: z.enum(['single', 'carousel', 'before-after-split', 'grid']) }),
  sameGradeAcrossRoles: z.array(MediaRole).default([]), // 예: ['before','after'] → 동일 보정값 강제
})

// ─── 출력 포맷 (presets/formats/<id>.json) ────────────────────────────────────

export const OutputFormat = z.object({
  $schema: z.string().optional(),
  id: Id,
  label: z.string().min(1),
  kind: z.enum(['video', 'photo', 'both']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().default(30),
  durationSec: Range.optional(),
  safeArea: z.object({ top: z.number().min(0), bottom: z.number().min(0), side: z.number().min(0) }),
  // 자막·스티커가 들어가면 안 되는 자리 (예: 스토리의 예약 링크 스티커)
  reserved: z
    .array(z.object({ name: z.string(), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }))
    .default([]),
  encode: z.object({ videoKbps: z.number().positive(), audioKbps: z.number().positive() }).optional(),
})

// ─── 업종 (presets/industries/<id>.json) ──────────────────────────────────────

export const IndustryPreset = z.object({
  $schema: z.string().optional(),
  id: Id,
  label: z.string().min(1),
  order: z.number().int().default(100),
  serviceKeys: z.array(z.string()).default([]), // SERVICE_CATALOG 키 (하위호환)
  keywordPatterns: z.array(z.string()).min(1), // "{region} 눈썹문신"
  hashtagSeeds: z.array(z.string().startsWith('#')).min(1),
  vocabulary: z.array(z.string()).default([]),
  extraBannedPhrases: z.array(z.string()).default([]),
  gradeLimits: GradeLimits.default({}),
})

// ─── 폰트 (presets/fonts/<id>.json) ───────────────────────────────────────────

export const FontDef = z.object({
  $schema: z.string().optional(),
  id: Id,
  family: z.string().min(1), // 엔진에 넘길 폰트 이름
  license: z.string().min(1), // 상업적 사용 가능 라이선스만 (예: OFL-1.1)
  source: z.string().url(),
  styles: z.array(z.enum(['Regular', 'Medium', 'Bold'])).min(1),
})

// ─── 정책: 금지·과장·의료 표현, AI 상투어 (presets/policy/<id>.json) ──────────

export const PolicyRule = z.object({
  match: z.string().min(1),
  kind: z.enum(['literal', 'regex']).default('literal'),
  reason: z.string().min(1),
  suggest: z.string().optional(), // 대체 표현 제안
})

export const PolicyList = z.object({
  $schema: z.string().optional(),
  id: Id,
  label: z.string().min(1),
  severity: z.enum(['block', 'warn']), // block: 그대로 게시 불가, warn: 수정 권장
  rules: z.array(PolicyRule).min(1),
})

// ─── 브랜드 프리셋 (샵 단위, DB 저장) ──────────────────────────────────────────
// 파일 프리셋(baseMood)과의 차이값만 저장한다. "내 계정 스타일"은 이것으로 표현된다 (ARCHITECTURE 4장).

export const MoodOverrides = z.object({
  palette: Palette.partial().optional(),
  grade: GradePatch.optional(),
  photo: z.object({ frame: MoodPreset.shape.photo.shape.frame.optional(), overlay: TextStyle.partial().optional() }).optional(),
  video: z
    .object({
      durationSec: Range.optional(),
      cutSec: Range.optional(),
      transition: MoodPreset.shape.video.shape.transition.optional(),
      transitionSec: z.number().min(0).max(1).optional(),
      motion: MoodPreset.shape.video.shape.motion.optional(),
      captions: z
        .object({ main: TextStyle.partial().optional(), emphasis: TextStyle.partial().optional(), label: TextStyle.partial().optional() })
        .optional(),
      music: MoodPreset.shape.video.shape.music.partial().optional(),
    })
    .optional(),
  copy: MoodPreset.shape.copy.partial().optional(),
})

export const BrandPreset = z.object({
  baseMood: Id,
  overrides: MoodOverrides.default({}),
  source: z.enum(['manual', 'own-account', 'reference-upload']),
  brandColor: Hex.optional(),
  logoMediaId: z.string().optional(),
  voice: z
    .object({
      samples: z.array(z.string()).max(10).default([]),
      emojiRate: z.number().min(0).optional(), // 문단당 평균 이모지 수
      avgParagraphs: z.number().min(0).optional(),
    })
    .default({ samples: [] }),
})

export type Grade = z.infer<typeof Grade>
export type GradePatch = z.infer<typeof GradePatch>
export type GradeLimits = z.infer<typeof GradeLimits>
export type TextStyle = z.infer<typeof TextStyle>
export type MoodPreset = z.infer<typeof MoodPreset>
export type PurposePreset = z.infer<typeof PurposePreset>
export type OutputFormat = z.infer<typeof OutputFormat>
export type IndustryPreset = z.infer<typeof IndustryPreset>
export type FontDef = z.infer<typeof FontDef>
export type PolicyList = z.infer<typeof PolicyList>
export type PolicyRule = z.infer<typeof PolicyRule>
export type MoodOverrides = z.infer<typeof MoodOverrides>
export type BrandPreset = z.infer<typeof BrandPreset>
export type BrandPresetInput = z.input<typeof BrandPreset>

// presets/ 폴더의 종류별 하위 폴더 ↔ 스키마. 새 "종류"를 추가할 때만 여기를 고친다 (새 프리셋은 파일만 추가).
export const KINDS = {
  moods: MoodPreset,
  purposes: PurposePreset,
  formats: OutputFormat,
  industries: IndustryPreset,
  fonts: FontDef,
  policy: PolicyList,
} as const

export type Kind = keyof typeof KINDS
