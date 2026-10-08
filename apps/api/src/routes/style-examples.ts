import { Hono } from 'hono'
import { eq, desc, asc, and } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, type AuthVariables } from '../middleware/auth.js'
import { STYLE_EXAMPLE_LIMIT } from '@beautypost/shared'

const styleExamples = new Hono<{ Variables: AuthVariables }>()
styleExamples.use('*', authMiddleware)

// GET /api/style-examples — list this account's saved style samples (newest first)
styleExamples.get('/', async (c) => {
  const userId = c.get('userId')
  const rows = await getDb()
    .select()
    .from(schema.styleExamples)
    .where(eq(schema.styleExamples.userId, userId))
    .orderBy(desc(schema.styleExamples.createdAt))
  return c.json({ data: rows })
})

// POST /api/style-examples — save a caption as a style sample.
// Enforces STYLE_EXAMPLE_LIMIT by evicting the oldest when full.
styleExamples.post('/', async (c) => {
  const userId = c.get('userId')
  const { text } = await c.req.json<{ text: string }>()
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '저장할 내용이 없어요.' }, 400)
  }
  if (trimmed.length > 2000) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '내용이 너무 길어요.' }, 400)
  }

  const db = getDb()

  // Evict oldest rows so that after insert we stay within the limit.
  const existing = await db
    .select({ id: schema.styleExamples.id })
    .from(schema.styleExamples)
    .where(eq(schema.styleExamples.userId, userId))
    .orderBy(asc(schema.styleExamples.createdAt))

  const overflow = existing.length - (STYLE_EXAMPLE_LIMIT - 1)
  if (overflow > 0) {
    for (const row of existing.slice(0, overflow)) {
      await db.delete(schema.styleExamples).where(eq(schema.styleExamples.id, row.id))
    }
  }

  const inserted = await db
    .insert(schema.styleExamples)
    .values({ userId, text: trimmed })
    .returning()

  return c.json({ data: inserted[0]! }, 201)
})

// DELETE /api/style-examples/:id — remove a saved sample
styleExamples.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = getDb()
  await db
    .delete(schema.styleExamples)
    .where(and(eq(schema.styleExamples.id, id), eq(schema.styleExamples.userId, userId)))
  return c.json({ data: { ok: true } })
})

export default styleExamples
