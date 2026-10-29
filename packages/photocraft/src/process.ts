import sharp from 'sharp'
import type { Grade, TextStyle } from '@beautypost/preset'
import { applyGrade, type ImageStats } from './tone.js'
import { roundedRect, textBlock } from './text.js'
import { compareCells, cropFor, pickCompareLayout, type Box, type CompareLayout } from './crop.js'

// 사진 한 장 처리: 방향 보정 → (얼굴 가림) → 포맷 크롭(시술 부위 기준) → (약한 노이즈 제거) → 색보정 → 문구·로고.
// 테두리·띠 같은 장식은 넣지 않는다 (원장님 요청: 보정만). 문구·로고는 원장님이 넣겠다고 한 경우만.
// 모든 보정 값은 호출하는 쪽이 정한다 (같은 값을 비포·애프터에 똑같이 넘기는 것은 호출 쪽 책임 → beforeAfter()).

export interface OverlaySpec {
  text: string
  style: TextStyle
  /** 화면 폭 대비 글자 크기 (기본 0.05) */
  scale?: number
}

export interface PhotoSpec {
  width: number
  height: number
  /** 크롭할 때 남길 중심 (0~1). 기본 가운데. area 가 있으면 area 를 따른다 */
  focus?: { x: number; y: number }
  /** 시술 부위 영역 (원본 기준 0~1) — 부위 전체가 들어오게 자른다 */
  area?: Box | null
  grade: Grade
  denoise?: boolean
  /** 흐리게 할 영역 (원본 기준 0~1) — 고객 얼굴 가림 */
  blur?: Box[]
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

/** 출력 크기로 꽉 채워 자르기 (시술 부위 기준 구도 → crop.ts) */
async function cover(img: sharp.Sharp, W: number, H: number, o: { area?: Box | null; focus?: { x: number; y: number } | null; fill: number }): Promise<sharp.Sharp> {
  const { data, info } = await img.toBuffer({ resolveWithObject: true })
  const crop = cropFor(info.width, info.height, W, H, { ...o, maxUpscale: 1.6 })
  return sharp(await sharp(data).extract(crop).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).toBuffer())
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

/** 한 장 사진에서 부위가 화면 폭에서 차지할 비율 (영상보다 덜 가깝게 — 눈썹이면 눈까지 보이게) */
const PHOTO_FILL = 0.72

export async function processPhoto(input: Buffer, spec: PhotoSpec): Promise<PhotoResult> {
  const W = spec.width
  const H = spec.height
  let img = sharp(input, { failOn: 'error' }).rotate() // EXIF 방향 적용 (이후 EXIF 는 출력에 남기지 않음)
  img = await blurRegions(img, spec.blur ?? [])
  img = await cover(img, W, H, { area: spec.area, focus: spec.focus, fill: PHOTO_FILL })
  if (spec.denoise) img = sharp(await img.median(3).toBuffer())
  const photo = await gradeRaw(img, spec.grade)
  const composites = await overlayComposites(spec, W, H)
  const data = await sharp(photo)
    .composite(composites)
    .jpeg({ quality: spec.quality ?? 90, mozjpeg: true })
    .toBuffer()
  return { data, width: W, height: H, contentType: 'image/jpeg' }
}

// ─── 비포·애프터 콜라주 ─────────────────────────────────────────────────────────

export interface CollageSide {
  data: Buffer
  focus?: { x: number; y: number } | null
  area?: Box | null
  blur?: Box[]
}

export interface CollageSpec extends Omit<PhotoSpec, 'focus' | 'blur'> {
  /** 비포·애프터 공통 보정값 (하나만 받는다 → 두 장에 다른 보정을 넣을 수 없음) */
  grade: Grade
  before: CollageSide
  after: CollageSide
  /** 배치 (기본: 시술 부위가 잘리지 않고 크게 보이는 쪽을 고른다 → pickCompareLayout) */
  layout?: CompareLayout
  labels?: { before: string; after: string; style: TextStyle }
  gap?: number
  background?: string
}

export async function beforeAfter(spec: CollageSpec): Promise<PhotoResult> {
  const W = spec.width
  const H = spec.height
  const gap = spec.gap ?? Math.round(W * 0.01)
  // 방향 보정한 원본 크기로 배치를 고른다 (분석 좌표도 방향 보정 후 기준)
  const sizes = await Promise.all([spec.before, spec.after].map(async (s) => {
    const { width, height } = (await sharp(s.data).metadata()).autoOrient
    return { width, height, area: s.area, focus: s.focus }
  }))
  const layout = spec.layout ?? pickCompareLayout(W, H, gap, sizes, PHOTO_FILL)
  const vertical = layout === 'stack'
  const { w: cw, h: ch } = compareCells(W, H, gap, layout)
  const cell = async (side: CollageSide) => {
    let img = sharp(side.data, { failOn: 'error' }).rotate()
    img = await blurRegions(img, side.blur ?? [])
    img = await cover(img, cw, ch, { area: side.area, focus: side.focus, fill: PHOTO_FILL })
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
  const photo = await sharp({ create: { width: W, height: H, channels: 3, background: spec.background ?? '#ffffff' } })
    .composite(composites)
    .png()
    .toBuffer()
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
