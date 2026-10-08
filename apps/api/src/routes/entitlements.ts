import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'

const entitlements = new Hono<{ Variables: AuthVariables }>()
entitlements.use('*', authMiddleware)

// GET /api/entitlements/me — current user's entitlement
entitlements.get('/me', async (c) => {
  const userId = c.get('userId')
  const db = getDb()

  const [ent] = await db
    .select()
    .from(schema.entitlements)
    .where(eq(schema.entitlements.userId, userId))
    .limit(1)

  if (!ent) return c.json({ code: 'NOT_FOUND', message_ko: '구독 정보를 찾을 수 없어요.' }, 404)

  const now = new Date()
  const trialDaysLeft = Math.max(0, Math.ceil((ent.periodEnd.getTime() - now.getTime()) / 86400000))

  return c.json({
    data: {
      plan: ent.plan,
      status: ent.periodEnd > now ? 'active' : 'expired',
      source: ent.source,
      periodEnd: ent.periodEnd.toISOString(),
      trialDaysLeft,
    },
  })
})

// GET /api/entitlements/rewards — reward log
entitlements.get('/rewards', async (c) => {
  const userId = c.get('userId')
  const db = getDb()

  const logs = await db
    .select()
    .from(schema.rewardLogs)
    .where(eq(schema.rewardLogs.userId, userId))
    .orderBy(schema.rewardLogs.createdAt)

  return c.json({ data: logs })
})

export default entitlements
