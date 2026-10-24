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

/**
 * 최종 보정값 = (스타일 값을 업종 한계로 자른 것) + 자동 교정값, 마지막에 스키마 범위로 자른다.
 * 업종 한계는 "무드·조정으로 색을 과하게 입히는 것"을 막는 장치라 스타일에만 적용한다.
 * 자동 교정(밝기·화이트밸런스)은 조명 때문에 틀어진 색을 원래대로 되돌리는 것이라 한계에 묶지 않는다.
 */
export function combineGrade(style: Grade, auto: GradePatch | null | undefined, limits: GradeLimits = {}): Grade {
  const out = { ...style }
  for (const k of GRADE_KEYS) {
    let v = out[k]
    const lim = limits[k]
    if (lim) v = Math.min(lim[1], Math.max(lim[0], v))
    v += auto?.[k] ?? 0
    const [lo, hi] = GRADE_BOUNDS[k]
    out[k] = Math.round(Math.min(hi, Math.max(lo, v)) * 1000) / 1000
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
 * 틀어진 만큼 비례해서 고치므로 이미 괜찮은 사진은 거의 그대로다. 샵의 의도된 따뜻한 조명을 남기려고
 * 화이트밸런스는 회색 기준의 70% 만, 노출은 목표의 85% 만 맞춘다.
 */
export function autoPatch(stats: ImageStats[]): GradePatch {
  if (!stats.length) return {}
  const avg = [0, 1, 2].map((c) => stats.reduce((t, s) => t + toLinear(s.mean[c as 0 | 1 | 2]), 0) / stats.length) as [number, number, number]
  const [r, g, b] = avg
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

  // 노출: 어두우면 목표(0.5)의 85% 까지 밝게. 밝은 사진은 확실히 과노출(0.72 이상)일 때만 살짝 낮춘다
  let exposure = 0
  if (luma > 0 && luma < toLinear(0.5)) exposure = Math.min(1.5, Math.log2(toLinear(0.5) / luma) * 0.85)
  else if (luma > toLinear(0.72)) exposure = Math.max(-1, Math.log2(toLinear(0.72) / luma) * 0.5)

  // 화이트밸런스: 회색 기준 교정량의 70%. 단, 시술 부위 클로즈업은 피부색 때문에 원래 따뜻하게 보이므로
  // 푸른 쪽(차가운 조명)은 그대로 고치고, 따뜻한 쪽은 피부의 자연스러운 따뜻함을 넘는 부분(텅스텐 조명)만 고친다
  const tR = r > 0 ? (g / r - 1) / 0.006 : 0
  const tB = b > 0 ? (1 - g / b) / 0.006 : 0
  const rawTemp = ((tR + tB) / 2) * 0.7
  const NATURAL_WARMTH = 45 // 정상 조명의 피부 클로즈업에서 회색 기준이 내놓는 '차갑게' 값 정도는 무시
  const temperature = rawTemp > 0 ? Math.min(40, rawTemp) : Math.max(-40, Math.min(0, rawTemp + NATURAL_WARMTH))

  // 틴트(초록↔마젠타): 초록 조명(형광등)은 고치고, 반대쪽은 절반만
  const rb = (r + b) / 2
  const rawTint = g > 0 ? ((1 - rb / g) / 0.004) * 0.7 : 0
  const tint = Math.max(-25, Math.min(25, rawTint > 0 ? rawTint : rawTint * 0.5))

  const round = (v: number) => Math.round(v * 100) / 100
  return { exposure: round(exposure), temperature: round(temperature), tint: round(tint) }
}
