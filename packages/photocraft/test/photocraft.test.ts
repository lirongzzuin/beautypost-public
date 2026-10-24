import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { MoodPreset, getRegistry } from '@beautypost/preset'
import { applyGrade, autoPatch, beforeAfter, combineGrade, imageStats, processPhoto, renderCard, textBlock } from '../src/index.js'

const ZERO = MoodPreset.shape.grade.parse({})
const reg = getRegistry()

/** 결이 있는 합성 사진 (무작위 질감 + 위치별 색) */
async function synth(w: number, h: number, tint: [number, number, number] = [180, 140, 120], seed = 1): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3)
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const n = (rnd() - 0.5) * 60
      buf[i] = Math.max(0, Math.min(255, tint[0] + n + (x / w) * 30))
      buf[i + 1] = Math.max(0, Math.min(255, tint[1] + n))
      buf[i + 2] = Math.max(0, Math.min(255, tint[2] + n + (y / h) * 30))
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
}

async function rawOf(jpeg: Buffer) {
  return sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true })
}

function regionStd(data: Buffer, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const vals: number[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(data[(y * w + x) * 3 + 1]!)
  const m = vals.reduce((a, b) => a + b, 0) / vals.length
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length)
}

describe('색보정은 전역 연산만 (형태·부분 보정 없음)', () => {
  it('같은 색의 픽셀은 위치와 상관없이 같은 색이 된다', () => {
    const grade = combineGrade(ZERO, { exposure: 0.3, temperature: 10, contrast: 12, saturation: -10, vibrance: 15, highlights: -20, shadows: 15, fade: 8 })
    const px = Buffer.alloc(4000 * 3)
    for (let i = 0; i < px.length; i += 3) {
      const v = (i / 3) % 50
      px[i] = 100 + v
      px[i + 1] = 80 + v
      px[i + 2] = 60 + ((v * 3) % 50)
    }
    const before = Buffer.from(px)
    applyGrade(px, 3, grade)
    const map = new Map<string, string>()
    for (let i = 0; i < px.length; i += 3) {
      const k = `${before[i]},${before[i + 1]},${before[i + 2]}`
      const v = `${px[i]},${px[i + 1]},${px[i + 2]}`
      if (map.has(k)) expect(map.get(k)).toBe(v)
      else map.set(k, v)
    }
  })

  it('보정값 0이면 픽셀이 바뀌지 않는다', () => {
    const px = Buffer.from([10, 20, 30, 200, 100, 50, 0, 255, 128])
    const copy = Buffer.from(px)
    applyGrade(px, 3, ZERO)
    expect([...px]).toEqual([...copy])
  })

  it('업종 한계로 자른다 (네일 채도 ≤ 10)', () => {
    const nail = reg.industry('nail')
    expect(combineGrade(ZERO, { saturation: 40 }, nail.gradeLimits).saturation).toBe(10)
  })
})

describe('자동 밝기·화이트밸런스', () => {
  it('어두운 사진은 밝게, 파란 사진은 따뜻하게, 초록 사진은 마젠타 쪽으로', () => {
    expect(autoPatch([{ mean: [0.2, 0.2, 0.2] }]).exposure).toBeGreaterThan(0)
    expect(autoPatch([{ mean: [0.4, 0.45, 0.6] }]).temperature).toBeGreaterThan(0)
    expect(autoPatch([{ mean: [0.4, 0.55, 0.4] }]).tint).toBeGreaterThan(0)
  })
  it('여러 장은 합친 통계로 한 번만 계산 (순서와 무관)', () => {
    const a = { mean: [0.3, 0.3, 0.35] as [number, number, number] }
    const b = { mean: [0.5, 0.45, 0.4] as [number, number, number] }
    expect(autoPatch([a, b])).toEqual(autoPatch([b, a]))
  })
})

describe('processPhoto', () => {
  it('포맷별 크기로 자르고 EXIF 를 남기지 않는다', async () => {
    const input = await sharp(await synth(800, 600)).withExif({ IFD0: { Copyright: 'secret-gps' } }).jpeg().toBuffer()
    expect((await sharp(input).metadata()).exif).toBeDefined()
    for (const id of ['feed-square', 'feed-portrait', 'story']) {
      const f = reg.format(id)
      const out = await processPhoto(input, { width: f.width, height: f.height, grade: ZERO })
      const m = await sharp(out.data).metadata()
      expect([m.width, m.height]).toEqual([f.width, f.height])
      expect(m.exif).toBeUndefined()
    }
  })

  it('얼굴 영역만 흐려진다', async () => {
    const input = await synth(600, 600)
    const out = await processPhoto(input, { width: 600, height: 600, grade: ZERO, blur: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }] })
    const { data, info } = await rawOf(out.data)
    const inside = regionStd(data, info.width, 100, 100, 200, 200)
    const outside = regionStd(data, info.width, 400, 400, 500, 500)
    expect(inside).toBeLessThan(outside / 3)
  })

  it('문구 오버레이와 프레임', async () => {
    const mood = reg.mood('lovely-pastel')
    const out = await processPhoto(await synth(800, 1000), {
      width: 1080, height: 1350, grade: mood.grade, frame: { style: mood.photo.frame, color: mood.palette.accent },
      overlay: { text: '오늘의 네일 완성', style: mood.photo.overlay },
    })
    expect((await sharp(out.data).metadata()).width).toBe(1080)
  })

  it('스토리 예약 스티커 자리에는 문구를 두지 않는다', async () => {
    const story = reg.format('story')
    const style = { ...reg.mood('clean-white').photo.overlay, position: 'bottom' as const, background: '#ff0000' }
    const out = await processPhoto(await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#ffffff' } }).jpeg().toBuffer(), {
      width: 1080, height: 1920, grade: ZERO, overlay: { text: '예약 안내', style }, reserved: story.reserved, safeArea: story.safeArea,
    })
    const { data, info } = await rawOf(out.data)
    const r = story.reserved[0]!
    let red = 0
    for (let y = r.y; y < r.y + r.h; y += 4) for (let x = r.x; x < r.x + r.w; x += 4) {
      const i = (y * info.width + x) * 3
      if (data[i]! > 200 && data[i + 1]! < 80) red++
    }
    expect(red).toBe(0)
  })
})

describe('비포·애프터', () => {
  it('같은 사진을 넣으면 두 칸이 똑같다 (같은 보정값)', async () => {
    const img = await synth(500, 500)
    const grade = combineGrade(reg.mood('warm-natural').grade, autoPatch([await imageStats(img), await imageStats(img)]))
    const out = await beforeAfter({ width: 1080, height: 1080, grade, before: { data: img }, after: { data: img }, gap: 0, quality: 100 })
    const { data, info } = await rawOf(out.data)
    let diff = 0
    let n = 0
    for (let y = 0; y < info.height; y += 7) for (let x = 0; x < 540; x += 7) {
      const a = (y * info.width + x) * 3
      const b = (y * info.width + x + 540) * 3
      diff += Math.abs(data[a]! - data[b]!) + Math.abs(data[a + 2]! - data[b + 2]!)
      n += 2
    }
    expect(diff / n).toBeLessThan(3)
  })

  it('9:16 은 위아래로 나눈다', async () => {
    const img = await synth(400, 400)
    const out = await beforeAfter({
      width: 1080, height: 1920, grade: ZERO, before: { data: img }, after: { data: img },
      labels: { before: 'BEFORE', after: 'AFTER', style: reg.mood('modern-black-gold').photo.overlay },
    })
    expect((await sharp(out.data).metadata()).height).toBe(1920)
  })
})

describe('글자·카드', () => {
  it('긴 문장은 폭 안에서 줄바꿈된다', () => {
    const b = textBlock('아주 긴 문장은 폭에 맞춰서 자동으로 줄바꿈이 되어야 합니다', { font: 'pretendard', weight: 'Bold', color: '#000000', stroke: null }, 40, 400)
    expect(b.width).toBeLessThanOrEqual(400 + 8)
    expect(b.height).toBeGreaterThan(40 * 2)
  })
  it('예약 안내 카드', async () => {
    const m = reg.mood('modern-black-gold')
    const png = await renderCard({ width: 1080, height: 1920, background: m.palette.background, lines: [
      { text: '뷰티룸', style: m.video.captions.emphasis, scale: 0.09 },
      { text: '예약은 프로필 링크', style: m.video.captions.main, scale: 0.05 },
    ] })
    const meta = await sharp(png).metadata()
    expect([meta.width, meta.height]).toEqual([1080, 1920])
  })
})
