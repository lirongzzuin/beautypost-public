import { eq, and } from 'drizzle-orm'
import type { Db } from '../db/index.js'
import { schema } from '../db/index.js'
import { REWARD_CONFIG, type RewardEventType } from '@beautypost/shared'

const MAX_REWARD_DAYS_PER_MONTH = 30

export async function grantReward(db: Db, userId: string, eventType: RewardEventType): Promise<void> {
  const config = REWARD_CONFIG[eventType]
  if (!config) return

  // Idempotency: check if one-time rewards already granted
  const onceEvents: RewardEventType[] = ['onboarding_complete', 'instagram_connect', 'first_post']
  if (onceEvents.includes(eventType)) {
    const existing = await db
      .select()
      .from(schema.rewardLogs)
      .where(and(eq(schema.rewardLogs.userId, userId), eq(schema.rewardLogs.eventType, eventType)))
      .limit(1)
    if (existing.length > 0) return
  }

  // Cap reward per month
  const monthAgo = new Date()
  monthAgo.setMonth(monthAgo.getMonth() - 1)
  const recentRewards = await db
    .select()
    .from(schema.rewardLogs)
    .where(eq(schema.rewardLogs.userId, userId))
  const recentDays = recentRewards
    .filter((r) => r.createdAt > monthAgo)
    .reduce((sum, r) => sum + r.daysGranted, 0)
  if (recentDays >= MAX_REWARD_DAYS_PER_MONTH) return

  const daysToGrant = Math.min(config.daysGranted, MAX_REWARD_DAYS_PER_MONTH - recentDays)

  // Extend entitlement
  const [ent] = await db
    .select()
    .from(schema.entitlements)
    .where(eq(schema.entitlements.userId, userId))
    .limit(1)
  if (!ent) return

  const currentEnd = ent.periodEnd > new Date() ? ent.periodEnd : new Date()
  const newEnd = new Date(currentEnd)
  newEnd.setDate(newEnd.getDate() + daysToGrant)

  await db
    .update(schema.entitlements)
    .set({ periodEnd: newEnd, updatedAt: new Date() })
    .where(eq(schema.entitlements.userId, userId))

  await db.insert(schema.rewardLogs).values({
    userId,
    eventType,
    daysGranted: daysToGrant,
    message: config.message,
  })

  // Create in-app notification
  await db.insert(schema.notifications).values({
    userId,
    event: 'reward_granted',
    title: '🎁 사용 기간 연장!',
    body: config.message,
    route: '/dashboard',
    params: {},
  })
}

export async function checkWeeklyGoal(db: Db, userId: string): Promise<void> {
  const profile = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1)
  if (!profile[0]) return

  const goal = profile[0].weeklyPostGoal
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const published = await db
    .select()
    .from(schema.posts)
    .where(and(
      eq(schema.posts.userId, userId),
      eq(schema.posts.status, 'published'),
    ))
  const thisWeek = published.filter((p) => p.publishedAt && p.publishedAt > weekAgo)
  if (thisWeek.length >= goal) {
    await grantReward(db, userId, 'weekly_goal_met')
  }
}
