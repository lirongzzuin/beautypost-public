import { Hono } from 'hono'
import { eq, and, lte, gte, inArray } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { cronMiddleware } from '../middleware/auth.js'
import { sendEmail, trialExpiryEmail } from '../lib/email.js'
import { grantReward, checkWeeklyGoal } from '../lib/rewards.js'
import { publishFeed, publishCarousel } from '../lib/instagram.js'

const cron = new Hono()
cron.use('*', cronMiddleware)

// GET /api/cron/publish-scheduled — every 5 min, publish due posts
cron.get('/publish-scheduled', async (c) => {
  const db = getDb()
  const now = new Date()

  const due = await db
    .select()
    .from(schema.posts)
    .where(and(
      eq(schema.posts.status, 'scheduled'),
      lte(schema.posts.scheduledAt, now),
    ))
    .limit(20)

  const results = await Promise.allSettled(
    due.map(async (post) => {
      await db.update(schema.posts).set({ status: 'publishing' }).where(eq(schema.posts.id, post.id))

      try {
        let instagramMediaId: string | undefined

        if (post.channels.includes('instagram')) {
          const [channel] = await db
            .select()
            .from(schema.channelConnections)
            .where(and(
              eq(schema.channelConnections.userId, post.userId),
              eq(schema.channelConnections.channelType, 'instagram'),
              eq(schema.channelConnections.status, 'connected'),
            ))
            .limit(1)

          if (channel?.accessToken && channel?.instagramUserId) {
            const caption = post.caption + '\n\n' + post.hashtags.join(' ')
            const mediaRows = post.mediaIds.length
              ? await db.select().from(schema.media).where(inArray(schema.media.id, post.mediaIds))
              : []
            // Preserve original order
            const urlMap = new Map(mediaRows.map((m) => [m.id, m.processedUrl ?? m.originalUrl]))
            const mediaUrls = post.mediaIds.map((id) => urlMap.get(id)).filter(Boolean) as string[]

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
          publishedAt: now,
          instagramMediaId,
          updatedAt: now,
        }).where(eq(schema.posts.id, post.id))

        await db.insert(schema.notifications).values({
          userId: post.userId,
          event: 'post_published',
          title: '게시 완료! 🎉',
          body: '예약된 게시물이 성공적으로 올라갔어요.',
          route: `/posts/${post.id}`,
          params: {},
        })

        // Check rewards after publish
        await checkWeeklyGoal(db, post.userId)
      } catch (err) {
        await db.update(schema.posts).set({
          status: 'failed',
          failureReason: String(err),
          updatedAt: now,
        }).where(eq(schema.posts.id, post.id))

        await db.insert(schema.notifications).values({
          userId: post.userId,
          event: 'post_failed',
          title: '게시 실패 😢',
          body: '예약 게시에 실패했어요. 수동으로 다시 시도해주세요.',
          route: `/posts/${post.id}`,
          params: {},
        })
      }
    }),
  )

  return c.json({ data: { processed: due.length, results: results.map((r) => r.status) } })
})

// GET /api/cron/check-expiry — daily at 9am, send expiry warnings
cron.get('/check-expiry', async (c) => {
  const db = getDb()
  const now = new Date()

  const warningThresholds = [7, 3, 1]
  let notified = 0

  for (const days of warningThresholds) {
    const targetDate = new Date(now)
    targetDate.setDate(targetDate.getDate() + days)
    const dayStart = new Date(targetDate.setHours(0, 0, 0, 0))
    const dayEnd = new Date(targetDate.setHours(23, 59, 59, 999))

    const expiring = await db
      .select({ userId: schema.entitlements.userId, periodEnd: schema.entitlements.periodEnd })
      .from(schema.entitlements)
      .where(and(
        eq(schema.entitlements.status, 'active'),
        eq(schema.entitlements.plan, 'trial'),
        gte(schema.entitlements.periodEnd, dayStart),
        lte(schema.entitlements.periodEnd, dayEnd),
      ))

    for (const ent of expiring) {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, ent.userId))
        .limit(1)
      if (!user) continue

      const [profile] = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, ent.userId))
        .limit(1)

      await sendEmail(trialExpiryEmail(user.email, profile?.shopName ?? user.name, days))

      await db.insert(schema.notifications).values({
        userId: ent.userId,
        event: 'trial_expiring',
        title: `체험 기간 ${days}일 남았어요`,
        body: '구독을 시작하면 계속 이용할 수 있어요.',
        route: '/billing',
        params: {},
      })

      notified++
    }
  }

  // Expire overdue entitlements
  await db
    .update(schema.entitlements)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(schema.entitlements.status, 'active'), lte(schema.entitlements.periodEnd, now)))

  return c.json({ data: { notified } })
})

// GET /api/cron/reward-streak — every Monday, check 4-week streak
cron.get('/reward-streak', async (c) => {
  const db = getDb()
  const now = new Date()
  const fourWeeksAgo = new Date(now)
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)

  const activeUsers = await db
    .select({ userId: schema.entitlements.userId })
    .from(schema.entitlements)
    .where(and(
      eq(schema.entitlements.status, 'active'),
      gte(schema.entitlements.periodEnd, now),
    ))

  let rewarded = 0
  for (const { userId } of activeUsers) {
    const [profile] = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .limit(1)
    if (!profile) continue

    const goal = profile.weeklyPostGoal
    const posts = await db
      .select()
      .from(schema.posts)
      .where(and(
        eq(schema.posts.userId, userId),
        eq(schema.posts.status, 'published'),
        gte(schema.posts.publishedAt, fourWeeksAgo),
      ))

    // Check each of 4 weeks has >= goal posts
    const weeklyBuckets = [0, 0, 0, 0]
    for (const post of posts) {
      if (!post.publishedAt) continue
      const daysAgo = Math.floor((now.getTime() - post.publishedAt.getTime()) / 86400000)
      const week = Math.min(Math.floor(daysAgo / 7), 3)
      weeklyBuckets[week] = (weeklyBuckets[week] ?? 0) + 1
    }

    if (weeklyBuckets.every((count) => count >= goal)) {
      await grantReward(db, userId, 'streak_4weeks')
      rewarded++
    }
  }

  return c.json({ data: { checked: activeUsers.length, rewarded } })
})

export default cron
