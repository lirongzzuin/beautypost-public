import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { MEDIA_ROLES, getRegistry } from '@beautypost/preset'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { aiRateLimit } from '../middleware/ratelimit.js'
import { ApiError } from '../services/errors.js'
import { getAi } from '../services/ai.js'
import { industryOf, loadShop } from '../services/context.js'
import { ensureAnalysis, ownedMedia } from '../services/media.js'
import { moodPreviews } from '../services/photos.js'

// 올린 사진·영상: 역할(비포·애프터…), 게시 동의, 비전 분석, 무드 미리보기
const media = new Hono<{ Variables: AuthVariables }>()
media.use('*', authMiddleware)

const Patch = z.object({
  role: z.enum(MEDIA_ROLES).nullable().optional(),
  // granted: 고객 게시 동의 확인 · blurred: 얼굴 가림으로 게시 · unknown: 되돌리기
  consent: z.enum(['granted', 'blurred', 'unknown']).optional(),
})

media.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = Patch.safeParse(await c.req.json().catch(() => null))
  if (!body.success) throw new ApiError(400, 'VALIDATION_ERROR', '입력값을 확인해주세요.')
  const db = getDb()
  const [row] = await ownedMedia(db, userId, [c.req.param('id')!])
  const set: Partial<typeof schema.media.$inferInsert> = {}
  if (body.data.role !== undefined) {
    set.role = body.data.role
    set.analysis = null // 역할이 바뀌면 분석을 다시 (역할을 프롬프트에 넣기 때문)
  }
  if (body.data.consent) {
    set.consent = body.data.consent
    set.consentAt = body.data.consent === 'unknown' ? null : new Date()
  }
  const [updated] = await db.update(schema.media).set(set).where(eq(schema.media.id, row!.id)).returning()
  return c.json({ data: present(updated!) })
})

media.post('/:id/analyze', entitlementMiddleware, aiRateLimit, async (c) => {
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const [row] = await ownedMedia(db, userId, [c.req.param('id')!])
  const industry = getRegistry().industry(industryOf(ctx, c.req.query('industry') ?? null))
  await ensureAnalysis(db, getAi(), row!, industry.label)
  return c.json({ data: present(row!) })
})

media.post('/:id/previews', entitlementMiddleware, async (c) => {
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const [row] = await ownedMedia(db, userId, [c.req.param('id')!])
  return c.json({ data: await moodPreviews(ctx, row!, c.req.query('industry')) })
})

export function present(m: typeof schema.media.$inferSelect) {
  return {
    id: m.id, type: m.type, url: m.originalUrl, thumbnailUrl: m.thumbnailUrl, width: m.width, height: m.height,
    durationSeconds: m.durationSeconds, role: m.role, consent: m.consent, faces: m.faces ?? null,
    analysis: m.analysis ?? null, origin: m.origin, formatId: m.formatId, createdAt: m.createdAt,
  }
}

export default media
