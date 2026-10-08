import { pgTable, text, integer, boolean, timestamp, jsonb, uuid, pgEnum } from 'drizzle-orm/pg-core'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const entitlementPlanEnum = pgEnum('entitlement_plan', ['trial', 'basic', 'pro', 'expired'])
export const entitlementStatusEnum = pgEnum('entitlement_status', ['active', 'expired', 'cancelled'])
export const entitlementSourceEnum = pgEnum('entitlement_source', ['manual', 'reward', 'web_pg', 'apple_iap', 'google_play'])
export const beautyCategoryEnum = pgEnum('beauty_category', ['eyebrow_tattoo', 'lash_perm', 'nail', 'tattoo', 'lip_blush', 'other'])
export const toneStyleEnum = pgEnum('tone_style', ['friendly', 'professional', 'trendy'])
export const postStatusEnum = pgEnum('post_status', ['draft', 'scheduled', 'publishing', 'published', 'failed'])
export const postTypeEnum = pgEnum('post_type', ['feed', 'carousel', 'reel'])
export const mediaTypeEnum = pgEnum('media_type', ['image', 'video'])
export const mediaStatusEnum = pgEnum('media_status', ['pending', 'processing', 'ready', 'error'])
export const channelTypeEnum = pgEnum('channel_type', ['instagram', 'naver_blog'])
export const channelStatusEnum = pgEnum('channel_status', ['connected', 'disconnected', 'expired', 'error'])
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed'])
export const jobTypeEnum = pgEnum('job_type', ['normalize_media', 'publish_post', 'render_reel', 'send_notification'])
export const userRoleEnum = pgEnum('user_role', ['user', 'admin'])
export const notificationEventEnum = pgEnum('notification_event', [
  'post_published', 'post_failed', 'reel_ready',
  'instagram_token_expiring', 'trial_expiring',
  'weekly_goal_achieved', 'reward_granted',
])

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default(''),
  avatarUrl: text('avatar_url'),
  role: userRoleEnum('role').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const magicLinks = pgTable('magic_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Profiles ────────────────────────────────────────────────────────────────

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  shopName: text('shop_name').notNull(),
  region: text('region').notNull(),
  category: beautyCategoryEnum('category').notNull().default('other'),
  tone: toneStyleEnum('tone').notNull().default('friendly'),
  weeklyPostGoal: integer('weekly_post_goal').notNull().default(3),
  prohibitedPhrases: jsonb('prohibited_phrases').$type<string[]>().notNull().default([]),
  customHashtags: jsonb('custom_hashtags').$type<string[]>().notNull().default([]),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Entitlements ─────────────────────────────────────────────────────────────

export const entitlements = pgTable('entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  plan: entitlementPlanEnum('plan').notNull().default('trial'),
  status: entitlementStatusEnum('status').notNull().default('active'),
  source: entitlementSourceEnum('source').notNull().default('manual'),
  periodEnd: timestamp('period_end').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const rewardLogs = pgTable('reward_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  daysGranted: integer('days_granted').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Channels ────────────────────────────────────────────────────────────────

export const channelConnections = pgTable('channel_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelType: channelTypeEnum('channel_type').notNull(),
  status: channelStatusEnum('status').notNull().default('disconnected'),
  handle: text('handle'),
  accessToken: text('access_token'),     // encrypted at rest
  refreshToken: text('refresh_token'),   // encrypted at rest
  tokenExpiresAt: timestamp('token_expires_at'),
  instagramUserId: text('instagram_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Media ───────────────────────────────────────────────────────────────────

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: mediaTypeEnum('type').notNull(),
  originalUrl: text('original_url').notNull(),
  processedUrl: text('processed_url'),
  thumbnailUrl: text('thumbnail_url'),
  width: integer('width'),
  height: integer('height'),
  durationSeconds: integer('duration_seconds'),
  sizeBytes: integer('size_bytes').notNull(),
  status: mediaStatusEnum('status').notNull().default('pending'),
  exifStripped: boolean('exif_stripped').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Posts ───────────────────────────────────────────────────────────────────

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: postTypeEnum('type').notNull().default('feed'),
  status: postStatusEnum('status').notNull().default('draft'),
  caption: text('caption').notNull().default(''),
  hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
  mediaIds: jsonb('media_ids').$type<string[]>().notNull().default([]),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  theme: text('theme'),
  keywords: text('keywords'),
  scheduledAt: timestamp('scheduled_at'),
  publishedAt: timestamp('published_at'),
  failureReason: text('failure_reason'),
  instagramMediaId: text('instagram_media_id'),
  blogTitle: text('blog_title'),
  blogBody: text('blog_body'),
  blogTags: jsonb('blog_tags').$type<string[]>().notNull().default([]),
  jobId: uuid('job_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Customers ───────────────────────────────────────────────────────────────

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  memo: text('memo'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  visitCount: integer('visit_count').notNull().default(1),
  lastVisitAt: timestamp('last_visit_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const customerMedia = pgTable('customer_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').references(() => posts.id),
  visitDate: timestamp('visit_date').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Notifications ───────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  event: notificationEventEnum('event').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  route: text('route'),
  params: jsonb('params').$type<Record<string, string>>(),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: jobTypeEnum('type').notNull(),
  status: jobStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb('result').$type<Record<string, unknown>>(),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Events (Analytics) ──────────────────────────────────────────────────────

export const analyticsEvents = pgTable('analytics_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  event: text('event').notNull(),
  properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
  platform: text('platform'),
  appVersion: text('app_version'),
  isInAppBrowser: boolean('is_in_app_browser'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Feedback ─────────────────────────────────────────────────────────────────

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  rating: integer('rating'),
  screenshotUrl: text('screenshot_url'),
  adminNote: text('admin_note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
