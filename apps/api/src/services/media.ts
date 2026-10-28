import { and, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { analyzeImages, ANALYSIS_BATCH, type MediaAnalysis } from '@beautypost/caption'
import { AiUnavailableError, type AiClient } from '@beautypost/ai'
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

/** 이 인스턴스에서 진행 중인 분석 (글·사진·영상 요청이 동시에 와도 같은 사진을 두 번 분석하지 않게) */
const inflight = new Map<string, Promise<void>>()

/**
 * 아직 분석하지 않은 사진·영상(대표 화면)을 분석해 media.analysis 에 저장한다 (사진당 1회).
 * 여러 장을 AI 요청 한 번(최대 ANALYSIS_BATCH 장)으로 묶는다 — 사진마다 요청하면 분당 요청 한도에 바로 걸린다.
 * AI 를 쓸 수 없으면 AiUnavailableError 를 그대로 던진다 (호출한 쪽이 계속할지 정한다).
 */
export async function ensureAnalyses(db: Db, ai: AiClient, rows: MediaRow[], industryLabel: string): Promise<void> {
  const waits: Promise<void>[] = []
  const mine: MediaRow[] = []
  for (const r of rows) {
    if (r.analysis) continue
    const running = inflight.get(r.id)
    if (running) waits.push(running.then(() => reload(db, r)))
    else if (!mine.some((m) => m.id === r.id)) mine.push(r)
  }
  for (let i = 0; i < mine.length; i += ANALYSIS_BATCH) {
    const chunk = mine.slice(i, i + ANALYSIS_BATCH)
    const run = analyzeChunk(db, ai, chunk, industryLabel)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    for (const r of chunk) inflight.set(r.id, settled)
    try {
      await run
    } finally {
      for (const r of chunk) if (inflight.get(r.id) === settled) inflight.delete(r.id)
    }
  }
  await Promise.all(waits)
  // 같은 사진이 목록에 두 번 있으면 나머지에도 결과를 채운다
  const byId = new Map(rows.filter((r) => r.analysis).map((r) => [r.id, r]))
  for (const r of rows) if (!r.analysis && byId.has(r.id)) Object.assign(r, byId.get(r.id))
}

/**
 * 사진·영상 만들기용: 분석은 얼굴 확인·구도 잡기에 쓰지만, AI 를 잠시 못 쓴다고 결과물을 막지는 않는다.
 * 분석 없는 사진은 원장님이 얼굴 여부를 직접 답했을 때만 쓰인다 (assertConsent).
 */
export async function tryAnalyses(db: Db, ai: AiClient, rows: MediaRow[], industryLabel: string): Promise<void> {
  try {
    await ensureAnalyses(db, ai, rows, industryLabel)
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) throw e
    console.warn(`[analysis] AI 를 쓸 수 없어 분석 없이 진행 (${e.reason}): ${rows.filter((r) => !r.analysis).length}장`)
  }
}

/** 한 장만 (예전 경로 호환) */
export async function ensureAnalysis(db: Db, ai: AiClient, row: MediaRow, industryLabel: string): Promise<MediaAnalysis | null> {
  await ensureAnalyses(db, ai, [row], industryLabel)
  return (row.analysis as unknown as MediaAnalysis | null) ?? null
}

async function reload(db: Db, row: MediaRow): Promise<void> {
  const [fresh] = await db.select().from(schema.media).where(eq(schema.media.id, row.id)).limit(1)
  if (fresh) Object.assign(row, fresh)
}

async function analyzeChunk(db: Db, ai: AiClient, rows: MediaRow[], industryLabel: string): Promise<void> {
  const imgs = await Promise.all(rows.map((r) => analysisImage(r)))
  const targets = rows.flatMap((r, i) => (imgs[i] ? [{ row: r, image: imgs[i]! }] : []))
  if (!targets.length) return
  const { analyses } = await analyzeImages(
    ai,
    targets.map((t) => ({ image: { data: t.image, mediaType: 'image/jpeg' }, role: t.row.role })),
    { industryLabel },
  )
  await Promise.all(
    targets.map(async ({ row }, i) => {
      const analysis = analyses[i]
      if (!analysis) return // 모델이 빠뜨린 사진은 분석 없음으로 둔다 (다음 요청 때 다시)
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
    }),
  )
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

/**
 * 원장님이 고를 수 있는 동의 값인지 (얼굴이 보이는 사진에 '얼굴 없음'은 안 됨, 영상 가림은 아직 없음).
 * 얼굴 가림은 브랜드 설정에서 켠 경우만 (기본 끔 — 얼굴 전체를 흐리면 눈썹·속눈썹 같은 시술 부위까지 가려진다)
 */
export function consentAllowed(row: MediaRow, consent: string, opts: { allowFaceBlur?: boolean } = {}): boolean {
  if (consent === 'not_needed') return row.type === 'video' || !hasFaces(row)
  if (consent === 'blurred') return row.type === 'image' && !!opts.allowFaceBlur
  return true
}

/** 얼굴이 나온 사진·영상은 게시 동의(또는 사진이면 얼굴 가림)가 있어야 결과물에 쓸 수 있다 */
export function assertConsent(rows: MediaRow[]): void {
  const need = rows.filter((r) => !consentOk(r))
  // 분석을 못 해서 얼굴이 나오는지 모르는 사진 (AI 한도 등) → 원장님이 직접 답하면 쓸 수 있다
  if (need.length && need.every((r) => r.type === 'image' && !r.analysis)) {
    throw new ApiError(409, 'CONSENT_REQUIRED', '사진 분석이 잠시 안 돼서 고객 얼굴이 나오는지 확인하지 못했어요. 사진 올리기 단계에서 얼굴이 나오는지 알려 주세요.', {
      mediaIds: need.map((r) => r.id),
    })
  }
  if (need.length) {
    throw new ApiError(409, 'CONSENT_REQUIRED', '고객 얼굴이 나오는 사진·영상이 있어요. 게시 동의를 받았는지 확인해 주세요.', {
      mediaIds: need.map((r) => r.id),
    })
  }
}

export function blurBoxes(row: MediaRow) {
  return row.consent === 'blurred' ? row.faces ?? [] : []
}
