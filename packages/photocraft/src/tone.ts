import { GRADE_BOUNDS, GRADE_KEYS, type Grade, type GradeLimits, type GradePatch } from '@beautypost/preset'

// 색보정 = "픽셀 값 → 픽셀 값" 전역 함수만. 위치에 따라 다르게 바뀌는 연산(부분 보정·형태 변형·피부 보정)은 없다.
// 같은 색의 픽셀은 사진 어디에 있든 같은 색이 된다 → 시술 부위의 모양·질감을 바꾸지 못한다 (과장 광고 방지).
//
// 단계: sRGB → 선형광 → 노출·화이트밸런스 → sRGB → 대비·하이라이트·섀도·페이드 (채널별 LUT 256칸)
//       → 채도·바이브런스 (픽셀 자신의 색만 보고 휘도 쪽으로/밖으로 섞음)

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** 프리셋 값 + 자동 보정값을 더하고, 스키마 범위와 업종 한계로 자른다 */
export function combineGrade(base: Grade, patch: GradePatch | null | undefined, limits: GradeLimits = {}): Grade {
  const out = { ...base }
  for (const k of GRADE_KEYS) {
    let v = out[k] + (patch?.[k] ?? 0)
    const [lo, hi] = GRADE_BOUNDS[k]
    v = Math.min(hi, Math.max(lo, v))
    const lim = limits[k]
    if (lim) v = Math.min(lim[1], Math.max(lim[0], v))
    out[k] = Math.round(v * 1000) / 1000
  }
  return out
}

/** 채널별 256칸 LUT (R, G, B) */
export function buildLuts(g: Grade): [Uint8Array, Uint8Array, Uint8Array] {
  const exposure = 2 ** g.exposure
  const gains = [1 + g.temperature * 0.006, 1 - g.tint * 0.004, 1 - g.temperature * 0.006]
  const contrast = 1 + g.contrast / 100
  const fade = (g.fade / 100) * 0.4
  return gains.map((gain) => {
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      let v = toSrgb(clamp01(toLinear(i / 255) * exposure * gain))
      v = 0.5 + (v - 0.5) * contrast
      v += (g.highlights / 100) * 0.25 * smooth(0.5, 1, v)
      v += (g.shadows / 100) * 0.25 * (1 - smooth(0, 0.5, v))
      v = fade + clamp01(v) * (1 - fade)
      lut[i] = Math.round(clamp01(v) * 255)
    }
    return lut
  }) as [Uint8Array, Uint8Array, Uint8Array]
}

/** RGB(A) 원시 버퍼에 보정 적용 (제자리) */
export function applyGrade(pixels: Uint8Array | Buffer, channels: number, g: Grade): void {
  const [lr, lg, lb] = buildLuts(g)
  const sat = 1 + g.saturation / 100
  const vib = g.vibrance / 100
  const touchColor = sat !== 1 || vib !== 0
  for (let i = 0; i < pixels.length; i += channels) {
    let r = lr[pixels[i]!]!
    let gg = lg[pixels[i + 1]!]!
    let b = lb[pixels[i + 2]!]!
    if (touchColor) {
      const luma = 0.2126 * r + 0.7152 * gg + 0.0722 * b
      const cur = (Math.max(r, gg, b) - Math.min(r, gg, b)) / 255
      const k = sat * (1 + vib * (1 - cur))
      r = luma + (r - luma) * k
      gg = luma + (gg - luma) * k
      b = luma + (b - luma) * k
    }
    pixels[i] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r)
    pixels[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : Math.round(gg)
    pixels[i + 2] = b < 0 ? 0 : b > 255 ? 255 : Math.round(b)
  }
}

export interface ImageStats {
  /** 채널 평균 (0~1, sRGB) */
  mean: [number, number, number]
}

/**
 * 자동 밝기·화이트밸런스. 여러 장을 넘기면 "합친 통계"로 한 번만 계산한다 →
 * 비포·애프터에 똑같은 값을 쓰게 해서 보정으로 차이를 만들지 않는다.
 * 뷰티 사진은 의도된 따뜻한 조명이 많아 회색 기준 보정을 절반만 적용한다.
 */
export function autoPatch(stats: ImageStats[]): GradePatch {
  if (!stats.length) return {}
  const avg = [0, 1, 2].map((c) => stats.reduce((t, s) => t + toLinear(s.mean[c as 0 | 1 | 2]), 0) / stats.length) as [number, number, number]
  const [r, g, b] = avg
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const target = toLinear(0.47)
  const ev = luma > 0 ? Math.log2(target / luma) * 0.6 : 0
  const exposure = Math.max(-0.4, Math.min(0.4, ev))
  const tR = r > 0 ? (g / r - 1) / 0.006 : 0
  const tB = b > 0 ? (1 - g / b) / 0.006 : 0
  const temperature = Math.max(-12, Math.min(12, ((tR + tB) / 2) * 0.5))
  const rb = (r + b) / 2
  // 초록 이득 = 1 - tint·0.004 → 초록이 많으면(g > rb) tint 를 + 로
  const tint = g > 0 ? Math.max(-8, Math.min(8, ((1 - rb / g) / 0.004) * 0.5)) : 0
  const round = (v: number) => Math.round(v * 100) / 100
  return { exposure: round(exposure), temperature: round(temperature), tint: round(tint) }
}
