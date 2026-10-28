import sharp from 'sharp'
import type { Grade, TextStyle } from '@beautypost/preset'
import { applyGrade, type ImageStats } from './tone.js'
import { roundedRect, textBlock } from './text.js'

// 사진 한 장 처리: 방향 보정 → (얼굴 가림) → 포맷 크롭 → (약한 노이즈 제거) → 색보정 → 프레임 → 문구·로고.
// 모든 보정 값은 호출하는 쪽이 정한다 (같은 값을 비포·애프터에 똑같이 넘기는 것은 호출 쪽 책임 → beforeAfter()).

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface OverlaySpec {
  text: string
  style: TextStyle
  /** 화면 폭 대비 글자 크기 (기본 0.05) */
  scale?: number
}

export interface PhotoSpec {
  width: number
  height: number
  /** 크롭할 때 남길 중심 (0~1). 기본 가운데 */
  focus?: { x: number; y: number }
  grade: Grade
  denoise?: boolean
  /** 흐리게 할 영역 (원본 기준 0~1) — 고객 얼굴 가림 */
  blur?: Box[]
  frame?: { style: 'none' | 'border' | 'polaroid'; color: string }
  overlay?: OverlaySpec | null
  logo?: Buffer | null
  /** 문구·로고가 들어가면 안 되는 자리 (예: 스토리 링크 스티커), 출력 픽셀 좌표 */
  reserved?: { x: number; y: number; w: number; h: number }[]
  safeArea?: { top: number; bottom: number; side: number }
  quality?: number
}

export interface PhotoResult {
  data: Buffer
  width: number
  height: number
  contentType: 'image/jpeg'
}

/** 원본 통계 (자동 보정용). 방향 보정 후 작게 줄여 계산 */
export async function imageStats(input: Buffer): Promise<ImageStats> {
  const { channels } = await sharp(input).rotate().resize(256, 256, { fit: 'inside' }).removeAlpha().stats()
  return { mean: [channels[0]!.mean / 255, channels[1]!.mean / 255, channels[2]!.mean / 255] }
}

/** 얼굴 영역을 가우시안 블러로 가린다 (영역을 15% 넓혀서) */
async function blurRegions(img: sharp.Sharp, boxes: Box[]): Promise<sharp.Sharp> {
  if (!boxes.length) return img
  const { data, info } = await img.toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const sigma = Math.max(12, Math.round(Math.min(W, H) * 0.03))
  const patches = await Promise.all(
    boxes.map(async (b) => {
      const pad = 0.15
      const left = Math.max(0, Math.floor((b.x - b.w * pad) * W))
      const top = Math.max(0, Math.floor((b.y - b.h * pad) * H))
      const right = Math.min(W, Math.ceil((b.x + b.w * (1 + pad)) * W))
      const bottom = Math.min(H, Math.ceil((b.y + b.h * (1 + pad)) * H))
      const width = right - left
      const height = bottom - top
      if (width < 2 || height < 2) return null
      const input = await sharp(data).extract({ left, top, width, height }).blur(sigma).toBuffer()
      return { input, left, top }
    }),
  )
  return sharp(await sharp(data).composite(patches.filter((p): p is NonNullable<typeof p> => !!p)).toBuffer())
}

/** 출력 크기로 꽉 채워 자르기. 초점이 화면 밖으로 나가지 않게 오프셋을 정한다 */
async function cover(img: sharp.Sharp, W: number, H: number, focus = { x: 0.5, y: 0.5 }): Promise<sharp.Sharp> {
  const meta = await img.metadata()
  const sw = meta.width!
  const sh = meta.height!
  const scale = Math.max(W / sw, H / sh)
  const rw = Math.max(W, Math.round(sw * scale))
  const rh = Math.max(H, Math.round(sh * scale))
  const left = Math.min(rw - W, Math.max(0, Math.round(focus.x * rw - W / 2)))
  const top = Math.min(rh - H, Math.max(0, Math.round(focus.y * rh - H / 2)))
  const resized = await img.resize(rw, rh, { fit: 'fill' }).toBuffer()
  return sharp(resized).extract({ left, top, width: W, height: H })
}

async function gradeRaw(img: sharp.Sharp, grade: Grade): Promise<Buffer> {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  applyGrade(data, info.channels, grade)
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer()
}

/** 문구 배치: 위치 스타일 → 세이프존·예약 자리를 피한 y */
function placeY(position: TextStyle['position'], h: number, H: number, safe: { top: number; bottom: number }, reserved: PhotoSpec['reserved'], x0: number, w: number): number {
  const top = safe.top
  const bottom = H - safe.bottom - h
  let y =
    position === 'top' ? top : position === 'center' ? (H - h) / 2 : position === 'lower-third' ? H * 0.68 - h / 2 : bottom
  y = Math.min(bottom, Math.max(top, y))
  for (const r of reserved ?? []) {
    const overlapX = x0 < r.x + r.w && x0 + w > r.x
    const overlapY = y < r.y + r.h && y + h > r.y
    if (overlapX && overlapY) y = r.y - h - 16 >= top ? r.y - h - 16 : Math.min(bottom, r.y + r.h + 16)
  }
  return Math.round(y)
}

export async function overlayComposites(spec: PhotoSpec, W: number, H: number): Promise<sharp.OverlayOptions[]> {
  const out: sharp.OverlayOptions[] = []
  const safe = spec.safeArea ?? { top: Math.round(H * 0.05), bottom: Math.round(H * 0.05), side: Math.round(W * 0.06) }
  if (spec.overlay?.text.trim()) {
    const { style } = spec.overlay
    const size = Math.round(W * (spec.overlay.scale ?? 0.05))
    const maxW = W - safe.side * 2 - size
    const block = textBlock(spec.overlay.text.trim(), style, size, maxW)
    const padX = style.background ? Math.round(size * 0.6) : 0
    const padY = style.background ? Math.round(size * 0.35) : 0
    const bw = block.width + padX * 2
    const bh = block.height + padY * 2
    const left = Math.round((W - bw) / 2)
    const top = placeY(style.position, bh, H, safe, spec.reserved, left, bw)
    if (style.background) out.push({ input: Buffer.from(roundedRect(bw, bh, style.background, Math.round(size * 0.4))), left, top })
    out.push({ input: Buffer.from(block.svg), left: left + padX, top: top + padY })
  }
  if (spec.logo) {
    const size = Math.round(W * 0.14)
    const logo = await sharp(spec.logo).resize(size, size, { fit: 'inside' }).png().toBuffer()
    const m = await sharp(logo).metadata()
    out.push({ input: logo, left: W - safe.side - m.width!, top: safe.top })
  }
  return out
}

/** 프레임 안쪽 사진 영역. 사진은 처음부터 이 크기로 만들고 나중에 테두리를 두른다 (잘림 없음) */
function frameInsets(W: number, H: number, frame: PhotoSpec['frame']) {
  if (!frame || frame.style === 'none') return { m: 0, bottom: 0, iw: W, ih: H }
  const m = Math.round(W * (frame.style === 'border' ? 0.025 : 0.05))
  const bottom = frame.style === 'polaroid' ? Math.round(H * 0.09) : 0
  return { m, bottom, iw: W - m * 2, ih: H - m * 2 - bottom }
}

async function framed(inner: Buffer, W: number, H: number, frame: PhotoSpec['frame']): Promise<Buffer> {
  if (!frame || frame.style === 'none') return inner
  const { m } = frameInsets(W, H, frame)
  const bg = frame.style === 'polaroid' ? '#ffffff' : frame.color
  return sharp({ create: { width: W, height: H, channels: 3, background: bg } }).composite([{ input: inner, left: m, top: m }]).png().toBuffer()
}

export async function processPhoto(input: Buffer, spec: PhotoSpec): Promise<PhotoResult> {
  const W = spec.width
  const H = spec.height
  let img = sharp(input, { failOn: 'error' }).rotate() // EXIF 방향 적용 (이후 EXIF 는 출력에 남기지 않음)
  img = await blurRegions(img, spec.blur ?? [])
  const { iw, ih } = frameInsets(W, H, spec.frame)
  img = await cover(img, iw, ih, spec.focus)
  if (spec.denoise) img = sharp(await img.median(3).toBuffer())
  const photo = await framed(await gradeRaw(img, spec.grade), W, H, spec.frame)
  const composites = await overlayComposites(spec, W, H)
  const data = await sharp(photo)
    .composite(composites)
    .jpeg({ quality: spec.quality ?? 90, mozjpeg: true })
    .toBuffer()
  return { data, width: W, height: H, contentType: 'image/jpeg' }
}

// ─── 비포·애프터 콜라주 ─────────────────────────────────────────────────────────

export interface CollageSpec extends Omit<PhotoSpec, 'focus' | 'blur'> {
  /** 비포·애프터 공통 보정값 (하나만 받는다 → 두 장에 다른 보정을 넣을 수 없음) */
  grade: Grade
  before: { data: Buffer; focus?: { x: number; y: number }; blur?: Box[] }
  after: { data: Buffer; focus?: { x: number; y: number }; blur?: Box[] }
  labels?: { before: string; after: string; style: TextStyle }
  gap?: number
  background?: string
}

export async function beforeAfter(spec: CollageSpec): Promise<PhotoResult> {
  const { iw: W, ih: H } = frameInsets(spec.width, spec.height, spec.frame)
  const gap = spec.gap ?? Math.round(W * 0.01)
  const vertical = H / W > 1.3 // 9:16 은 위아래, 1:1·4:5 는 좌우
  const cw = vertical ? W : Math.floor((W - gap) / 2)
  const ch = vertical ? Math.floor((H - gap) / 2) : H
  const cell = async (side: CollageSpec['before']) => {
    let img = sharp(side.data, { failOn: 'error' }).rotate()
    img = await blurRegions(img, side.blur ?? [])
    img = await cover(img, cw, ch, side.focus)
    if (spec.denoise) img = sharp(await img.median(3).toBuffer())
    return gradeRaw(img, spec.grade) // 같은 grade
  }
  const [b, a] = await Promise.all([cell(spec.before), cell(spec.after)])
  const composites: sharp.OverlayOptions[] = [
    { input: b, left: 0, top: 0 },
    { input: a, left: vertical ? 0 : cw + gap, top: vertical ? ch + gap : 0 },
  ]
  if (spec.labels) {
    // 이름표: 각 칸 오른쪽 위 (레퍼런스 계정들의 "Before / After" 자리)
    const size = Math.round(Math.min(cw, ch) * 0.09)
    const st = spec.labels.style
    for (const [text, left, top] of [
      [spec.labels.before, 0, 0],
      [spec.labels.after, vertical ? 0 : cw + gap, vertical ? ch + gap : 0],
    ] as const) {
      const block = textBlock(text, st, size, cw)
      const padX = st.background ? Math.round(size * 0.5) : 0
      const padY = st.background ? Math.round(size * 0.25) : 0
      const bx = left + cw - block.width - padX * 2 - Math.round(size * 0.4)
      const by = top + Math.round(size * 0.35)
      if (st.background) composites.push({ input: Buffer.from(roundedRect(block.width + padX * 2, block.height + padY * 2, st.background, Math.round(size * 0.3))), left: bx, top: by })
      composites.push({ input: Buffer.from(block.svg), left: bx + padX, top: by + padY })
    }
  }
  const inner = await sharp({ create: { width: W, height: H, channels: 3, background: spec.background ?? '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer()
  const photo = await framed(inner, spec.width, spec.height, spec.frame)
  const extra = await overlayComposites(spec, spec.width, spec.height)
  const data = await sharp(photo).composite(extra).jpeg({ quality: spec.quality ?? 90, mozjpeg: true }).toBuffer()
  return { data, width: spec.width, height: spec.height, contentType: 'image/jpeg' }
}

// ─── 영상용 카드 (예약 안내·이벤트 제목 등) ─────────────────────────────────────

export interface CardSpec {
  width: number
  height: number
  background: string
  lines: { text: string; style: TextStyle; scale: number }[]
  logo?: Buffer | null
  safeArea?: { top: number; bottom: number; side: number }
}

/** 단색 배경 위에 문구를 세로 가운데로 쌓은 PNG */
export async function renderCard(spec: CardSpec): Promise<Buffer> {
  const W = spec.width
  const H = spec.height
  const safe = spec.safeArea ?? { top: 80, bottom: 80, side: 80 }
  const blocks = spec.lines
    .filter((l) => l.text.trim())
    .map((l) => {
      const size = Math.round(W * l.scale)
      return { b: textBlock(l.text.trim(), { ...l.style, stroke: l.style.stroke }, size, W - safe.side * 2), gap: Math.round(size * 0.5) }
    })
  const total = blocks.reduce((t, x) => t + x.b.height + x.gap, 0) - (blocks.at(-1)?.gap ?? 0)
  let y = Math.round(safe.top + (H - safe.top - safe.bottom - total) / 2)
  const composites: sharp.OverlayOptions[] = []
  if (spec.logo) {
    const size = Math.round(W * 0.2)
    const logo = await sharp(spec.logo).resize(size, size, { fit: 'inside' }).png().toBuffer()
    const m = await sharp(logo).metadata()
    composites.push({ input: logo, left: Math.round((W - m.width!) / 2), top: Math.max(safe.top, y - m.height! - 40) })
  }
  for (const { b, gap } of blocks) {
    composites.push({ input: Buffer.from(b.svg), left: Math.round((W - b.width) / 2), top: y })
    y += b.height + gap
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: spec.background } }).composite(composites).png().toBuffer()
}
