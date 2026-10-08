import { Hono } from 'hono'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'

const notifications = new Hono<{ Variables: AuthVariables }>()
notifications.use('*', authMiddleware)

// GET /api/notifications
notifications.get('/', async (c) => {
  const userId = c.get('userId')
  const unreadOnly = c.req.query('unread') === 'true'
  const limit = Math.min(Number(c.req.query('limit') ?? 30), 100)
  const db = getDb()

  const conditions = [eq(schema.notifications.userId, userId)]
  if (unreadOnly) conditions.push(isNull(schema.notifications.readAt))

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(...conditions))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)

  const unreadCount = await db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .then((r) => r.length)

  return c.json({ data: rows, meta: { unreadCount } })
})

// POST /api/notifications/read-all
notifications.post('/read-all', async (c) => {
  const userId = c.get('userId')
  await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
  return c.json({ data: { ok: true } })
})

// PATCH /api/notifications/:id/read
notifications.patch('/:id/read', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
  return c.json({ data: { ok: true } })
})

export default notifications
