import { describe, expect, it } from 'vitest'
import { getRegistry, resolvePreset } from '@beautypost/preset'
import { RenderSpec, assignMedia, planVideo, slotDurations, toFilmcraftPlan, toProfile, type RenderMedia } from '../src/index.js'

const reg = getRegistry()

function spec(purpose: string, media: RenderMedia[], over: { mood?: string; format?: string } = {}): RenderSpec {
  const p = resolvePreset(reg, { purpose, industry: 'eyebrow', format: over.format ?? 'reel', mood: over.mood ?? 'clean-white' })
  return RenderSpec.parse({
    specVersion: 1, mood: p.mood, purpose: p.purpose, format: p.format, videoDurationSec: p.videoDurationSec,
    industryLabel: p.industry.label, shop: { name: '뷰티룸', region: '역삼', booking: '프로필 링크' },
    media, lines: { '0': '자연 눈썹 완성', '1': '숱이 적은 고민', '3': '결이 살아난 눈썹', '4': '뷰티룸 예약' },
  })
}

const m = (id: string, role: string, kind: 'image' | 'video' = 'image', durationSec?: number): RenderMedia =>
  ({ id, url: `/f/${id}`, kind, role, durationSec, focus: { x: 0.5, y: 0.4 }, blurFaces: [] })

describe('slotDurations', () => {
  it('최소에서 시작해 목표까지 여유 폭 비례로 늘리고, 최대를 넘지 않는다', () => {
    const d = slotDurations([[1, 2], [2, 6]], 6)
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(6, 1)
    expect(d[0]).toBeLessThanOrEqual(2)
    expect(slotDurations([[1, 2], [1, 2]], 100)).toEqual([2, 2])
    expect(slotDurations([[3, 4], [3, 4]], 2)).toEqual([3, 3]) // 최소 합이 목표보다 크면 최소
  })
})

describe('planVideo — 비포·애프터', () => {
  const media = [m('b1', 'before'), m('a1', 'after'), m('a2', 'after'), m('p1', 'process', 'video', 12)]

  it('hook=애프터 1장, 비포, 과정(영상 가운데 구간), 애프터, 예약 카드 순서', () => {
    const plan = planVideo(spec('before-after', media))
    expect(plan.clips.map((c) => c.role)).toEqual(['hook', 'before', 'process', 'after', 'after', 'cta'])
    const proc = plan.clips.find((c) => c.role === 'process')!
    expect(proc.start).toBeGreaterThan(0) // 12초 영상의 가운데
    expect(proc.end).toBeLessThanOrEqual(12)
    expect(plan.clips.at(-1)!.card?.lines[0]!.text).toBe('뷰티룸')
    expect(plan.clips[0]!.caption?.style).toBe('big')
    expect(plan.clips[1]!.chip).toBe('시술 전')
  })

  it('길이는 무드 선호(15~22초)와 포맷 범위 안', () => {
    const plan = planVideo(spec('before-after', media))
    expect(plan.total).toBeGreaterThanOrEqual(14)
    expect(plan.total).toBeLessThanOrEqual(22.5)
  })

  it('필수 장면 재료가 없으면 건너뛰고 알려 준다, 선택 장면은 조용히 생략', () => {
    const plan = planVideo(spec('before-after', [m('a1', 'after')]))
    expect(plan.clips.some((c) => c.role === 'before')).toBe(false)
    expect(plan.warnings.join()).toContain('before')
    expect(plan.warnings.join()).not.toContain('process')
  })

  it('컷이 무드 최소 컷보다 짧아지면 장수를 줄인다 (트렌디 0.5초 / 깔끔 1.2초)', () => {
    const many = Array.from({ length: 10 }, (_, i) => m(`a${i}`, 'after'))
    const plan = planVideo(spec('before-after', [m('b', 'before'), ...many]))
    const afters = plan.clips.filter((c) => c.role === 'after')
    for (const c of afters) expect(c.end - c.start).toBeGreaterThanOrEqual(0.8)
    expect(plan.warnings.join()).toContain('뺍니다')
  })

  it('트렌디 무드는 애프터에 펀치줌', () => {
    const plan = planVideo(spec('before-after', media, { mood: 'trendy-fast' }))
    expect(plan.clips.find((c) => c.role === 'after')!.punch).toBe(true)
  })
})

describe('assignMedia', () => {
  it("'any' 슬롯은 남은 사진을 쓴다", () => {
    const p = reg.purpose('event-booking')
    const a = assignMedia(p, [m('x', 'any'), m('y', null as unknown as string)])
    expect(a.get(1)?.map((x) => x.id)).toEqual(['x', 'y'])
  })
})

describe('filmcraft 프로필·plan', () => {
  const s = spec('before-after', [m('b1', 'before'), m('a1', 'after')], { mood: 'modern-black-gold', format: 'story' })
  const fam = (id: string) => reg.font(id).family

  it('무드 색보정·자막 서체·전환을 프로필로', () => {
    const prof = toProfile(s, fam) as { style: Record<string, unknown>; short: Record<string, number> }
    expect(prof.style.grade_contrast).toBe(12)
    expect(prof.style.fun_font).toBe('NanumMyeongjo')
    expect(prof.style.video_transition).toBe('')
    expect(toProfile(spec('process', [m('p', 'process')], { mood: 'warm-natural' }), fam).style).toMatchObject({ video_transition: 'cross_dissolve', video_transition_frames: 12 })
  })

  it('스토리는 예약 스티커 자리 아래로 자막이 내려가지 않게 하단 세이프존을 올린다', () => {
    const prof = toProfile(s, fam) as { short: Record<string, number> }
    const sticker = reg.format('story').reserved[0]!
    expect(1920 - prof.short.safe_bottom!).toBeLessThanOrEqual(sticker.y)
    expect([prof.short.width, prof.short.height]).toEqual([1080, 1920])
  })

  it('plan.json: 경로·자막·커버(애프터 클립)', () => {
    const plan = planVideo(s)
    const paths = Object.fromEntries([...plan.clips.map((c) => [c.card?.key ?? c.media!.id, `/tmp/${c.card?.key ?? c.media!.id}.jpg`])])
    const fp = toFilmcraftPlan(s, plan, paths, 'job1') as { clips: { src: string; captions: unknown[] }[]; thumbnail: { clip: number }; layout: string }
    expect(fp.layout).toBe('full')
    expect(fp.clips[0]!.src).toMatch(/^\/tmp\//)
    expect(plan.clips[fp.thumbnail.clip]!.role).toBe('after')
    expect(() => toFilmcraftPlan(s, plan, {}, 'x')).toThrow(/경로/)
  })
})
