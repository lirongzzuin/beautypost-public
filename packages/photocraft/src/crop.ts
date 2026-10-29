// 구도: 원본에서 어디를 잘라 화면(W×H)에 채울지. 사진(photocraft)과 영상(reel)이 같은 규칙을 쓴다.
// 시술 부위 영역(area, 분석 결과)이 있으면 부위 전체가 화면에 들어오고 적당히 크게 보이게,
// 없으면 원본을 가장 많이 남기는 쪽으로 (가운데 한 점만 보고 좁게 자르면 눈썹 대신 미간·이마만 남는다).

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Crop {
  left: number
  top: number
  width: number
  height: number
}

export interface FramingOptions {
  /** 시술 부위 영역 (원본 기준 0~1). 양쪽 눈썹이면 두 눈썹을 함께 감싼 영역 */
  area?: Box | null
  /** 부위가 없을 때 남길 중심 (0~1) */
  focus?: { x: number; y: number } | null
  /** 부위가 화면 폭에서 차지할 비율 (기본 0.62) */
  fill?: number
  /** 원본을 최대 몇 배까지 키울지 (흐려지지 않게, 기본 1.5) */
  maxUpscale?: number
  /** 부위 중심을 둘 세로 위치 (0~1, 기본 가운데). 부위가 잘리지 않는 범위에서만 따른다 */
  anchorY?: number
}

/** 쓸 수 있는 영역인지 (분석이 이상한 값을 줄 때 대비) */
export function validArea(a: Box | null | undefined): a is Box {
  return !!a && a.w > 0.002 && a.h > 0.002 && a.x >= -0.01 && a.y >= -0.01 && a.x + a.w <= 1.01 && a.y + a.h <= 1.01
}

/** 화면(W×H)에 맞는 원본 잘라낼 영역 (원본 픽셀) */
export function cropFor(sw: number, sh: number, W: number, H: number, o: FramingOptions): Crop {
  const aspect = W / H
  const maxW = Math.min(sw, sh * aspect) // 화면 비율로 원본에서 잘라낼 수 있는 가장 큰 폭
  let cw = maxW
  const fill = o.fill ?? 0.62
  const maxUp = o.maxUpscale ?? 1.5
  let cx = (o.focus?.x ?? 0.5) * sw
  let cy = (o.focus?.y ?? 0.5) * sh
  const area = validArea(o.area) ? o.area : null
  if (area) {
    const aw = area.w * sw
    const ah = area.h * sh
    // 부위 폭이 화면 폭의 fill 만큼, 그리고 부위 높이가 화면 높이의 80% 안에
    const want = Math.max(aw / fill, (ah / 0.8) * aspect)
    cw = Math.min(maxW, Math.max(want, W / maxUp))
    cx = (area.x + area.w / 2) * sw
    cy = (area.y + area.h / 2) * sh
  }
  // 크기를 먼저 정수로 정하고 위치를 그 안에서 고른다 (따로 반올림하면 1px 넘쳐 extract 가 실패한다)
  const width = Math.max(1, Math.min(sw, Math.round(cw)))
  const height = Math.max(1, Math.min(sh, Math.round(width / aspect)))
  let top = cy - height * (o.anchorY ?? 0.5)
  if (area) {
    // 원하는 세로 위치 때문에 부위가 잘리면 부위가 다 들어오는 쪽으로 당긴다
    const a0 = area.y * sh
    const a1 = (area.y + area.h) * sh
    if (a1 - a0 <= height) top = Math.min(a0, Math.max(a1 - height, top))
  }
  const left = Math.min(sw - width, Math.max(0, Math.round(cx - width / 2)))
  return { left, top: Math.min(sh - height, Math.max(0, Math.round(top))), width, height }
}

/** 잘라낸 영역에 부위가 얼마나 들어오는지 (0~1, 넓이 기준) */
export function coverage(crop: Crop, sw: number, sh: number, area: Box): number {
  const x0 = Math.max(crop.left, area.x * sw)
  const y0 = Math.max(crop.top, area.y * sh)
  const x1 = Math.min(crop.left + crop.width, (area.x + area.w) * sw)
  const y1 = Math.min(crop.top + crop.height, (area.y + area.h) * sh)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return inter / Math.max(1, area.w * sw * area.h * sh)
}

/** 잘라낸 영역 안에서 부위 중심의 화면 위치 (0~1) */
export function anchorIn(crop: Crop, sw: number, sh: number, area?: Box | null, focus?: { x: number; y: number } | null): { x: number; y: number } {
  const a = validArea(area) ? area : null
  const px = a ? (a.x + a.w / 2) * sw : (focus?.x ?? 0.5) * sw
  const py = a ? (a.y + a.h / 2) * sh : (focus?.y ?? 0.5) * sh
  return {
    x: Math.min(1, Math.max(0, (px - crop.left) / crop.width)),
    y: Math.min(1, Math.max(0, (py - crop.top) / crop.height)),
  }
}

export type CompareLayout = 'stack' | 'side'

export interface CompareSource {
  width: number
  height: number
  area?: Box | null
  focus?: { x: number; y: number } | null
}

/** 비교 화면의 칸 크기 */
export function compareCells(W: number, H: number, gap: number, layout: CompareLayout): { w: number; h: number } {
  return layout === 'stack' ? { w: W, h: Math.floor((H - gap) / 2) } : { w: Math.floor((W - gap) / 2), h: H }
}

/**
 * 비포·애프터 한 화면 배치: 위아래(stack) / 좌우(side) 중 시술 부위가 잘리지 않고 더 크게 보이는 쪽.
 * 부위를 모르면 원본을 더 많이 남기는 쪽 (가로로 긴 눈썹 사진을 좁은 좌우 칸에 넣으면 미간만 남는다).
 */
export function pickCompareLayout(W: number, H: number, gap: number, sources: CompareSource[], fill = 0.62): CompareLayout {
  const score = (layout: CompareLayout) => {
    const cell = compareCells(W, H, gap, layout)
    let s = 0
    for (const src of sources) {
      const crop = cropFor(src.width, src.height, cell.w, cell.h, { area: src.area, focus: src.focus, fill })
      const scale = cell.w / crop.width
      if (validArea(src.area)) {
        const cov = coverage(crop, src.width, src.height, src.area)
        // 부위가 잘리면 크게 깎고, 다 들어오면 화면에 보이는 부위 크기(픽셀)가 클수록
        const shown = src.area.w * src.width * scale * (src.area.h * src.height * scale)
        s += cov < 0.97 ? -10 * (1 - cov) - 1 : Math.log(1 + shown) / 20
      } else s += (crop.width * crop.height) / (src.width * src.height)
    }
    return s
  }
  return score('side') > score('stack') ? 'side' : 'stack'
}
