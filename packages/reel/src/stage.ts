import sharp from 'sharp'
import { applyGrade } from '@beautypost/photocraft'
import type { Grade } from '@beautypost/preset'

// 사진 한 장 → 영상용 "무대": 시술 부위를 중심으로 화면 비율에 맞게 잘라 2배 해상도로 준비해 두고,
// 프레임마다 확대 비율(z)만 바꿔 잘라 낸다 (천천히 밀어 들어가기·펀치 줌). 2배로 준비해 두면 1픽셀 단위로 끊기지 않는다.

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

const MAX_SOURCE = 2600 // 아주 큰 사진(4000px 이상)은 미리 줄여 속도를 지킨다

/**
 * 화면(W×H)에 맞는 원본 잘라낼 영역.
 * - area(시술 부위)가 있으면 부위가 화면 폭의 fill 만큼 차도록 가까이 (단, 원본을 maxUpscale 배 넘게 키우지 않음 → 흐려지지 않게)
 * - 없으면 focus 를 중심으로 화면을 꽉 채우는 가장 큰 영역
 */
export function cropFor(
  sw: number,
  sh: number,
  W: number,
  H: number,
  o: { area?: Box | null; focus?: { x: number; y: number } | null; fill?: number; maxUpscale?: number; /** 부위 중심을 둘 세로 위치 (0~1, 기본 가운데) */ anchorY?: number },
): Crop {
  const aspect = W / H
  let cw = Math.min(sw, sh * aspect)
  const fill = o.fill ?? 0.62
  const maxUp = o.maxUpscale ?? 1.5
  let cx = (o.focus?.x ?? 0.5) * sw
  let cy = (o.focus?.y ?? 0.5) * sh
  if (o.area && o.area.w > 0 && o.area.h > 0) {
    const aw = o.area.w * sw
    const ah = o.area.h * sh
    // 부위 폭 기준, 그리고 부위 높이가 화면 높이의 80% 안에 들어오게
    const want = Math.max(aw / fill, (ah / 0.8) * aspect)
    cw = Math.min(cw, Math.max(want, W / maxUp))
    cx = (o.area.x + o.area.w / 2) * sw
    cy = (o.area.y + o.area.h / 2) * sh
  }
  // 크기를 먼저 정수로 정하고 위치를 그 안에서 고른다 (따로 반올림하면 1px 넘쳐 extract 가 실패한다)
  const width = Math.max(1, Math.min(sw, Math.round(cw)))
  const height = Math.max(1, Math.min(sh, Math.round(width / aspect)))
  const left = Math.min(sw - width, Math.max(0, Math.round(cx - width / 2)))
  const top = Math.min(sh - height, Math.max(0, Math.round(cy - height * (o.anchorY ?? 0.5))))
  return { left, top, width, height }
}

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

/** 잘라낸 영역 안에서 시술 부위 중심의 화면 위치 (0~1) */
export function anchorIn(crop: Crop, sw: number, sh: number, area?: Box | null, focus?: { x: number; y: number } | null): { x: number; y: number } {
  const px = area ? (area.x + area.w / 2) * sw : (focus?.x ?? 0.5) * sw
  const py = area ? (area.y + area.h / 2) * sh : (focus?.y ?? 0.5) * sh
  return {
    x: Math.min(1, Math.max(0, (px - crop.left) / crop.width)),
    y: Math.min(1, Math.max(0, (py - crop.top) / crop.height)),
  }
}
