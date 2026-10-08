import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { aiRateLimit } from '../middleware/ratelimit.js'
import { generateCaption, generateBlogDraft } from '../lib/ai.js'
import { STYLE_EXAMPLE_LIMIT } from '@beautypost/shared'

const ai = new Hono<{ Variables: AuthVariables }>()
ai.use('*', authMiddleware, entitlementMiddleware, aiRateLimit)

// POST /api/ai/caption — generate caption + hashtags
ai.post('/caption', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    theme: string
    keywords?: string
    mediaIds?: string[]
    customerId?: string
  }>()

  if (!body.theme) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '게시 주제를 선택해주세요.' }, 400)
  }

  const db = getDb()
  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1)

  if (!profile) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '프로필 설정을 먼저 완료해주세요.' }, 400)
  }

  // Resolve customer name for review posts (name only — no other PII in prompt).
  let customerName: string | undefined
  if (body.customerId) {
    const [cust] = await db
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, body.customerId), eq(schema.customers.userId, userId)))
      .limit(1)
    customerName = cust?.name
  }

  // Load this account's preferred-style samples for few-shot personalization.
  const examples = await db
    .select({ text: schema.styleExamples.text })
    .from(schema.styleExamples)
    .where(eq(schema.styleExamples.userId, userId))
    .orderBy(desc(schema.styleExamples.createdAt))
    .limit(STYLE_EXAMPLE_LIMIT)

  try {
    const result = await generateCaption({
      theme: body.theme,
      keywords: body.keywords,
      category: profile.category,
      tone: profile.tone,
      shopName: profile.shopName,
      region: profile.region,
      services: profile.services,
      customServices: profile.customServices,
      customerName,
      styleExamples: examples.map((e) => e.text),
      prohibitedPhrases: profile.prohibitedPhrases,
      customHashtags: profile.customHashtags,
    })

    return c.json({ data: result })
  } catch (err) {
    console.error('AI caption generation failed:', err)
    return c.json({ code: 'AI_GENERATION_FAILED', message_ko: '문구 생성에 실패했어요. 다시 시도해주세요.' }, 500)
  }
})

// POST /api/ai/blog — generate blog draft from caption
ai.post('/blog', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    caption: string
    hashtags: string[]
    theme: string
  }>()

  if (!body.caption) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '캡션이 없어요.' }, 400)
  }

  const db = getDb()
  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1)

  if (!profile) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '프로필 설정을 먼저 완료해주세요.' }, 400)
  }

  try {
    const draft = await generateBlogDraft({
      caption: body.caption,
      hashtags: body.hashtags ?? [],
      theme: body.theme,
      shopName: profile.shopName,
      category: profile.category,
    })

    return c.json({ data: draft })
  } catch (err) {
    console.error('AI blog generation failed:', err)
    return c.json({ code: 'AI_GENERATION_FAILED', message_ko: '문구 생성에 실패했어요. 다시 시도해주세요.' }, 500)
  }
})

export default ai
