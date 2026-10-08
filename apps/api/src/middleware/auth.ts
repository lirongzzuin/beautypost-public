import type { Context, Next } from 'hono'
import { createMiddleware } from 'hono/factory'
import { verifyAccessToken } from '../lib/jwt.js'
import { getDb, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

export type AuthVariables = {
  userId: string
  email: string
  role: 'user' | 'admin'
}

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ code: 'AUTH_UNAUTHORIZED', message_ko: '로그인이 필요해요.' }, 401)
    }

    const token = authHeader.slice(7)
    try {
      const payload = await verifyAccessToken(token)
      c.set('userId', payload.sub)
      c.set('email', payload.email)
      c.set('role', payload.role as 'user' | 'admin')
    } catch {
      return c.json({ code: 'AUTH_INVALID_TOKEN', message_ko: '로그인 정보가 올바르지 않아요. 다시 로그인해주세요.' }, 401)
    }

    await next()
  },
)

export const adminMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c: Context, next: Next) => {
    const role = c.get('role')
    if (role !== 'admin') {
      return c.json({ code: 'AUTH_FORBIDDEN', message_ko: '접근 권한이 없어요.' }, 403)
    }
    await next()
  },
)

export const entitlementMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c: Context, next: Next) => {
    const userId = c.get('userId')
    const db = getDb()
    const [ent] = await db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, userId))
      .limit(1)

    if (!ent || ent.status !== 'active' || ent.periodEnd < new Date()) {
      return c.json(
        { code: 'ENTITLEMENT_EXPIRED', message_ko: '체험 기간이 끝났어요. 구독을 시작해주세요.' },
        403,
      )
    }
    await next()
  },
)

export const cronMiddleware = createMiddleware(async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return c.json({ code: 'AUTH_FORBIDDEN', message_ko: '접근 권한이 없어요.' }, 403)
  }
  await next()
})
