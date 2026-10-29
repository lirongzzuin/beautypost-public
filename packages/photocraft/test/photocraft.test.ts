import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { MoodPreset, getRegistry } from '@beautypost/preset'
import { applyGrade, autoPatch, beforeAfter, combineGrade, coverage, cropFor, imageStats, pickCompareLayout, processPhoto, renderCard, textBlock } from '../src/index.js'

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

  it('업종 한계는 스타일 값에만 (네일 채도 ≤ 10), 자동 교정은 그 위에 더한다', () => {
    const nail = reg.industry('nail')
    const style = { ...ZERO, saturation: 25, temperature: 20 }
    const g = combineGrade(style, { temperature: 12 }, nail.gradeLimits)
    expect(g.saturation).toBe(10) // 스타일 채도는 한계로
    expect(g.temperature).toBe(8 + 12) // 스타일 20 → 한계 8, 여기에 푸른 조명 교정 +12
  })
})

describe('자동 밝기·화이트밸런스', () => {
  it('어둡고 푸른 사진을 실제로 정상 쪽으로 되돌리고, 정상 사진은 거의 건드리지 않는다', async () => {
    const lum = async (b: Buffer) => {
      const { channels } = await sharp(b).stats()
      const [r, g, bl] = channels.map((c) => c.mean)
      return { y: 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!, rb: r! / bl! }
    }
    const normal = await synth(800, 1000, [200, 160, 140])
    const dark = await sharp(normal).linear([0.38, 0.45, 0.62], [0, 0, 6]).jpeg().toBuffer()
    const fix = async (b: Buffer) => (await processPhoto(b, { width: 800, height: 1000, grade: combineGrade(ZERO, autoPatch([await imageStats(b)])) })).data
    const [n, d, fd] = [await lum(normal), await lum(dark), await lum(await fix(dark))]
    expect(fd.y - d.y).toBeGreaterThan(40) // 확실히 밝아짐 (0~255)
    expect(fd.y).toBeLessThan(n.y + 10) // 원래보다 밝게 과장하지 않음
    // 색이 틀어진 정도(중립 R/B=1 에서 벗어난 정도)가 40% 이상 줄어든다. 원래 피부색은 모르므로 중립 쪽으로만 되돌린다
    expect(Math.abs(1 - fd.rb)).toBeLessThan(Math.abs(1 - d.rb) * 0.6)
    const fn = await lum(await fix(normal))
    expect(Math.abs(fn.y - n.y)).toBeLessThan(12) // 정상 사진은 밝기도
    expect(Math.abs(fn.rb - n.rb)).toBeLessThan(0.12) // 피부의 따뜻한 색도 거의 그대로
  })

  it('어두운 사진은 밝게, 파란 사진은 따뜻하게, 초록 사진은 마젠타 쪽으로', () => {
    expect(autoPatch([{ mean: [0.2, 0.2, 0.2] }]).exposure).toBeGreaterThan(0)
    expect(autoPatch([{ mean: [0.62, 0.6, 0.58] }]).exposure).toBe(0) // 밝게 잘 찍힌 사진은 어둡게 만들지 않음
    expect(autoPatch([{ mean: [0.95, 0.93, 0.92] }]).exposure).toBeLessThan(0) // 확실한 과노출만 낮춤
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

  it('문구 오버레이', async () => {
    const mood = reg.mood('lovely-pastel')
    const out = await processPhoto(await synth(800, 1000), {
      width: 1080, height: 1350, grade: mood.grade,
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
    const out = await beforeAfter({ width: 1080, height: 1080, grade, before: { data: img }, after: { data: img }, layout: 'side', gap: 0, quality: 100 })
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

describe('구도: 시술 부위 기준 자르기', () => {
  // 얼굴 정면 사진(가로 2118×1903)의 양쪽 눈썹 — 운영에서 미간·이마만 남던 사진과 같은 비율
  const brows = { x: 0.2, y: 0.55, w: 0.6, h: 0.12 }

  it('부위가 화면에 다 들어오고 화면 폭의 상당 부분을 차지한다', () => {
    const crop = cropFor(2118, 1903, 1080, 1350, { area: brows, fill: 0.72 })
    expect(coverage(crop, 2118, 1903, brows)).toBeGreaterThan(0.99)
    expect((brows.w * 2118) / crop.width).toBeGreaterThan(0.6)
  })

  it('가로로 긴 눈썹은 위아래 비교, 세로로 긴 손톱은 좌우 비교', () => {
    const gap = 6
    expect(pickCompareLayout(1080, 1350, gap, [{ width: 2118, height: 1903, area: brows }, { width: 2099, height: 1891, area: brows }])).toBe('stack')
    expect(pickCompareLayout(1080, 1920, gap, [{ width: 1152, height: 2048, area: { x: 0.3, y: 0.3, w: 0.5, h: 0.08 } }, { width: 1152, height: 2048, area: { x: 0.3, y: 0.3, w: 0.5, h: 0.08 } }])).toBe('stack')
    const nails = { x: 0.3, y: 0.15, w: 0.4, h: 0.7 }
    expect(pickCompareLayout(1080, 1350, gap, [{ width: 1152, height: 2048, area: nails }, { width: 1152, height: 2048, area: nails }])).toBe('side')
  })

  it('부위를 모르면 원본을 많이 남기는 배치 (가로 사진 → 위아래)', () => {
    expect(pickCompareLayout(1080, 1350, 6, [{ width: 2118, height: 1903 }, { width: 2118, height: 1903 }])).toBe('stack')
    expect(pickCompareLayout(1080, 1350, 6, [{ width: 1152, height: 2048 }, { width: 1152, height: 2048 }])).toBe('side')
  })

  it('콜라주 두 칸 모두에 부위(빨간 띠)가 보이고, 테두리가 없다', async () => {
    // 회색 얼굴 사진의 아래쪽(55~67%)에 빨간 "눈썹" 띠
    const W0 = 2118, H0 = 1903
    const img = await sharp({ create: { width: W0, height: H0, channels: 3, background: '#a0a0a0' } })
      .composite([{ input: { create: { width: Math.round(W0 * 0.6), height: Math.round(H0 * 0.12), channels: 3, background: '#ff0000' } }, left: Math.round(W0 * 0.2), top: Math.round(H0 * 0.55) }])
      .jpeg().toBuffer()
    const out = await beforeAfter({ width: 1080, height: 1350, grade: ZERO, before: { data: img, area: brows }, after: { data: img, area: brows }, gap: 6, background: '#ffffff' })
    const { data, info } = await rawOf(out.data)
    const redIn = (y0: number, y1: number) => {
      let n = 0
      for (let y = y0; y < y1; y += 5) for (let x = 0; x < info.width; x += 5) {
        const i = (y * info.width + x) * 3
        if (data[i]! > 200 && data[i + 1]! < 80) n++
      }
      return n
    }
    const half = Math.floor(info.height / 2)
    expect(redIn(0, half)).toBeGreaterThan(1000)
    expect(redIn(half, info.height)).toBeGreaterThan(1000)
    // 가장자리 픽셀은 사진(회색) 그대로 — 테두리 색이 없다
    const edge = (x: number, y: number) => data[(y * info.width + x) * 3]!
    expect(Math.abs(edge(2, 2) - 0xa0)).toBeLessThan(12)
    expect(Math.abs(edge(info.width - 3, info.height - 3) - 0xa0)).toBeLessThan(12)
  })
})
