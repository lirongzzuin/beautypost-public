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
  // 사진만 자동으로 '얼굴 없음' 처리. 영상은 대표 화면 한 장으로 판단할 수 없어 항상 원장님께 묻는다.
  // 이전에 '얼굴 없음'이었는데 다시 분석해서 얼굴이 나오면 동의를 다시 받는다
  let consent = row.consent
  if (row.type === 'image' && consent === 'unknown' && analysis.faces.length === 0) consent = 'not_needed'
  if (consent === 'not_needed' && analysis.faces.length > 0) consent = 'unknown'
  const [updated] = await db
    .update(schema.media)
    .set({ analysis: analysis as unknown as Record<string, unknown>, faces: analysis.faces, consent })
    .where(eq(schema.media.id, row.id))
    .returning()
  Object.assign(row, updated)
  return analysis
}

export function hasFaces(row: MediaRow): boolean {
  return (row.faces?.length ?? 0) > 0
}

/**
 * 이 미디어를 결과물에 써도 되는가 (동의 규칙의 단일 기준).
 * - 사진: 얼굴이 없거나, 고객 동의(granted) 또는 얼굴 가림(blurred)
 * - 영상: 원장님이 직접 "얼굴 안 나와요"(not_needed) 또는 고객 동의(granted). 영상 얼굴 가림은 아직 없음
 */
export function consentOk(row: MediaRow): boolean {
  if (row.type === 'video') return row.consent === 'granted' || row.consent === 'not_needed'
  if (!hasFaces(row)) return row.consent !== 'unknown' || row.analysis != null
  return row.consent === 'granted' || row.consent === 'blurred'
}

/** 원장님이 고를 수 있는 동의 값인지 (얼굴이 보이는 사진에 '얼굴 없음'은 안 됨, 영상 가림은 아직 없음) */
export function consentAllowed(row: MediaRow, consent: string): boolean {
  if (consent === 'not_needed') return row.type === 'video' || !hasFaces(row)
  if (consent === 'blurred') return row.type === 'image'
  return true
}

/** 얼굴이 나온 사진·영상은 게시 동의(또는 사진이면 얼굴 가림)가 있어야 결과물에 쓸 수 있다 */
export function assertConsent(rows: MediaRow[]): void {
  const need = rows.filter((r) => !consentOk(r))
  if (need.length) {
    throw new ApiError(409, 'CONSENT_REQUIRED', '고객 얼굴이 나오는지 확인이 필요한 사진·영상이 있어요. 게시 동의를 확인하거나 얼굴을 가려 주세요.', {
      mediaIds: need.map((r) => r.id),
    })
  }
}

export function blurBoxes(row: MediaRow) {
  return row.consent === 'blurred' ? row.faces ?? [] : []
}
