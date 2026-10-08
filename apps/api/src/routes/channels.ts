import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { grantReward } from '../lib/rewards.js'
import { getOAuthUrl, exchangeCode } from '../lib/instagram.js'

const channels = new Hono<{ Variables: AuthVariables }>()
channels.use('*', authMiddleware)

async function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null
  const { Redis } = await import('@upstash/redis')
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

// GET /api/channels — list connected channels
channels.get('/', async (c) => {
  const userId = c.get('userId')
  const db = getDb()
  const rows = await db
    .select({
      id: schema.channelConnections.id,
      channelType: schema.channelConnections.channelType,
      status: schema.channelConnections.status,
      handle: schema.channelConnections.handle,
      tokenExpiresAt: schema.channelConnections.tokenExpiresAt,
    })
    .from(schema.channelConnections)
    .where(eq(schema.channelConnections.userId, userId))

  return c.json({ data: rows })
})

// GET /api/channels/instagram/oauth — start Instagram OAuth
channels.get('/instagram/oauth', entitlementMiddleware, async (c) => {
  const userId = c.get('userId')
  const nonce = randomBytes(16).toString('hex')
  const state = `${userId}:${nonce}`

  // Store state in Redis for CSRF validation (10 min TTL)
  const redis = await getRedis()
  if (redis) {
    await redis.set(`oauth_state:${state}`, userId, { ex: 600 })
  }

  const url = await getOAuthUrl(state)
  return c.json({ data: { url } })
})

// GET /api/channels/instagram/callback — handle OAuth callback
channels.get('/instagram/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')

  if (!code || !state) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '잘못된 콜백이에요.' }, 400)
  }

  const userId = state.split(':')[0]
  if (!userId) return c.json({ code: 'VALIDATION_ERROR', message_ko: '상태값이 유효하지 않아요.' }, 400)

  // Validate CSRF state
  const redis = await getRedis()
  if (redis) {
    const storedUserId = await redis.get<string>(`oauth_state:${state}`)
    if (!storedUserId || storedUserId !== userId) {
      return c.redirect(`${process.env.APP_URL}/settings/channels?error=csrf`)
    }
    await redis.del(`oauth_state:${state}`)
  }

  const db = getDb()
  try {
    const token = await exchangeCode(code)

    const existing = await db
      .select()
      .from(schema.channelConnections)
      .where(and(
        eq(schema.channelConnections.userId, userId),
        eq(schema.channelConnections.channelType, 'instagram'),
      ))
      .limit(1)
      .then((r) => r[0])

    if (existing) {
      await db
        .update(schema.channelConnections)
        .set({
          status: 'connected',
          accessToken: token.accessToken,
          instagramUserId: token.userId,
          handle: token.handle,
          tokenExpiresAt: token.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.channelConnections.id, existing.id))
    } else {
      await db.insert(schema.channelConnections).values({
        userId,
        channelType: 'instagram',
        status: 'connected',
        accessToken: token.accessToken,
        instagramUserId: token.userId,
        handle: token.handle,
        tokenExpiresAt: token.expiresAt,
      })
    }

    await grantReward(db, userId, 'instagram_connect')

    // Redirect to frontend success page
    return c.redirect(`${process.env.APP_URL}/settings/channels?connected=instagram`)
  } catch (err) {
    console.error('Instagram OAuth failed:', err)
    return c.redirect(`${process.env.APP_URL}/settings/channels?error=instagram`)
  }
})

// DELETE /api/channels/:channelType — disconnect channel
channels.delete('/:channelType', async (c) => {
  const userId = c.get('userId')
  const channelType = c.req.param('channelType') as 'instagram' | 'naver_blog'
  const db = getDb()

  await db
    .update(schema.channelConnections)
    .set({ status: 'disconnected', accessToken: null, refreshToken: null, updatedAt: new Date() })
    .where(and(
      eq(schema.channelConnections.userId, userId),
      eq(schema.channelConnections.channelType, channelType),
    ))

  return c.json({ data: { ok: true } })
})

export default channels
