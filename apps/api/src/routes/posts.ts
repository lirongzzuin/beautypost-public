import { Hono } from 'hono'
import { eq, and, desc, gte, lte, inArray } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { apiRateLimit } from '../middleware/ratelimit.js'
import { grantReward } from '../lib/rewards.js'
import { publishFeed, publishCarousel } from '../lib/instagram.js'

const posts = new Hono<{ Variables: AuthVariables }>()
posts.use('*', authMiddleware, apiRateLimit)

// GET /api/posts — list posts with optional date range
posts.get('/', async (c) => {
  const userId = c.get('userId')
  const db = getDb()

  const from = c.req.query('from')
  const to = c.req.query('to')
  const status = c.req.query('status')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100)
  const offset = Number(c.req.query('offset') ?? 0)

  const conditions = [eq(schema.posts.userId, userId)]
  if (from) conditions.push(gte(schema.posts.scheduledAt, new Date(from)))
  if (to) conditions.push(lte(schema.posts.scheduledAt, new Date(to)))
  if (status) conditions.push(eq(schema.posts.status, status as any))

  const results = await db
    .select()
    .from(schema.posts)
    .where(and(...conditions))
    .orderBy(desc(schema.posts.createdAt))
    .limit(limit)
    .offset(offset)

  return c.json({ data: results })
})

// GET /api/posts/:id
posts.get('/:id', async (c) => {
  const userId = c.get('userId')
  const [post] = await getDb()
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.id, c.req.param('id')), eq(schema.posts.userId, userId)))
    .limit(1)

  if (!post) return c.json({ code: 'POST_NOT_FOUND', message_ko: '게시물을 찾을 수 없어요.' }, 404)
  return c.json({ data: post })
})

// POST /api/posts — create draft
posts.post('/', entitlementMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{
    caption: string
    hashtags?: string[]
    mediaIds?: string[]
    channels?: string[]
    theme?: string
    keywords?: string
    scheduledAt?: string
    blogTitle?: string
    blogBody?: string
    blogTags?: string[]
    type?: 'feed' | 'carousel' | 'reel'
  }>()

  if (!body.caption) {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '캡션을 입력해주세요.' }, 400)
  }

  const db = getDb()
  const [post] = await db
    .insert(schema.posts)
    .values({
      userId,
      type: body.type ?? 'feed',
      status: body.scheduledAt ? 'scheduled' : 'draft',
      caption: body.caption,
      hashtags: body.hashtags ?? [],
      mediaIds: body.mediaIds ?? [],
      channels: body.channels ?? [],
      theme: body.theme,
      keywords: body.keywords,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      blogTitle: body.blogTitle,
      blogBody: body.blogBody,
      blogTags: body.blogTags ?? [],
    })
    .returning()

  return c.json({ data: post }, 201)
})

// PATCH /api/posts/:id — update draft
posts.patch('/:id', entitlementMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = getDb()

  const [existing] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.id, id), eq(schema.posts.userId, userId)))
    .limit(1)

  if (!existing) return c.json({ code: 'POST_NOT_FOUND', message_ko: '게시물을 찾을 수 없어요.' }, 404)
  if (existing.status === 'published') {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '이미 게시된 글은 수정할 수 없어요.' }, 400)
  }

  const body = await c.req.json()
  const allowed = ['caption', 'hashtags', 'mediaIds', 'channels', 'theme', 'keywords', 'scheduledAt', 'blogTitle', 'blogBody', 'blogTags']
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  for (const key of allowed) {
    if (key in body) {
      updates[key] = key === 'scheduledAt' ? (body[key] ? new Date(body[key]) : null) : body[key]
    }
  }
  if (updates.scheduledAt) updates.status = 'scheduled'

  const [updated] = await db.update(schema.posts).set(updates as any).where(eq(schema.posts.id, id)).returning()
  return c.json({ data: updated })
})

// DELETE /api/posts/:id
posts.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = getDb()

  const [existing] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.id, id), eq(schema.posts.userId, userId)))
    .limit(1)

  if (!existing) return c.json({ code: 'POST_NOT_FOUND', message_ko: '게시물을 찾을 수 없어요.' }, 404)

  await db.delete(schema.posts).where(eq(schema.posts.id, id))
  return c.json({ data: { ok: true } })
})

// POST /api/posts/:id/publish — immediate publish
posts.post('/:id/publish', entitlementMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = getDb()

  const [post] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.id, id), eq(schema.posts.userId, userId)))
    .limit(1)

  if (!post) return c.json({ code: 'POST_NOT_FOUND', message_ko: '게시물을 찾을 수 없어요.' }, 404)
  if (post.status === 'published') {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '이미 게시된 글이에요.' }, 400)
  }

  // Validate Instagram prerequisites BEFORE flipping to 'publishing', so a
  // misconfiguration leaves the post as a reusable draft instead of a dead end.
  if (post.channels.includes('instagram')) {
    const [channel] = await db
      .select()
      .from(schema.channelConnections)
      .where(and(
        eq(schema.channelConnections.userId, userId),
        eq(schema.channelConnections.channelType, 'instagram'),
        eq(schema.channelConnections.status, 'connected'),
      ))
      .limit(1)

    if (!channel?.accessToken || !channel?.instagramUserId) {
      return c.json({ code: 'INSTAGRAM_NOT_CONNECTED', message_ko: '인스타그램을 먼저 연결해주세요. (더보기 → 채널 연결)' }, 400)
    }
    if (post.mediaIds.length === 0) {
      return c.json({ code: 'VALIDATION_ERROR', message_ko: '사진을 한 장 이상 올려주세요.' }, 400)
    }
  }

  await db.update(schema.posts).set({ status: 'publishing' }).where(eq(schema.posts.id, id))

  try {
    let instagramMediaId: string | undefined

    if (post.channels.includes('instagram')) {
      const [channel] = await db
        .select()
        .from(schema.channelConnections)
        .where(and(
          eq(schema.channelConnections.userId, userId),
          eq(schema.channelConnections.channelType, 'instagram'),
          eq(schema.channelConnections.status, 'connected'),
        ))
        .limit(1)

      if (channel?.accessToken && channel?.instagramUserId) {
        const caption = post.caption + '\n\n' + post.hashtags.join(' ')
        const mediaUrls = await getMediaUrls(db, post.mediaIds)

        if (mediaUrls.length === 1) {
          const result = await publishFeed(channel.accessToken, channel.instagramUserId, mediaUrls[0]!, caption)
          instagramMediaId = result.instagramMediaId
        } else if (mediaUrls.length > 1) {
          const result = await publishCarousel(channel.accessToken, channel.instagramUserId, mediaUrls, caption)
          instagramMediaId = result.instagramMediaId
        }
      }
    }

    await db.update(schema.posts).set({
      status: 'published',
      publishedAt: new Date(),
      instagramMediaId,
      updatedAt: new Date(),
    }).where(eq(schema.posts.id, id))

    // Check rewards
    const publishedCount = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.userId, userId), eq(schema.posts.status, 'published')))
      .then((r) => r.length)

    if (publishedCount === 1) {
      await grantReward(db, userId, 'first_post')
    }

    return c.json({ data: { ok: true, instagramMediaId } })
  } catch (err) {
    console.error('Publish failed:', err)
    await db.update(schema.posts).set({
      status: 'failed',
      failureReason: String(err),
      updatedAt: new Date(),
    }).where(eq(schema.posts.id, id))
    return c.json({ code: 'POST_PUBLISH_FAILED', message_ko: '게시에 실패했어요. 잠시 후 다시 시도해주세요.' }, 500)
  }
})

// GET /api/posts/stats/weekly
posts.get('/stats/weekly', async (c) => {
  const userId = c.get('userId')
  const db = getDb()

  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1)

  const goal = profile?.weeklyPostGoal ?? 3

  // Calendar week Sunday–Saturday, in KST (UTC+9) regardless of server timezone.
  const KST_MS = 9 * 60 * 60 * 1000
  const nowKst = new Date(Date.now() + KST_MS)
  const dow = nowKst.getUTCDay() // 0=Sun … 6=Sat (in KST)
  // UTC instant corresponding to KST 00:00 of this week's Sunday.
  const sundayStartUtc = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() - dow) - KST_MS
  const weekStart = new Date(sundayStartUtc)
  const weekEnd = new Date(sundayStartUtc + 7 * 24 * 60 * 60 * 1000)
  const kstDateStr = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10)

  const published = await db
    .select()
    .from(schema.posts)
    .where(and(
      eq(schema.posts.userId, userId),
      eq(schema.posts.status, 'published'),
      gte(schema.posts.publishedAt, weekStart),
      lte(schema.posts.publishedAt, weekEnd),
    ))

  const days: { date: string; posted: boolean }[] = []
  for (let i = 0; i < 7; i++) {
    const dayUtc = new Date(sundayStartUtc + i * 24 * 60 * 60 * 1000)
    const dateStr = kstDateStr(dayUtc)
    const posted = published.some((p) => p.publishedAt && kstDateStr(p.publishedAt) === dateStr)
    days.push({ date: dateStr, posted })
  }

  // Current streak = consecutive posted days ending today (going backward).
  let currentStreak = 0
  for (let i = dow; i >= 0; i--) {
    if (days[i]?.posted) currentStreak++
    else break
  }

  return c.json({
    data: {
      goal,
      achieved: published.length,
      days,
      currentStreak,
    },
  })
})

async function getMediaUrls(db: ReturnType<typeof getDb>, mediaIds: string[]): Promise<string[]> {
  if (!mediaIds.length) return []
  const rows = await db
    .select()
    .from(schema.media)
    .where(inArray(schema.media.id, mediaIds))
  // Preserve original order from mediaIds
  const urlMap = new Map(rows.map((m) => [m.id, m.processedUrl ?? m.originalUrl]))
  return mediaIds.map((id) => urlMap.get(id)).filter(Boolean) as string[]
}

export default posts
