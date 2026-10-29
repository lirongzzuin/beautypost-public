import sharp from 'sharp'
import { anchorIn, applyGrade, coverage, cropFor, validArea, type Box, type Crop } from '@beautypost/photocraft'
import type { Grade } from '@beautypost/preset'

// 사진 한 장 → 영상용 "무대": 시술 부위를 중심으로 화면 비율에 맞게 잘라 2배 해상도로 준비해 두고,
// 프레임마다 확대 비율(z)만 바꿔 잘라 낸다 (천천히 밀어 들어가기·펀치 줌). 2배로 준비해 두면 1픽셀 단위로 끊기지 않는다.

// 구도(어디를 잘라 낼지)는 사진과 같은 규칙 → @beautypost/photocraft crop.ts
export { anchorIn, cropFor, type Box, type Crop }

const MAX_SOURCE = 2600 // 아주 큰 사진(4000px 이상)은 미리 줄여 속도를 지킨다

/** 원본을 방향 보정·축소·색보정까지 한 원시 RGB */
export async function decodeImage(file: string | Buffer, grade: Grade | null): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(file, { failOn: 'error' })
    .rotate()
    .resize(MAX_SOURCE, MAX_SOURCE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (grade) applyGrade(data, 3, grade)
  return { data, width: info.width, height: info.height }
}

export class Stage {
  private constructor(
    private readonly data: Buffer,
    private readonly W: number,
    private readonly H: number,
    /** 확대할 때 향하는 점 (화면 기준 0~1) — 시술 부위 중심 */
    readonly anchor: { x: number; y: number },
  ) {}

  /** 원시 RGB 원본 + 잘라낼 영역 → 무대 */
  static async fromRaw(src: { data: Buffer; width: number; height: number }, crop: Crop, W: number, H: number, anchor: { x: number; y: number }): Promise<Stage> {
    const data = await sharp(src.data, { raw: { width: src.width, height: src.height, channels: 3 } })
      .extract(crop)
      .resize(W * 2, H * 2, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer()
    return new Stage(data, W, H, anchor)
  }

  /** 이미 완성된 화면(W×H RGB)을 무대로 (비교 화면·카드) */
  static async fromFrame(frame: Buffer, W: number, H: number): Promise<Stage> {
    const data = await sharp(frame, { raw: { width: W, height: H, channels: 3 } }).resize(W * 2, H * 2, { kernel: 'lanczos3' }).raw().toBuffer()
    return new Stage(data, W, H, { x: 0.5, y: 0.5 })
  }

  /** 확대 비율 z(≥1)의 화면 한 장 */
  async frame(z: number): Promise<Buffer> {
    const SW = this.W * 2
    const SH = this.H * 2
    if (z <= 1.0005) return sharp(this.data, { raw: { width: SW, height: SH, channels: 3 } }).resize(this.W, this.H).raw().toBuffer()
    const w = Math.round(SW / z)
    const h = Math.round(SH / z)
    // 시술 부위 점이 화면의 같은 자리에 머문 채로 확대된다
    const left = Math.round(this.anchor.x * (SW - w))
    const top = Math.round(this.anchor.y * (SH - h))
    return sharp(this.data, { raw: { width: SW, height: SH, channels: 3 } })
      .extract({ left, top, width: w, height: h })
      .resize(this.W, this.H, { fit: 'fill' })
      .raw()
      .toBuffer()
  }
}

// ─── 사진 장면 배치 ──────────────────────────────────────────────────────────

export interface Placement {
  crop: Crop
  /** 화면 일부(가로 꽉 참)에만 사진을 두는 경우 그 세로 위치. null 이면 화면 전체 */
  win: { top: number; height: number } | null
  /** 시술 부위 중심 (사진 영역 기준 0~1) */
  anchor: { x: number; y: number }
  /** 시술 부위의 화면 세로 범위 (px). 부위를 모르면 null */
  areaSpan: { top: number; bottom: number } | null
}

/**
 * 사진 한 장을 세로 화면에 어떻게 놓을지.
 * - 시술 부위가 화면 전체(9:16)에 잘리지 않고 들어오면 꽉 채운 클로즈업
 * - 가로로 긴 부위(양쪽 눈썹)나 가로 사진처럼 꽉 채우면 부위가 잘리는 경우: 화면 가운데에 가로 꽉 찬 사진 칸을 두고
 *   위아래는 무드 배경색 (자막·이름표는 그 여백에 → 시술 부위를 가리지 않는다)
 */
export function placeImage(
  sw: number,
  sh: number,
  W: number,
  H: number,
  o: { area?: Box | null; focus?: { x: number; y: number } | null; fill: number },
): Placement {
  const area = validArea(o.area) ? o.area : null
  const span = (crop: Crop, top: number, height: number) =>
    area ? { top: top + ((area.y * sh - crop.top) / crop.height) * height, bottom: top + (((area.y + area.h) * sh - crop.top) / crop.height) * height } : null
  const full = cropFor(sw, sh, W, H, o)
  const fits = area ? coverage(full, sw, sh, area) >= 0.97 : sw / sh <= (W / H) * 1.4
  if (fits) return { crop: full, win: null, anchor: anchorIn(full, sw, sh, area, o.focus), areaSpan: span(full, 0, H) }
  const { crop, height } = windowFor(sw, sh, W, Math.round(H * 0.6), o)
  const top = Math.round(H * 0.47 - height / 2)
  return { crop, win: { top, height }, anchor: anchorIn(crop, sw, sh, area, o.focus), areaSpan: span(crop, top, height) }
}

/**
 * 가로 꽉 찬 사진 칸(폭 W)의 높이와 잘라낼 영역.
 * 부위를 알면 부위 높이의 4.5배쯤(눈썹이면 눈까지) 보이는 납작한 칸, 모르면 원본 비율 그대로 (최대 maxH).
 */
export function windowFor(
  sw: number,
  sh: number,
  W: number,
  maxH: number,
  o: { area?: Box | null; focus?: { x: number; y: number } | null; fill: number },
): { crop: Crop; height: number } {
  const area = validArea(o.area) ? o.area : null
  const minAspect = W / maxH
  const clampA = (a: number) => Math.min(1.5, Math.max(minAspect, a))
  let aspect = area ? clampA(Math.min(sw, (area.w * sw) / o.fill) / (area.h * sh * 4.5)) : clampA(sw / sh)
  for (;;) {
    const height = Math.min(maxH, Math.round(W / aspect))
    const crop = cropFor(sw, sh, W, height, o)
    // 부위가 잘리면 칸을 조금씩 세로로 늘린다
    if (!area || coverage(crop, sw, sh, area) >= 0.97 || aspect <= minAspect + 1e-6) return { crop, height }
    aspect = clampA(aspect * 0.85)
  }
}
