import { Hono } from 'hono'
import { eq, and, gt } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { getDb, schema } from '../db/index.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken, getRefreshExpiryDate } from '../lib/jwt.js'
import { sendEmail, magicLinkEmail } from '../lib/email.js'
import { grantReward } from '../lib/rewards.js'
import { authRateLimit } from '../middleware/ratelimit.js'
import { authMiddleware } from '../middleware/auth.js'
import { DEFAULT_TRIAL_DAYS } from '@beautypost/shared'

const auth = new Hono()

// POST /api/auth/magic-link — request magic link
auth.post('/magic-link', authRateLimit, async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email || !email.includes('@')) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '이메일 형식이 올바르지 않아요.' }, 400)
  }

  const db = getDb()
  const normalizedEmail = email.toLowerCase().trim()

  // Upsert user
  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, normalizedEmail))
    .limit(1)
    .then((r) => r[0])

  if (!user) {
    const inserted = await db
      .insert(schema.users)
      .values({ email: normalizedEmail, name: normalizedEmail.split('@')[0] })
      .returning()
    user = inserted[0]!

    // Create trial entitlement
    const periodEnd = new Date()
    periodEnd.setDate(periodEnd.getDate() + DEFAULT_TRIAL_DAYS)
    await db.insert(schema.entitlements).values({ userId: user.id, periodEnd })
  }

  // Invalidate previous magic links
  await db
    .update(schema.magicLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.magicLinks.email, normalizedEmail)))

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 min
  await db.insert(schema.magicLinks).values({ email: normalizedEmail, token, expiresAt })

  const link = `${process.env.APP_URL}/auth/verify?token=${token}`
  await sendEmail(magicLinkEmail(normalizedEmail, link))

  return c.json({ data: { sent: true } })
})

// GET /api/auth/verify — verify magic link token
auth.get('/verify', authRateLimit, async (c) => {
  const token = c.req.query('token')
  if (!token) return c.json({ code: 'VALIDATION_ERROR', message_ko: '토큰이 없어요.' }, 400)

  const db = getDb()
  const [link] = await db
    .select()
    .from(schema.magicLinks)
    .where(
      and(
        eq(schema.magicLinks.token, token),
        gt(schema.magicLinks.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!link || link.usedAt) {
    return c.json({ code: 'AUTH_MAGIC_LINK_EXPIRED', message_ko: '링크가 만료됐어요. 새 링크를 요청해주세요.' }, 400)
  }

  // Mark used
  await db.update(schema.magicLinks).set({ usedAt: new Date() }).where(eq(schema.magicLinks.id, link.id))

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, link.email))
    .limit(1)

  if (!user) return c.json({ code: 'NOT_FOUND', message_ko: '사용자를 찾을 수 없어요.' }, 404)

  const accessToken = await signAccessToken({ sub: user.id, email: user.email, role: user.role })
  const refreshToken = await signRefreshToken(user.id)
  const expiresAt = getRefreshExpiryDate()

  await db.insert(schema.refreshTokens).values({
    userId: user.id,
    token: refreshToken,
    expiresAt,
  })

  const profile = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, user.id))
    .limit(1)
    .then((r) => r[0])

  return c.json({
    data: {
      accessToken,
      refreshToken,
      expiresIn: 900,
      needsOnboarding: !profile,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
  })
})

// POST /api/auth/refresh — refresh access token
auth.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json<{ refreshToken: string }>()
  if (!refreshToken) return c.json({ code: 'VALIDATION_ERROR', message_ko: '입력 내용을 다시 확인해주세요.' }, 400)

  const db = getDb()
  try {
    const payload = await verifyRefreshToken(refreshToken)
    const [stored] = await db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.token, refreshToken),
          gt(schema.refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1)

    if (!stored || stored.revokedAt) {
      return c.json({ code: 'AUTH_INVALID_TOKEN', message_ko: '로그인 정보가 올바르지 않아요. 다시 로그인해주세요.' }, 401)
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .limit(1)

    if (!user) return c.json({ code: 'NOT_FOUND', message_ko: '사용자를 찾을 수 없어요.' }, 404)

    // Rotate refresh token
    await db.update(schema.refreshTokens).set({ revokedAt: new Date() }).where(eq(schema.refreshTokens.id, stored.id))

    const newAccess = await signAccessToken({ sub: user.id, email: user.email, role: user.role })
    const newRefresh = await signRefreshToken(user.id)
    const expiresAt = getRefreshExpiryDate()

    await db.insert(schema.refreshTokens).values({ userId: user.id, token: newRefresh, expiresAt })

    return c.json({ data: { accessToken: newAccess, refreshToken: newRefresh, expiresIn: 900 } })
  } catch {
    return c.json({ code: 'AUTH_INVALID_TOKEN', message_ko: '로그인 정보가 올바르지 않아요. 다시 로그인해주세요.' }, 401)
  }
})

// POST /api/auth/logout
auth.post('/logout', authMiddleware, async (c) => {
  const { refreshToken } = await c.req.json<{ refreshToken?: string }>()
  if (refreshToken) {
    const db = getDb()
    await db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.token, refreshToken))
  }
  return c.json({ data: { ok: true } })
})

// POST /api/auth/onboarding — complete onboarding (step 3 save)
auth.post('/onboarding', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    shopName: string
    region: string
    category: string
    tone: string
    weeklyPostGoal?: number
  }>()

  if (!body.shopName || !body.region) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '가게명과 지역은 필수예요.' }, 400)
  }

  const db = getDb()
  const existing = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1)
    .then((r) => r[0])

  if (existing) {
    await db
      .update(schema.profiles)
      .set({
        shopName: body.shopName,
        region: body.region,
        category: (body.category as any) ?? 'other',
        tone: (body.tone as any) ?? 'friendly',
        weeklyPostGoal: body.weeklyPostGoal ?? 3,
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.profiles.userId, userId))
  } else {
    await db.insert(schema.profiles).values({
      userId,
      shopName: body.shopName,
      region: body.region,
      category: (body.category as any) ?? 'other',
      tone: (body.tone as any) ?? 'friendly',
      weeklyPostGoal: body.weeklyPostGoal ?? 3,
      onboardingCompletedAt: new Date(),
    })
  }

  // Grant onboarding reward
  await grantReward(db, userId, 'onboarding_complete')

  return c.json({ data: { ok: true } })
})

// GET /api/auth/me — current user info (includes shopName from profile)
auth.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = getDb()

  const [[user], [ent], [profile]] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db.select().from(schema.entitlements).where(eq(schema.entitlements.userId, userId)).limit(1),
    db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1),
  ])

  if (!user) return c.json({ code: 'NOT_FOUND', message_ko: '사용자를 찾을 수 없어요.' }, 404)

  const now = new Date()
  const trialDaysLeft = ent
    ? Math.max(0, Math.ceil((ent.periodEnd.getTime() - now.getTime()) / 86400000))
    : 0

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      name: user.name,
      shopName: profile?.shopName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      entitlement: ent
        ? {
            plan: ent.plan,
            status: ent.status,
            source: ent.source,
            periodEnd: ent.periodEnd.toISOString(),
            trialDaysLeft,
          }
        : null,
    },
  })
})

// GET /api/auth/profile — full profile for edit page
auth.get('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = getDb()

  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1)

  if (!profile) {
    return c.json({ code: 'NOT_FOUND', message_ko: '프로필이 없어요. 온보딩을 먼저 완료해주세요.' }, 404)
  }

  return c.json({ data: profile })
})

export default auth
