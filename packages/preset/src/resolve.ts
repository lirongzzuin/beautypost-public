import {
  GRADE_KEYS,
  MoodPreset,
  type BrandPresetInput,
  type Grade,
  type IndustryPreset,
  type MoodOverrides,
  type OutputFormat,
  type PolicyList,
  type PurposePreset,
} from './schema.js'
import { BrandPreset as BrandPresetSchema, MoodOverrides as MoodOverridesSchema } from './schema.js'
import type { Registry } from './registry.js'

// 생성 한 번에 쓸 최종 값 계산.
// 우선순위: 무드 < 콘텐츠 목적 < 업종 < 브랜드(내 샵 스타일) < 이번 생성의 수동 조정.
// 업종의 보정 한계(gradeLimits)와 정책 금지어는 마지막에 다시 적용해 어떤 조정으로도 넘을 수 없다.

export interface ResolveInput {
  /** 비우면 브랜드의 baseMood, 그것도 없으면 레지스트리의 첫 무드 */
  mood?: string
  purpose: string
  industry: string
  format: string
  brand?: BrandPresetInput | null
  adjust?: MoodOverrides | null
}

export interface ResolvedPreset {
  mood: MoodPreset
  purpose: PurposePreset
  industry: IndustryPreset
  format: OutputFormat
  /** 해상도·길이까지 반영된 최종 영상 길이 범위 */
  videoDurationSec: [number, number]
  brandColor: string | null
  logoMediaId: string | null
  voiceSamples: string[]
  policy: PolicyList[]
  /** 업종 금지어 (정책 목록 외 추가분) */
  extraBannedPhrases: string[]
  /** 한계값 때문에 잘린 항목 (원장님 화면에 "업종 기준으로 조정됨" 표시용) */
  clamped: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 객체는 재귀 병합, 배열·원시값은 덮어쓴다. undefined 는 무시. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

export function clampGrade(grade: Grade, limits: IndustryPreset['gradeLimits']): { grade: Grade; clamped: string[] } {
  const out = { ...grade }
  const clamped: string[] = []
  for (const k of GRADE_KEYS) {
    const lim = limits[k]
    if (!lim) continue
    const v = out[k]
    const c = Math.min(lim[1], Math.max(lim[0], v))
    if (c !== v) {
      clamped.push(`grade.${k}: ${v} → ${c}`)
      out[k] = c
    }
  }
  return { grade: out, clamped }
}

export function intersectRange(pref: [number, number], bound?: [number, number]): [number, number] {
  if (!bound) return pref
  const lo = Math.max(pref[0], bound[0])
  const hi = Math.min(pref[1], bound[1])
  return lo <= hi ? [lo, hi] : [bound[0], bound[1]]
}

export function resolvePreset(reg: Registry, input: ResolveInput): ResolvedPreset {
  const brand = input.brand ? BrandPresetSchema.parse(input.brand) : null
  const moodId = input.mood ?? brand?.baseMood ?? reg.data.moods[0]!.id
  const base = reg.mood(moodId)
  const purpose = reg.purpose(input.purpose)
  const industry = reg.industry(input.industry)
  const format = reg.format(input.format)

  // 브랜드의 시각 차이값은 그 브랜드가 기준으로 삼은 무드 위에서만 의미가 있다.
  // 원장님이 이번에 다른 무드를 고르면 그 무드를 그대로 쓰고, 브랜드 컬러·로고·말투만 가져간다.
  let mood: MoodPreset = base
  if (brand && brand.baseMood === moodId) mood = deepMerge(mood, brand.overrides)
  if (input.adjust) mood = deepMerge(mood, MoodOverridesSchema.parse(input.adjust))
  mood = MoodPreset.parse(mood) // 병합 결과도 스키마 범위 안인지 다시 확인

  for (const s of [mood.photo.overlay, mood.video.captions.main, mood.video.captions.emphasis, mood.video.captions.label]) {
    if (!reg.has('fonts', s.font)) throw new Error(`등록되지 않은 폰트: ${s.font}`)
  }

  const { grade, clamped } = clampGrade(mood.grade, industry.gradeLimits)
  mood = { ...mood, grade }

  return {
    mood,
    purpose,
    industry,
    format,
    videoDurationSec: intersectRange(mood.video.durationSec, format.durationSec),
    brandColor: brand?.brandColor ?? null,
    logoMediaId: brand?.logoMediaId ?? null,
    voiceSamples: brand?.voice.samples ?? [],
    policy: reg.data.policy,
    extraBannedPhrases: industry.extraBannedPhrases,
    clamped,
  }
}
