import { and, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { analyzeImage, type MediaAnalysis } from '@beautypost/caption'
import type { AiClient } from '@beautypost/ai'
import { schema, type Db } from '../db/index.js'
import { getStorage } from '../storage/index.js'
import { ApiError } from './errors.js'

export type MediaRow = typeof schema.media.$inferSelect

export const DECODE_MESSAGE =
  '이 사진 형식(HEIC 등)은 아직 처리할 수 없어요. 아이폰은 설정 > 카메라 > 포맷 > "높은 호환성"으로 바꾸거나 JPG 로 올려 주세요.'

/** 서버가 풀 수 없는 이미지(아이폰 HEIC 등)를 원장님이 이해할 수 있는 오류로 바꾼다 */
export async function decodable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (/heif|compression format|unsupported image format|bad seek|Input buffer contains unsupported/i.test(String((e as Error)?.message ?? e))) {
      throw new ApiError(422, 'MEDIA_DECODE_FAILED', DECODE_MESSAGE)
    }
    throw e
  }
}

/** 내 미디어만, 요청한 순서대로 */
export async function ownedMedia(db: Db, userId: string, ids: string[]): Promise<MediaRow[]> {
  if (!ids.length) return []
  const rows = await db.select().from(schema.media).where(and(eq(schema.media.userId, userId), inArray(schema.media.id, ids)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const missing = ids.filter((id) => !byId.has(id))
  if (missing.length) throw new ApiError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없어요. 다시 올려주세요.', { missing })
  return ids.map((id) => byId.get(id)!)
}

export async function readMedia(row: MediaRow): Promise<Buffer> {
  return getStorage().read(row.processedUrl ?? row.originalUrl)
}

/** 분석에 쓸 이미지: 사진은 원본, 영상은 업로드 때 함께 올린 대표 화면(thumbnail) */
async function analysisImage(row: MediaRow): Promise<Buffer | null> {
  const url = row.type === 'image' ? row.processedUrl ?? row.originalUrl : row.thumbnailUrl
  if (!url) return null
  const raw = await getStorage().read(url)
  // 비용·속도: 긴 변 1024px JPEG 로 줄여서 보낸다
  return decodable(() => sharp(raw).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer())
}

/** 비전 분석 (사진당 1회, 결과는 media.analysis 에 캐시). 얼굴이 없으면 동의 단계는 필요 없음 */
export async function ensureAnalysis(db: Db, ai: AiClient, row: MediaRow, industryLabel: string): Promise<MediaAnalysis | null> {
  if (row.analysis) return row.analysis as unknown as MediaAnalysis
  const img = await analysisImage(row)
  if (!img) return null
  const { analysis } = await analyzeImage(ai, { data: img, mediaType: 'image/jpeg' }, { industryLabel, role: row.role })
  const consent = row.consent === 'unknown' && analysis.faces.length === 0 ? 'not_needed' : row.consent
  const [updated] = await db
    .update(schema.media)
    .set({ analysis: analysis as unknown as Record<string, unknown>, faces: analysis.faces, consent })
    .where(eq(schema.media.id, row.id))
    .returning()
  Object.assign(row, updated)
  return analysis
}

/** 얼굴이 보이거나, 영상인데 대표 화면이 없어 얼굴 여부를 알 수 없으면 true */
export function hasFaces(row: MediaRow): boolean {
  if (row.type === 'video' && !row.analysis) return true
  return (row.faces?.length ?? 0) > 0
}

/** 얼굴이 나온 사진·영상은 게시 동의(또는 사진이면 얼굴 가림)가 있어야 결과물에 쓸 수 있다 */
export function assertConsent(rows: MediaRow[], opts: { video: boolean }): void {
  const need = rows.filter((r) => hasFaces(r) && !['granted', 'blurred', 'not_needed'].includes(r.consent))
  if (need.length) {
    throw new ApiError(409, 'CONSENT_REQUIRED', '고객 얼굴이 보이는 사진이 있어요. 게시 동의를 확인하거나 얼굴을 가려 주세요.', {
      mediaIds: need.map((r) => r.id),
    })
  }
  if (opts.video) {
    const blurredVideo = rows.filter((r) => r.type === 'video' && hasFaces(r) && r.consent === 'blurred')
    if (blurredVideo.length) {
      throw new ApiError(409, 'VIDEO_BLUR_UNSUPPORTED', '영상 속 얼굴 가림은 아직 지원하지 않아요. 고객 동의를 받은 영상만 쓰거나 이 영상을 빼 주세요.', {
        mediaIds: blurredVideo.map((r) => r.id),
      })
    }
  }
}

export function blurBoxes(row: MediaRow) {
  return row.consent === 'blurred' ? row.faces ?? [] : []
}
