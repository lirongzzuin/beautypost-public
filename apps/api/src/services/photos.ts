import sharp from 'sharp'
import { autoPatch, beforeAfter, combineGrade, imageStats, processPhoto, type PhotoResult } from '@beautypost/photocraft'
import type { MediaAnalysis } from '@beautypost/caption'
import type { MoodOverrides, ResolvedPreset } from '@beautypost/preset'
import { getRegistry } from '@beautypost/preset'
import { schema, type Db } from '../db/index.js'
import { getStorage, makeKey } from '../storage/index.js'
import { ApiError } from './errors.js'
import { blurBoxes, decodable, readMedia, type MediaRow } from './media.js'
import { resolveFor, type ShopContext } from './context.js'

// 사진 보정: 프리셋 색감 + 자동 밝기·화이트밸런스(선택한 사진 전체를 합친 통계로 한 번) + 포맷 크롭.
// 같은 요청의 모든 사진(특히 비포·애프터)에는 같은 보정값을 쓴다.

export interface PhotoRequest {
  purpose: string
  industry?: string | null
  mood?: string | null
  formats: string[]
  overlayText?: string | null
  useLogo?: boolean
  adjust?: MoodOverrides | null
}

export interface PhotoOutput {
  mediaId: string
  url: string
  formatId: string
  kind: 'single' | 'collage'
  sourceIds: string[]
  width: number
  height: number
}

function focusOf(row: MediaRow) {
  return (row.analysis as unknown as MediaAnalysis | null)?.focus ?? { x: 0.5, y: 0.5 }
}

function isDark(row: MediaRow) {
  return (row.analysis as unknown as MediaAnalysis | null)?.quality.brightness === 'dark'
}

async function logoOf(db: Db, ctx: ShopContext, use?: boolean): Promise<Buffer | null> {
  const id = ctx.brandPreset?.logoMediaId
  if (!use || !id) return null
  const { ownedMedia } = await import('./media.js')
  const [row] = await ownedMedia(db, ctx.profile.userId, [id]).catch(() => [])
  return row ? readMedia(row) : null
}

export async function makePhotos(db: Db, ctx: ShopContext, rows: MediaRow[], req: PhotoRequest): Promise<{ outputs: PhotoOutput[]; clamped: string[] }> {
  const images = rows.filter((r) => r.type === 'image')
  if (!images.length) throw new ApiError(400, 'NO_PHOTOS', '보정할 사진을 골라 주세요.')
  const reg = getRegistry()
  for (const f of req.formats) {
    if (!reg.has('formats', f) || reg.format(f).kind === 'video') throw new ApiError(400, 'FORMAT_INVALID', `사진으로 만들 수 없는 형식이에요: ${f}`)
  }
  const buffers = await Promise.all(images.map((r) => readMedia(r)))
  const auto = autoPatch(await decodable(() => Promise.all(buffers.map((b) => imageStats(b)))))
  const logo = await logoOf(db, ctx, req.useLogo)
  // 노이즈 제거도 요청 전체에 한 번만 결정 → 비포·애프터를 똑같이 처리
  const denoise = images.some(isDark)
  const storage = getStorage()
  const outputs: PhotoOutput[] = []
  let clamped: string[] = []

  const save = async (res: PhotoResult, formatId: string, kind: PhotoOutput['kind'], sources: MediaRow[], role: string | null) => {
    const key = makeKey('photos', ctx.profile.userId, `${formatId}.jpg`)
    const obj = await storage.put(key, res.data, res.contentType)
    const [row] = await db
      .insert(schema.media)
      .values({
        userId: ctx.profile.userId, type: 'image', originalUrl: obj.url, storageKey: obj.key, mimeType: res.contentType,
        width: res.width, height: res.height, sizeBytes: res.data.length, status: 'ready', exifStripped: true,
        origin: 'photocraft', parentId: sources[0]!.id, formatId, role, consent: sources.some((s) => s.consent === 'granted') ? 'granted' : 'not_needed',
      })
      .returning()
    outputs.push({ mediaId: row!.id, url: obj.url, formatId, kind, sourceIds: sources.map((s) => s.id), width: res.width, height: res.height })
  }

  for (const formatId of req.formats) {
    const p: ResolvedPreset = resolveFor(ctx, { purpose: req.purpose, industry: req.industry, mood: req.mood, format: formatId, adjust: req.adjust })
    clamped = p.clamped
    const grade = combineGrade(p.mood.grade, auto, p.industry.gradeLimits)
    const fmt = p.format
    const overlay = req.overlayText?.trim() ? { text: req.overlayText.trim(), style: p.mood.photo.overlay } : null
    const frame = { style: p.mood.photo.frame, color: ctx.brandPreset?.brandColor ?? p.mood.palette.accent }
    const common = { width: fmt.width, height: fmt.height, grade, frame, overlay, logo, reserved: fmt.reserved, safeArea: fmt.safeArea }

    const before = images.find((r) => r.role === 'before')
    const after = images.find((r) => r.role === 'after')
    if (p.purpose.photo.layout === 'before-after-split' && before && after) {
      const res = await beforeAfter({
        ...common,
        before: { data: buffers[images.indexOf(before)]!, focus: focusOf(before), blur: blurBoxes(before) },
        after: { data: buffers[images.indexOf(after)]!, focus: focusOf(after), blur: blurBoxes(after) },
        labels: { before: 'BEFORE', after: 'AFTER', style: p.mood.photo.overlay },
        background: p.mood.palette.background,
        denoise,
      })
      await save(res, formatId, 'collage', [before, after], null)
    }
    for (const [i, row] of images.entries()) {
      const res = await processPhoto(buffers[i]!, { ...common, focus: focusOf(row), blur: blurBoxes(row), denoise })
      await save(res, formatId, 'single', [row], row.role)
    }
  }
  return { outputs, clamped }
}

/** 원장님 사진 한 장에 무드 5개를 입혀 본 작은 미리보기 (data URL) */
export async function moodPreviews(ctx: ShopContext, row: MediaRow, industry?: string | null) {
  if (row.type !== 'image') throw new ApiError(400, 'NOT_IMAGE', '미리보기는 사진으로만 볼 수 있어요.')
  const buf = await readMedia(row)
  const small = await decodable(() => sharp(buf).rotate().resize(720, 720, { fit: 'inside' }).jpeg({ quality: 90 }).toBuffer())
  const auto = autoPatch([await imageStats(small)])
  const reg = getRegistry()
  return Promise.all(
    reg.data.moods.map(async (m) => {
      const p = resolveFor(ctx, { purpose: reg.data.purposes[0]!.id, industry, mood: m.id, format: 'feed-portrait' })
      const res = await processPhoto(small, {
        width: 320, height: 400, grade: combineGrade(p.mood.grade, auto, p.industry.gradeLimits), focus: focusOf(row), blur: blurBoxes(row),
        frame: { style: p.mood.photo.frame, color: p.mood.palette.accent }, quality: 80,
      })
      return { moodId: m.id, label: m.label, dataUrl: `data:image/jpeg;base64,${res.data.toString('base64')}` }
    }),
  )
}
