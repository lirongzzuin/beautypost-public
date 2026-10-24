import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { BrandPreset, getRegistry } from '@beautypost/preset'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { ApiError } from '../services/errors.js'
import { industryOf, loadShop } from '../services/context.js'

// 샵 단위 기본값: 업종·기본 무드·브랜드 컬러·로고·예약 안내 (말투 샘플은 /style-examples)
const brand = new Hono<{ Variables: AuthVariables }>()
brand.use('*', authMiddleware)

brand.get('/', async (c) => {
  const ctx = await loadShop(getDb(), c.get('userId'))
  const reg = getRegistry()
  return c.json({
    data: {
      industry: industryOf(ctx),
      mood: ctx.brandPreset?.baseMood ?? reg.data.moods[0]!.id,
      brandColor: ctx.brandPreset?.brandColor ?? null,
      logoMediaId: ctx.brandPreset?.logoMediaId ?? null,
      bookingLabel: ctx.brand?.bookingLabel ?? '',
      bookingUrl: ctx.brand?.bookingUrl ?? '',
    },
  })
})

const Body = z.object({
  industry: z.string().optional(),
  mood: z.string().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  logoMediaId: z.string().uuid().nullable().optional(),
  bookingLabel: z.string().max(40).optional(),
  bookingUrl: z.string().max(300).optional(),
})

brand.put('/', async (c) => {
  const userId = c.get('userId')
  const body = Body.safeParse(await c.req.json().catch(() => null))
  if (!body.success) throw new ApiError(400, 'VALIDATION_ERROR', '입력값을 확인해주세요.')
  const db = getDb()
  const ctx = await loadShop(db, userId)
  const reg = getRegistry()
  const b = body.data
  if (b.industry && !reg.has('industries', b.industry)) throw new ApiError(400, 'PRESET_NOT_FOUND', '없는 업종이에요.')
  if (b.mood && !reg.has('moods', b.mood)) throw new ApiError(400, 'PRESET_NOT_FOUND', '없는 스타일이에요.')
  const prev = ctx.brandPreset
  const moodChanged = b.mood && b.mood !== prev?.baseMood
  const preset = BrandPreset.parse({
    baseMood: b.mood ?? prev?.baseMood ?? reg.data.moods[0]!.id,
    // 기준 무드를 바꾸면 예전 무드에 대한 차이값은 의미가 없어서 비운다
    overrides: moodChanged ? {} : prev?.overrides ?? {},
    source: prev?.source ?? 'manual',
    brandColor: b.brandColor === null ? undefined : b.brandColor ?? prev?.brandColor,
    logoMediaId: b.logoMediaId === null ? undefined : b.logoMediaId ?? prev?.logoMediaId,
  })
  const values = {
    industry: b.industry ?? ctx.brand?.industry ?? null,
    brandPreset: preset as unknown as Record<string, unknown>,
    bookingLabel: b.bookingLabel ?? ctx.brand?.bookingLabel ?? null,
    bookingUrl: b.bookingUrl ?? ctx.brand?.bookingUrl ?? null,
    updatedAt: new Date(),
  }
  await db
    .insert(schema.brandProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.brandProfiles.userId, set: values })
  const [row] = await db.select().from(schema.brandProfiles).where(eq(schema.brandProfiles.userId, userId)).limit(1)
  return c.json({ data: { ok: true, industry: row?.industry, mood: preset.baseMood } })
})

export default brand
