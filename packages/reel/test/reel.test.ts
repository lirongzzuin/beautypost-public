import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { getRegistry, resolvePreset } from '@beautypost/preset'
import { RenderSpec, planVideo, type RenderMedia } from '@beautypost/render'
import { anchorIn, cropFor, ffmpegPath, probe, renderReel } from '../src/index.js'

describe('cropFor — 시술 부위 클로즈업 구도', () => {
  it('부위가 없으면 화면 비율로 꽉 채우는 가장 큰 영역 (focus 중심)', () => {
    const c = cropFor(2000, 2000, 1080, 1920, { focus: { x: 0.5, y: 0.5 } })
    expect(c.height).toBe(2000)
    expect(c.width).toBe(1125)
    expect(c.left).toBe(438)
  })

  it('부위가 있으면 부위가 화면 폭의 약 60%를 차지하게 가까이, 부위 중심으로', () => {
    const area = { x: 0.4, y: 0.3, w: 0.2, h: 0.08 } // 2000px 사진에서 400px 폭
    const c = cropFor(2000, 2000, 1080, 1920, { area, fill: 0.6 })
    expect(c.width).toBeGreaterThan(700) // 1080/1.5 보다 작게 확대하지 않음 (흐려짐 방지)
    expect(c.width).toBeLessThan(800)
    const a = anchorIn(c, 2000, 2000, area)
    expect(a.x).toBeCloseTo(0.5, 1)
    expect(a.y).toBeCloseTo(0.5, 1)
  })

  it('원본을 1.5배 넘게 키우지 않는다 (작은 부위라도), 이미 작은 사진은 더 확대하지 않는다', () => {
    const big = cropFor(3000, 4000, 1080, 1920, { area: { x: 0.45, y: 0.4, w: 0.02, h: 0.01 } })
    expect(big.width).toBe(720)
    const small = cropFor(800, 1000, 1080, 1920, { area: { x: 0.45, y: 0.4, w: 0.05, h: 0.02 } })
    expect(small.width).toBe(Math.round(1000 * (1080 / 1920)))
  })

  it('반올림해도 원본 밖으로 넘치지 않는다 (아이폰 3:4 → 4:5, 무작위 초점)', () => {
    for (let i = 0; i < 3000; i++) {
      const sw = 1000 + Math.floor(Math.random() * 3000)
      const sh = 1000 + Math.floor(Math.random() * 3000)
      const [W, H] = [[1080, 1350], [1080, 1920], [1080, 1080], [1080, 958]][i % 4]!
      const c = cropFor(sw, sh, W, H, { focus: { x: Math.random(), y: Math.random() }, area: i % 2 ? { x: Math.random() * 0.8, y: Math.random() * 0.8, w: 0.2, h: 0.1 } : null, anchorY: Math.random() })
      expect(c.left).toBeGreaterThanOrEqual(0)
      expect(c.top).toBeGreaterThanOrEqual(0)
      expect(c.left + c.width).toBeLessThanOrEqual(sw)
      expect(c.top + c.height).toBeLessThanOrEqual(sh)
    }
    const c = cropFor(1950, 2600, 1080, 1350, { focus: { x: 0.5, y: 0.9 } })
    expect(c.top + c.height).toBeLessThanOrEqual(2600)
  })

  it('anchorY 로 부위를 칸 위쪽에 둔다 (비교 화면 아래 칸)', () => {
    const area = { x: 0.4, y: 0.5, w: 0.2, h: 0.05 }
    const c = cropFor(2000, 3000, 1080, 958, { area, anchorY: 0.33 })
    expect(anchorIn(c, 2000, 3000, area).y).toBeCloseTo(0.33, 1)
  })
})

async function photo(dir: string, name: string, color: string): Promise<string> {
  const f = join(dir, name)
  // 가운데에 '시술 부위' 띠가 있는 사진
  const band = await sharp({ create: { width: 600, height: 120, channels: 3, background: '#3b2a20' } }).png().toBuffer()
  writeFileSync(f, await sharp({ create: { width: 1500, height: 2000, channels: 3, background: color } }).composite([{ input: band, left: 450, top: 700 }]).jpeg().toBuffer())
  return f
}

function spec(media: RenderMedia[], mood = 'clean-white', format = 'reel') {
  const p = resolvePreset(getRegistry(), { purpose: 'before-after', industry: 'eyebrow', format, mood })
  return RenderSpec.parse({
    specVersion: 1, mood: p.mood, purpose: p.purpose, format: p.format, videoDurationSec: p.videoDurationSec, industryLabel: p.industry.label,
    gradeLimits: p.industry.gradeLimits,
    shop: { name: '뷰티룸', region: '서울 역삼동', booking: '예약은 프로필 링크', handle: '@beauty_room' },
    media, lines: { '0': '반전 있어요', '1': '꼬리 숱이 비어 있던 상태', '3': '결이 이어진 눈썹', '4': '상담은 카카오채널로' },
  })
}

describe('renderReel', () => {
  it('사진만으로 9:16 mp4 + 커버 (장면 길이의 합 = 영상 길이, 무음 오디오 트랙)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-'))
    const area = { x: 0.3, y: 0.35, w: 0.4, h: 0.06 }
    const media: RenderMedia[] = [
      { id: 'b', url: 'x', kind: 'image', role: 'before', focus: null, area, blurFaces: [] },
      { id: 'a', url: 'x', kind: 'image', role: 'after', focus: null, area, blurFaces: [] },
    ]
    const s = spec(media)
    const plan = planVideo(s)
    const files = { b: await photo(dir, 'b.jpg', '#d9c2b0'), a: await photo(dir, 'a.jpg', '#e0c8b5') }
    const progress: number[] = []
    const t0 = Date.now()
    const r = await renderReel({ spec: s, plan, files, out: { video: join(dir, 'out.mp4'), cover: join(dir, 'cover.jpg') }, onProgress: (x) => progress.push(x) })
    const secs = (Date.now() - t0) / 1000
    expect(existsSync(r.video)).toBe(true)
    const info = await probe(r.video)
    expect([info.width, info.height]).toEqual([1080, 1920])
    expect(info.duration).toBeCloseTo(plan.total, 0)
    expect(r.frames).toBe(Math.round(plan.clips.reduce((t, c) => t + (c.end - c.start), 0) * 30))
    const meta = await sharp(r.cover).metadata()
    expect([meta.width, meta.height]).toEqual([1080, 1920])
    expect(progress.at(-1)).toBeGreaterThan(0.8)
    // 오디오 트랙이 있어야 인스타그램에서 음악을 얹기 쉽다
    const streams = spawnSync(ffmpegPath(), ['-hide_banner', '-i', r.video]).stderr.toString()
    expect(streams).toMatch(/Audio: aac/)
    expect(secs).toBeLessThan(30)
  }, 60_000)

  it('영상 장면은 가운데 구간을 잘라 쓰고, 정사각형 포맷의 비교 장면은 좌우로', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-'))
    const clip = join(dir, 'p.mp4')
    const gen = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=4', '-pix_fmt', 'yuv420p', clip])
    expect(gen.status).toBe(0)
    const media: RenderMedia[] = [
      { id: 'b', url: 'x', kind: 'image', role: 'before', focus: { x: 0.5, y: 0.4 }, blurFaces: [] },
      { id: 'a', url: 'x', kind: 'image', role: 'after', focus: { x: 0.5, y: 0.4 }, blurFaces: [] },
      { id: 'p', url: 'x', kind: 'video', role: 'process', durationSec: 4, focus: { x: 0.5, y: 0.5 }, blurFaces: [] },
    ]
    const s = spec(media, 'trendy-fast', 'feed-square')
    const plan = planVideo(s)
    expect(plan.clips.some((c) => c.media?.kind === 'video')).toBe(true)
    const r = await renderReel({
      spec: s, plan,
      files: { b: await photo(dir, 'b.jpg', '#cbb'), a: await photo(dir, 'a.jpg', '#dcc'), p: clip },
      out: { video: join(dir, 'out.mp4'), cover: join(dir, 'cover.jpg') },
    })
    const info = await probe(r.video)
    expect([info.width, info.height]).toEqual([1080, 1080])
    expect(info.duration).toBeCloseTo(plan.total, 0)
  }, 60_000)

  it('첫 장면이 영상이고 비교 장면이 없어도 커버를 만든다, 디코더 ffmpeg 가 남지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-'))
    const clip = join(dir, 'p.mp4')
    spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=6', '-pix_fmt', 'yuv420p', clip])
    const p = resolvePreset(getRegistry(), { purpose: 'process', industry: 'eyebrow', format: 'reel', mood: 'clean-white' })
    const s = RenderSpec.parse({
      specVersion: 1, mood: p.mood, purpose: p.purpose, format: p.format, videoDurationSec: p.videoDurationSec, industryLabel: p.industry.label,
      shop: { name: '뷰티룸', region: '역삼' }, lines: { '0': '과정 보기' },
      media: [{ id: 'p', url: 'x', kind: 'video', role: 'process', durationSec: 6, focus: { x: 0.5, y: 0.5 }, blurFaces: [] }],
    })
    const plan = planVideo(s)
    expect(plan.clips[0]!.media?.kind).toBe('video')
    const r = await renderReel({ spec: s, plan, files: { p: clip }, out: { video: join(dir, 'o.mp4'), cover: join(dir, 'c.jpg') } })
    expect((await sharp(r.cover).metadata()).width).toBe(1080)
    await new Promise((res) => setTimeout(res, 300))
    const left = spawnSync('pgrep', ['-f', `${clip}`]).stdout.toString().trim()
    expect(left).toBe('')
  }, 60_000)

  it('굽는 중에 중단되면 멈춘다 (인코더가 기다리다 멈추지 않는다)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-'))
    const media: RenderMedia[] = [
      { id: 'b', url: 'x', kind: 'image', role: 'before', focus: null, blurFaces: [] },
      { id: 'a', url: 'x', kind: 'image', role: 'after', focus: null, blurFaces: [] },
    ]
    const s = spec(media)
    for (const ms of [300, 900, 1500]) {
      const ac = new AbortController()
      setTimeout(() => ac.abort(), ms)
      const t0 = Date.now()
      const r = await renderReel({ spec: s, plan: planVideo(s), files: { b: await photo(dir, 'b.jpg', '#ccc'), a: await photo(dir, 'a.jpg', '#ddd') }, out: { video: join(dir, `o${ms}.mp4`), cover: join(dir, `c${ms}.jpg`) }, signal: ac.signal }).catch((e) => e)
      if (r instanceof Error) expect(String(r)).toMatch(/중단|멈췄/)
      expect(Date.now() - t0).toBeLessThan(15_000)
    }
  }, 60_000)

  it('중단 신호가 오면 멈춘다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-'))
    const media: RenderMedia[] = [
      { id: 'b', url: 'x', kind: 'image', role: 'before', focus: null, blurFaces: [] },
      { id: 'a', url: 'x', kind: 'image', role: 'after', focus: null, blurFaces: [] },
    ]
    const s = spec(media)
    const ac = new AbortController()
    ac.abort()
    await expect(
      renderReel({ spec: s, plan: planVideo(s), files: { b: await photo(dir, 'b.jpg', '#ccc'), a: await photo(dir, 'a.jpg', '#ddd') }, out: { video: join(dir, 'o.mp4'), cover: join(dir, 'c.jpg') }, signal: ac.signal }),
    ).rejects.toThrow(/중단/)
  }, 60_000)
})
