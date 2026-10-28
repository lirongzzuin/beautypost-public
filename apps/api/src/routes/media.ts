import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { MEDIA_ROLES, getRegistry } from '@beautypost/preset'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { ApiError } from '../services/errors.js'
import { getAi } from '../services/ai.js'
import { industryOf, loadShop } from '../services/context.js'
import { consentAllowed, ensureAnalyses, ownedMedia } from '../services/media.js'
import { moodPreviews } from '../services/photos.js'

// 올린 사진·영상: 역할(비포·애프터…), 게시 동의, 비전 분석, 무드 미리보기
const media = new Hono<{ Variables: AuthVariables }>()
media.use('*', authMiddleware)

const Patch = z.object({
  role: z.enum(MEDIA_ROLES).nullable().optional(),
  // granted: 고객 게시 동의 확인 · blurred: 얼굴 가림으로 게시 · unknown: 되돌리기
  // not_needed: 얼굴이 안 나온다고 원장님이 확인 (대표 화면을 못 읽은 영상)
  consent: z.enum(['granted', 'blurred', 'not_needed', 'unknown']).optional(),
})

media.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const body = Patch.safeParse(await c.req.json().catch(() => null))
  if (!body.success) throw new ApiError(400, 'VALIDATION_ERROR', '입력값을 확인해주세요.')
  const db = getDb()
  const [row] = await ownedMedia(db, userId, [c.req.param('id')!])
  const set: Partial<typeof schema.media.$inferInsert> = {}
  if (body.data.role !== undefined && body.data.role !== row!.role) {
    set.role = body.data.role
    set.analysis = null // 역할이 바뀌면 분석을 다시 (역할을 프롬프트에 넣기 때문)
    // 자동으로 붙은 '얼굴 없음'은 다시 분석해서 판단 (고객 동의·가림은 원장님 결정이라 유지)
    if (row!.consent === 'not_needed' && row!.type === 'image') set.consent = 'unknown'
  }
  if (body.data.consent) {
    const allowFaceBlur = body.data.consent === 'blurred' ? (await loadShop(db, userId)).settings.allowFaceBlur : false
    if (!consentAllowed(row!, body.data.consent, { allowFaceBlur })) {
      throw new ApiError(
        400,
        'CONSENT_INVALID',
        row!.type === 'video'
          ? '영상 속 얼굴 가림은 지원하지 않아요. 고객 동의를 받았거나 얼굴이 안 나오는 영상만 쓸 수 있어요.'
          : body.data.consent === 'blurred'
            ? '얼굴 가림은 브랜드 설정에서 켠 경우에만 쓸 수 있어요.'
            : '얼굴이 보이는 사진이에요. 게시 동의를 받았는지 확인해 주세요.',
      )
    }
    set.consent = body.data.consent
    set.consentAt = body.data.consent === 'unknown' ? null : new Date()
  }
  const [updated] = await db.update(schema.media).set(set).where(eq(schema.media.id, row!.id)).returning()
  return c.json({ data: present(updated!) })
})

// 분석은 사진당 1회 캐시되고 장수는 업로드로 제한되므로 하루 생성 횟수(aiRateLimit)에는 세지 않는다
// POST /api/media/analyze — 여러 장을 AI 요청 한 번으로 (사진마다 부르면 분당 요청 한도에 걸린다)
media.post('/analyze', entitlementMiddleware, async (c) => {
  const b = z.object({ ids: z.array(z.string()).min(1).max(10), industry: z.string().nullish() }).safeParse(await c.req.json().catch(() => null))
  if (!b.success) throw new ApiError(400, 'VALIDATION_ERROR', '입력값을 확인해주세요.')
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const rows = await ownedMedia(db, userId, b.data.ids)
  const industry = getRegistry().industry(industryOf(ctx, b.data.industry ?? null))
  await ensureAnalyses(db, getAi(), rows, industry.label)
  return c.json({ data: rows.map(present) })
})

media.post('/:id/analyze', entitlementMiddleware, async (c) => {
  const db = getDb()
  const userId = c.get('userId')
  const ctx = await loadShop(db, userId)
  const [row] = await ownedMedia(db, userId, [c.req.param('id')!])
  const industry = getRegistry().industry(industryOf(ctx, c.req.query('industry') ?? null))
  await ensureAnalyses(db, getAi(), [row!], industry.label)
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
