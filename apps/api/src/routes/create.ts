import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { aiRateLimit, apiRateLimit } from '../middleware/ratelimit.js'
import { ApiError } from '../services/errors.js'
import { getAi } from '../services/ai.js'
import { industryOf, loadShop } from '../services/context.js'
import { assertConsent, ensureAnalysis, ownedMedia } from '../services/media.js'
import { createDrafts, saveFeedback } from '../services/drafts.js'
import { makePhotos } from '../services/photos.js'
import { requestVideo } from '../services/videos.js'
import { MoodOverrides, getRegistry } from '@beautypost/preset'

// 콘텐츠 만들기: 게시글 초안 · 사진 보정 · 영상 (영상은 작업 등록 후 즉시 응답, /jobs 로 진행 확인)
const create = new Hono<{ Variables: AuthVariables }>()
create.use('*', authMiddleware)

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw)
  if (!r.success) throw new ApiError(400, 'VALIDATION_ERROR', '입력값을 확인해주세요.', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
  return r.data
}

const Common = {
  mediaIds: z.array(z.string().uuid()).max(10),
  purpose: z.string(),
  industry: z.string().nullish(),
  mood: z.string().nullish(),
}

// POST /api/create/drafts — 인스타 후보 3 · 블로그 후보 2 (복사해서 바로 붙여넣기)
create.post('/drafts', entitlementMiddleware, aiRateLimit, async (c) => {
  const b = parse(z.object({ ...Common, keywords: z.string().max(300).nullish(), customerId: z.string().uuid().nullish() }), await c.req.json().catch(() => null))
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const rows = await ownedMedia(db, userId, b.mediaIds)
  return c.json({ data: await createDrafts(db, getAi(), ctx, rows, b) })
})

// POST /api/create/drafts/:id/feedback — 고른 후보·고친 글 저장 (다음 생성의 말투에 반영)
create.post('/drafts/:id/feedback', async (c) => {
  const b = parse(z.object({ channel: z.enum(['instagram', 'blog']), index: z.number().int().min(0), text: z.string().min(1).max(6000) }), await c.req.json().catch(() => null))
  return c.json({ data: await saveFeedback(getDb(), c.get('userId'), c.req.param('id'), b) })
})

// POST /api/create/photos — 프리셋 보정 + 포맷 변환 (+ 비포·애프터 콜라주)
create.post('/photos', entitlementMiddleware, aiRateLimit, async (c) => {
  const b = parse(
    z.object({
      ...Common,
      formats: z.array(z.string()).min(1).max(4),
      overlayText: z.string().max(60).nullish(),
      useLogo: z.boolean().optional(),
      adjust: MoodOverrides.nullish(),
    }),
    await c.req.json().catch(() => null),
  )
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const rows = await ownedMedia(db, userId, b.mediaIds)
  // 얼굴 여부는 분석으로 안다 → 동의 확인 전에 분석부터 (분석은 사진당 1회 캐시)
  const industry = getRegistry().industry(industryOf(ctx, b.industry))
  for (const r of rows) await ensureAnalysis(db, getAi(), r, industry.label)
  assertConsent(rows)
  return c.json({ data: await makePhotos(db, ctx, rows, b) })
})

// POST /api/create/videos — 영상 작업 등록 (렌더 작업자가 처리)
create.post('/videos', entitlementMiddleware, aiRateLimit, async (c) => {
  const b = parse(z.object({ ...Common, format: z.string(), keywords: z.string().max(300).nullish() }), await c.req.json().catch(() => null))
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const rows = await ownedMedia(db, userId, b.mediaIds)
  return c.json({ data: await requestVideo(db, getAi(), ctx, rows, b) }, 202)
})

// GET /api/create/jobs, /api/create/jobs/:id — 영상 진행 상황·결과
function presentJob(j: typeof schema.jobs.$inferSelect) {
  const payload = j.payload as { purpose?: { label?: string }; mood?: { label?: string }; format?: { id?: string; label?: string } }
  return {
    id: j.id,
    status: j.status, // pending | processing | completed | failed
    progress: j.progress,
    stage: j.stage,
    attempts: j.attempts,
    error: j.status === 'failed' ? friendlyJobError(j.error) : null,
    result: j.status === 'completed' ? j.result : null,
    title: [payload.purpose?.label, payload.mood?.label, payload.format?.label].filter(Boolean).join(' · '),
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
  }
}

/** 작업자 오류 원문(로그·경로 포함)은 DB 에만 두고, 원장님께는 할 수 있는 일을 안내한다 */
function friendlyJobError(raw: string | null): string {
  if (raw && /영상 구성 오류|작업 입력|장면이 없/.test(raw)) return '이 사진·영상 구성으로는 영상을 만들 수 없었어요. 사진을 바꾸거나 다른 목적을 골라 다시 시도해 주세요.'
  if (raw && /임대 만료|응답 없음/.test(raw)) return '영상 만드는 컴퓨터가 응답하지 않았어요. 잠시 후 다시 시도해 주세요.'
  return '영상을 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'
}

create.get('/jobs', async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.userId, c.get('userId')), eq(schema.jobs.type, 'render_reel')))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(20)
  return c.json({ data: rows.map(presentJob) })
})

create.get('/jobs/:id', async (c) => {
  const [j] = await getDb()
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, c.req.param('id')), eq(schema.jobs.userId, c.get('userId'))))
    .limit(1)
  if (!j) throw new ApiError(404, 'JOB_NOT_FOUND', '작업을 찾을 수 없어요.')
  return c.json({ data: presentJob(j) })
})

export default create
