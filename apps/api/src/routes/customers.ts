import { Hono } from 'hono'
import { eq, and, desc, ilike } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { apiRateLimit } from '../middleware/ratelimit.js'

const customers = new Hono<{ Variables: AuthVariables }>()
customers.use('*', authMiddleware, entitlementMiddleware, apiRateLimit)

// GET /api/customers
customers.get('/', async (c) => {
  const userId = c.get('userId')
  const search = c.req.query('search')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100)
  const offset = Number(c.req.query('offset') ?? 0)
  const db = getDb()

  const conditions = [eq(schema.customers.userId, userId)]
  if (search) conditions.push(ilike(schema.customers.name, `%${search}%`))

  const rows = await db
    .select()
    .from(schema.customers)
    .where(and(...conditions))
    .orderBy(desc(schema.customers.updatedAt))
    .limit(limit)
    .offset(offset)

  return c.json({ data: rows })
})

// GET /api/customers/:id
customers.get('/:id', async (c) => {
  const userId = c.get('userId')
  const db = getDb()
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, c.req.param('id')), eq(schema.customers.userId, userId)))
    .limit(1)

  if (!customer) return c.json({ code: 'NOT_FOUND', message_ko: '고객을 찾을 수 없어요.' }, 404)

  const media = await db
    .select()
    .from(schema.customerMedia)
    .where(eq(schema.customerMedia.customerId, customer.id))
    .orderBy(desc(schema.customerMedia.visitDate))

  return c.json({ data: { ...customer, media } })
})

// POST /api/customers
customers.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    name: string
    phone?: string
    memo?: string
    tags?: string[]
  }>()

  if (!body.name) return c.json({ code: 'VALIDATION_ERROR', message_ko: '이름을 입력해주세요.' }, 400)

  const db = getDb()
  const [customer] = await db
    .insert(schema.customers)
    .values({
      userId,
      name: body.name,
      phone: body.phone,
      memo: body.memo,
      tags: body.tags ?? [],
      lastVisitAt: new Date(),
    })
    .returning()

  return c.json({ data: customer }, 201)
})

// PATCH /api/customers/:id
customers.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = getDb()

  const [existing] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, id), eq(schema.customers.userId, userId)))
    .limit(1)

  if (!existing) return c.json({ code: 'NOT_FOUND', message_ko: '고객을 찾을 수 없어요.' }, 404)

  const body = await c.req.json<{
    name?: string
    phone?: string
    memo?: string
    tags?: string[]
    lastVisitAt?: string
  }>()

  const [updated] = await db
    .update(schema.customers)
    .set({
      ...(body.name && { name: body.name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.memo !== undefined && { memo: body.memo }),
      ...(body.tags && { tags: body.tags }),
      ...(body.lastVisitAt && { lastVisitAt: new Date(body.lastVisitAt) }),
      updatedAt: new Date(),
    })
    .where(eq(schema.customers.id, id))
    .returning()

  return c.json({ data: updated })
})

// DELETE /api/customers/:id
customers.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = getDb()

  const [existing] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, id), eq(schema.customers.userId, userId)))
    .limit(1)

  if (!existing) return c.json({ code: 'NOT_FOUND', message_ko: '고객을 찾을 수 없어요.' }, 404)
  await db.delete(schema.customers).where(eq(schema.customers.id, id))
  return c.json({ data: { ok: true } })
})

// POST /api/customers/:id/media — link media to customer visit
customers.post('/:id/media', async (c) => {
  const userId = c.get('userId')
  const customerId = c.req.param('id')
  const { mediaId, postId, visitDate } = await c.req.json<{
    mediaId: string
    postId?: string
    visitDate?: string
  }>()

  const db = getDb()
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.userId, userId)))
    .limit(1)

  if (!customer) return c.json({ code: 'NOT_FOUND', message_ko: '고객을 찾을 수 없어요.' }, 404)

  const [cm] = await db
    .insert(schema.customerMedia)
    .values({
      customerId,
      mediaId,
      postId,
      visitDate: visitDate ? new Date(visitDate) : new Date(),
    })
    .returning()

  // Increment visit count
  await db
    .update(schema.customers)
    .set({ visitCount: customer.visitCount + 1, lastVisitAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.customers.id, customerId))

  return c.json({ data: cm }, 201)
})

export default customers
