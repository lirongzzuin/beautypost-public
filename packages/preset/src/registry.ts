import { z } from 'zod'
import {
  GRADE_BOUNDS,
  GRADE_KEYS,
  KINDS,
  type FontDef,
  type IndustryPreset,
  type Kind,
  type MoodPreset,
  type OutputFormat,
  type PolicyList,
  type PurposePreset,
} from './schema.js'

// presets/ 파일 묶음 → 검증된 레지스트리.
// 빌드 스크립트(scripts/build-registry.ts)와 런타임(index.ts)이 같은 함수를 쓴다.

/** 파일 하나. `name` 은 무드면 폴더 이름, 나머지는 확장자를 뺀 파일 이름이며 id 와 같아야 한다. */
export interface RawEntry {
  file: string
  name: string
  data: unknown
  /** 무드 폴더 안의 미리보기 파일 (예: ["thumb.jpg", "sample.mp4"]) */
  assets?: string[]
}

export type RawPresets = Record<Kind, RawEntry[]>

export interface MoodPreview {
  thumb: string | null // presets/ 기준 상대 경로
  sample: string | null
}

export interface RegistryData {
  moods: MoodPreset[]
  purposes: PurposePreset[]
  formats: OutputFormat[]
  industries: IndustryPreset[]
  fonts: FontDef[]
  policy: PolicyList[]
  previews: Record<string, MoodPreview>
}

export interface RegistryReport {
  errors: string[]
  warnings: string[]
}

export class PresetNotFoundError extends Error {
  constructor(
    readonly kind: Kind,
    readonly id: string,
  ) {
    super(`프리셋을 찾을 수 없어요: ${kind}/${id}`)
  }
}

const THUMB_FILES = ['thumb.jpg', 'thumb.png', 'thumb.webp']
const SAMPLE_FILES = ['sample.mp4']

function formatIssues(file: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${file}: ${i.path.join('.') || '(root)'} — ${i.message}`)
}

/** 원본 파일들을 스키마로 검증하고 종류 사이의 참조를 교차 검증한다. 오류가 있으면 data 는 null. */
export function buildRegistry(raw: RawPresets): { data: RegistryData | null } & RegistryReport {
  const errors: string[] = []
  const warnings: string[] = []
  const parsed: Partial<Record<Kind, unknown[]>> = {}

  for (const kind of Object.keys(KINDS) as Kind[]) {
    const seen = new Set<string>()
    parsed[kind] = []
    for (const entry of raw[kind] ?? []) {
      const res = KINDS[kind].safeParse(entry.data)
      if (!res.success) {
        errors.push(...formatIssues(entry.file, res.error))
        continue
      }
      const item = res.data as { id: string }
      if (item.id !== entry.name) {
        errors.push(`${entry.file}: id "${item.id}" 가 ${kind === 'moods' ? '폴더' : '파일'} 이름 "${entry.name}" 과 달라요`)
      }
      if (seen.has(item.id)) errors.push(`${entry.file}: ${kind} id "${item.id}" 중복`)
      seen.add(item.id)
      parsed[kind]!.push(item)
    }
  }

  const data: RegistryData = {
    moods: sortByOrder(parsed.moods as MoodPreset[]),
    purposes: sortByOrder(parsed.purposes as PurposePreset[]),
    formats: parsed.formats as OutputFormat[],
    industries: sortByOrder(parsed.industries as IndustryPreset[]),
    fonts: parsed.fonts as FontDef[],
    policy: parsed.policy as PolicyList[],
    previews: {},
  }

  for (const entry of raw.moods ?? []) {
    const assets = new Set(entry.assets ?? [])
    const thumb = THUMB_FILES.find((f) => assets.has(f))
    const sample = SAMPLE_FILES.find((f) => assets.has(f))
    data.previews[entry.name] = {
      thumb: thumb ? `moods/${entry.name}/${thumb}` : null,
      sample: sample ? `moods/${entry.name}/${sample}` : null,
    }
    if (!thumb) warnings.push(`moods/${entry.name}: 미리보기 썸네일(thumb.jpg)이 없어요 — pnpm presets:previews 로 생성 (4단계)`)
  }

  crossCheck(data, errors, warnings)
  return { data: errors.length ? null : data, errors, warnings }
}

function sortByOrder<T extends { order: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function crossCheck(d: RegistryData, errors: string[], warnings: string[]): void {
  const fonts = new Map(d.fonts.map((f) => [f.id, f]))

  for (const m of d.moods) {
    const styles = [
      ['photo.overlay', m.photo.overlay],
      ['video.captions.main', m.video.captions.main],
      ['video.captions.emphasis', m.video.captions.emphasis],
      ['video.captions.label', m.video.captions.label],
    ] as const
    for (const [where, s] of styles) {
      const font = fonts.get(s.font)
      if (!font) errors.push(`moods/${m.id}: ${where}.font "${s.font}" 가 presets/fonts 에 없어요`)
      else if (!font.styles.includes(s.weight)) {
        errors.push(`moods/${m.id}: ${where} — 폰트 "${s.font}" 에 ${s.weight} 굵기가 없어요 (${font.styles.join(', ')})`)
      }
    }
  }

  for (const p of d.purposes) {
    const roles = new Set<string>(p.requiredMedia.map((r) => r.role))
    p.video.slots.forEach((s, i) => {
      if (s.source === 'media' && !s.mediaRole) errors.push(`purposes/${p.id}: slots[${i}] 는 media 슬롯인데 mediaRole 이 없어요`)
      if (s.mediaRole && s.mediaRole !== 'any' && !roles.has(s.mediaRole)) {
        errors.push(`purposes/${p.id}: slots[${i}].mediaRole "${s.mediaRole}" 가 requiredMedia 에 없어요`)
      }
    })
    for (const r of p.sameGradeAcrossRoles) {
      if (!roles.has(r)) errors.push(`purposes/${p.id}: sameGradeAcrossRoles "${r}" 가 requiredMedia 에 없어요`)
    }
    const minTotal = p.video.slots.filter((s) => !s.optional).reduce((t, s) => t + s.durationSec[0], 0)
    if (minTotal > 60) warnings.push(`purposes/${p.id}: 필수 슬롯 최소 길이 합이 ${minTotal}초로 릴스 권장 길이를 넘어요`)
  }

  for (const f of d.formats) {
    if (f.kind !== 'photo' && !f.durationSec) errors.push(`formats/${f.id}: 영상 포맷은 durationSec 이 필요해요`)
    if (f.kind !== 'photo' && !f.encode) errors.push(`formats/${f.id}: 영상 포맷은 encode 가 필요해요`)
    if (f.safeArea.top + f.safeArea.bottom >= f.height || f.safeArea.side * 2 >= f.width) {
      errors.push(`formats/${f.id}: safeArea 가 화면보다 커요`)
    }
    for (const r of f.reserved) {
      if (r.x < 0 || r.y < 0 || r.x + r.w > f.width || r.y + r.h > f.height) {
        errors.push(`formats/${f.id}: reserved "${r.name}" 가 화면 밖이에요`)
      }
    }
  }

  for (const ind of d.industries) {
    for (const k of GRADE_KEYS) {
      const lim = ind.gradeLimits[k]
      if (!lim) continue
      const [lo, hi] = GRADE_BOUNDS[k]
      if (lim[0] < lo || lim[1] > hi) errors.push(`industries/${ind.id}: gradeLimits.${k} 가 허용 범위 [${lo}, ${hi}] 밖이에요`)
      if (lim[0] > 0 || lim[1] < 0) errors.push(`industries/${ind.id}: gradeLimits.${k} 는 0(보정 없음)을 포함해야 해요`)
    }
  }

  for (const pol of d.policy) {
    pol.rules.forEach((r, i) => {
      if (r.kind !== 'regex') return
      try {
        new RegExp(r.match, 'u')
      } catch (e) {
        errors.push(`policy/${pol.id}: rules[${i}] 정규식 오류 — ${(e as Error).message}`)
      }
    })
  }

  for (const kind of ['moods', 'purposes', 'formats', 'industries'] as const) {
    if (d[kind].length === 0) errors.push(`${kind}: 프리셋이 하나도 없어요`)
  }
}

/** 검증된 데이터에 대한 조회 API. */
export class Registry {
  private readonly byId: { [K in Kind]: Map<string, RegistryData[K][number]> }

  constructor(readonly data: RegistryData) {
    this.byId = {
      moods: new Map(data.moods.map((x) => [x.id, x])),
      purposes: new Map(data.purposes.map((x) => [x.id, x])),
      formats: new Map(data.formats.map((x) => [x.id, x])),
      industries: new Map(data.industries.map((x) => [x.id, x])),
      fonts: new Map(data.fonts.map((x) => [x.id, x])),
      policy: new Map(data.policy.map((x) => [x.id, x])),
    }
  }

  private get<K extends Kind>(kind: K, id: string): RegistryData[K][number] {
    const item = this.byId[kind].get(id)
    if (!item) throw new PresetNotFoundError(kind, id)
    return item as RegistryData[K][number]
  }

  has(kind: Kind, id: string): boolean {
    return this.byId[kind].has(id)
  }

  mood(id: string): MoodPreset {
    return this.get('moods', id)
  }
  purpose(id: string): PurposePreset {
    return this.get('purposes', id)
  }
  format(id: string): OutputFormat {
    return this.get('formats', id)
  }
  industry(id: string): IndustryPreset {
    return this.get('industries', id)
  }
  font(id: string): FontDef {
    return this.get('fonts', id)
  }

  /** 기존 POST_THEMES id(예: 'before_after') → 콘텐츠 목적 프리셋. */
  purposeForTheme(theme: string): PurposePreset | undefined {
    return this.data.purposes.find((p) => p.legacyThemes.includes(theme))
  }

  /** SERVICE_CATALOG 키 → 업종 프리셋. */
  industryForService(serviceKey: string): IndustryPreset | undefined {
    return this.data.industries.find((i) => i.serviceKeys.includes(serviceKey))
  }

  preview(moodId: string): MoodPreview {
    return this.data.previews[moodId] ?? { thumb: null, sample: null }
  }
}
