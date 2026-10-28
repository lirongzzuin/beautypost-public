import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { loadRaw } from '../scripts/build-registry.js'
import {
  MoodPreset,
  Registry,
  buildRegistry,
  clampGrade,
  deepMerge,
  getRegistry,
  intersectRange,
  resolvePreset,
  type RawPresets,
} from '../src/index.js'

const PRESETS = resolve(__dirname, '../../../presets')

function repoRaw(): RawPresets {
  return loadRaw(PRESETS).raw
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

describe('presets/ 폴더의 모든 파일', () => {
  it('스키마와 교차 검증을 통과한다', () => {
    const { data, errors } = buildRegistry(repoRaw())
    expect(errors).toEqual([])
    expect(data).not.toBeNull()
  })

  it('필수 축이 모두 있다 (무드 5·목적 6·포맷 4·업종에 눈썹/네일/헤어)', () => {
    const reg = getRegistry()
    expect(reg.data.moods.map((m) => m.id)).toEqual(
      expect.arrayContaining(['clean-white', 'warm-natural', 'modern-black-gold', 'lovely-pastel', 'trendy-fast']),
    )
    expect(reg.data.purposes).toHaveLength(6)
    expect(reg.data.formats.map((f) => f.id).sort()).toEqual(['feed-portrait', 'feed-square', 'reel', 'story'])
    for (const id of ['eyebrow', 'nail', 'hair', 'lash', 'scalp', 'waxing']) expect(reg.has('industries', id)).toBe(true)
  })

  it('기존 게시 주제(POST_THEMES)가 모두 목적 프리셋으로 연결된다', () => {
    const reg = getRegistry()
    for (const theme of ['review', 'before_after', 'event', 'care_guide', 'shop_intro', 'booking_notice']) {
      expect(reg.purposeForTheme(theme), theme).toBeDefined()
    }
  })
})

describe('레지스트리 검증', () => {
  it('새 무드는 파일 추가만으로 등록된다', () => {
    const raw = repoRaw()
    const extra = clone(raw.moods[0]!)
    extra.name = 'test-new'
    ;(extra.data as { id: string }).id = 'test-new'
    raw.moods.push(extra)
    const { data } = buildRegistry(raw)
    expect(new Registry(data!).has('moods', 'test-new')).toBe(true)
  })

  it('잘못된 값·없는 폰트·id 불일치·깨진 정규식을 잡아낸다', () => {
    const raw = repoRaw()
    const bad = raw.moods[0]!.data as MoodPreset
    bad.grade.exposure = 5 // 범위 밖
    ;(raw.moods[1]!.data as MoodPreset).video.captions.main.font = 'no-such-font'
    raw.formats[0]!.name = 'renamed'
    raw.policy[0]!.data = { ...(raw.policy[0]!.data as object), rules: [{ match: '(', kind: 'regex', reason: 'x' }] }
    const { data, errors } = buildRegistry(raw)
    expect(data).toBeNull()
    const text = errors.join('\n')
    expect(text).toMatch(/grade\.exposure/)
    expect(text).toMatch(/no-such-font/)
    expect(text).toMatch(/파일 이름 "renamed"/)
    expect(text).toMatch(/정규식 오류/)
  })

  it('목적 슬롯의 mediaRole 은 requiredMedia 안에 있어야 한다', () => {
    const raw = repoRaw()
    const p = raw.purposes.find((e) => e.name === 'before-after')!.data as { video: { slots: { mediaRole?: string }[] } }
    p.video.slots[0]!.mediaRole = 'owner'
    expect(buildRegistry(raw).errors.join()).toMatch(/mediaRole "owner"/)
  })

  it('미리보기가 없으면 경고만 하고 통과한다', () => {
    const raw = repoRaw()
    raw.moods[0]!.assets = [] // 썸네일 없는 새 무드
    const { data, warnings } = buildRegistry(raw)
    expect(data).not.toBeNull()
    expect(warnings.some((w) => w.includes('thumb'))).toBe(true)
    expect(buildRegistry(repoRaw()).warnings).toEqual([]) // 저장소의 무드는 모두 썸네일이 있다
  })
})

describe('정책 정규식', () => {
  const reg = getRegistry()
  const rules = reg.data.policy.flatMap((p) => p.rules.map((r) => ({ ...r, list: p.id })))
  const hits = (text: string) =>
    rules.filter((r) => (r.kind === 'regex' ? new RegExp(r.match, 'u').test(text) : text.includes(r.match))).map((r) => r.list)

  it('업종 이름 "반영구"는 걸리지 않는다', () => {
    expect(hits('반영구 눈썹 자연스럽게 완성했어요')).toEqual([])
  })
  it('의료·효과 단정을 잡는다', () => {
    expect(hits('부작용 없는 시술')).toContain('medical-claims')
    expect(hits('평생 유지돼요')).toContain('medical-claims')
    expect(hits('영구적으로 남아요')).toContain('medical-claims')
    expect(hits('만족도 100%')).toContain('medical-claims')
    expect(hits('통증이 전혀 없어요')).toContain('medical-claims')
  })
  it('AI 상투어·과한 감탄을 잡는다', () => {
    expect(hits('특별한 경험을 선물해요!!')).toContain('ai-cliche')
  })
})

describe('resolvePreset', () => {
  const reg = getRegistry()
  const base = { purpose: 'before-after', industry: 'nail', format: 'reel' }

  it('브랜드의 기준 무드 + 차이값이 적용된다', () => {
    const r = resolvePreset(reg, {
      ...base,
      brand: { baseMood: 'warm-natural', source: 'manual', overrides: { grade: { exposure: 0.3 } }, brandColor: '#aa3366' },
    })
    expect(r.mood.id).toBe('warm-natural')
    expect(r.mood.grade.exposure).toBe(0.3)
    expect(r.brandColor).toBe('#aa3366')
  })

  it('다른 무드를 고르면 브랜드 시각 차이값은 쓰지 않고 브랜드 컬러는 유지한다', () => {
    const r = resolvePreset(reg, {
      ...base,
      mood: 'clean-white',
      brand: { baseMood: 'warm-natural', source: 'manual', overrides: { grade: { exposure: 0.3 } }, brandColor: '#aa3366' },
    })
    expect(r.mood.grade.exposure).toBe(reg.mood('clean-white').grade.exposure)
    expect(r.brandColor).toBe('#aa3366')
  })

  it('업종 보정 한계는 수동 조정으로도 넘을 수 없다', () => {
    const r = resolvePreset(reg, { ...base, mood: 'trendy-fast', adjust: { grade: { saturation: 30 } } })
    expect(r.mood.grade.saturation).toBe(10) // nail: saturation ≤ 10
    expect(r.clamped).toContain('grade.saturation: 30 → 10')
  })

  it('스키마 범위를 넘는 수동 조정은 거부한다', () => {
    expect(() => resolvePreset(reg, { ...base, adjust: { grade: { exposure: 9 } } })).toThrow()
  })

  it('영상 길이는 무드 선호와 포맷 범위의 교집합', () => {
    expect(resolvePreset(reg, { ...base, mood: 'clean-white', format: 'story' }).videoDurationSec).toEqual([9, 13])
    expect(resolvePreset(reg, { ...base, mood: 'warm-natural', format: 'story' }).videoDurationSec).toEqual([10, 14])
    expect(resolvePreset(reg, { ...base, mood: 'trendy-fast', format: 'reel' }).videoDurationSec).toEqual([7, 10])
  })

  it('없는 프리셋 id 는 명확한 오류', () => {
    expect(() => resolvePreset(reg, { ...base, industry: 'nope' })).toThrow(/industries\/nope/)
  })
})

describe('유틸', () => {
  it('deepMerge 는 객체만 재귀 병합하고 배열은 덮어쓴다', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: [1, 2] }, { a: { b: 5 }, d: [9] })).toEqual({ a: { b: 5, c: 2 }, d: [9] })
  })
  it('clampGrade / intersectRange', () => {
    const g = MoodPreset.shape.grade.parse({ saturation: -30 })
    expect(clampGrade(g, { saturation: [-20, 8] }).grade.saturation).toBe(-20)
    expect(intersectRange([20, 30], [5, 15])).toEqual([5, 15])
  })
})

it('JSON Schema 파일이 생성되어 있다', async () => {
  const { existsSync } = await import('node:fs')
  expect(existsSync(join(PRESETS, '_schema/moods.schema.json'))).toBe(true)
})
