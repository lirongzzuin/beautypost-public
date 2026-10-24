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
  // Multi-select services (SERVICE_CATALOG keys) + free-text custom services.
  // `category` is kept for backward-compat (hashtags/stats) = first service.
  services: jsonb('services').$type<string[]>().notNull().default([]),
  customServices: jsonb('custom_services').$type<string[]>().notNull().default([]),
  tone: toneStyleEnum('tone').notNull().default('friendly'),
  weeklyPostGoal: integer('weekly_post_goal').notNull().default(3),
  prohibitedPhrases: jsonb('prohibited_phrases').$type<string[]>().notNull().default([]),
  customHashtags: jsonb('custom_hashtags').$type<string[]>().notNull().default([]),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Style Examples (caption few-shot personalization) ────────────────────────
// Caption text the shop "liked/saved" as a style reference. Only the text is
// stored; it is injected into the caption prompt as a few-shot style sample.
// Capped per user (see STYLE_EXAMPLE_LIMIT) to bound prompt size and cost.

export const styleExamples = pgTable('style_examples', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Brand profile (샵 단위 기본 스타일) ──────────────────────────────────────────
// 생성할 때 기본값: 업종·무드(+차이값)·브랜드 컬러·로고·예약 안내·말투 샘플.
// brand_preset 은 packages/preset 의 BrandPreset 형식 (스키마로 검증 후 저장).

export const brandProfiles = pgTable('brand_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  industry: text('industry'),
  brandPreset: jsonb('brand_preset').$type<Record<string, unknown>>(),
  bookingLabel: text('booking_label'),
  bookingUrl: text('booking_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Generations (게시글 초안 생성 기록 → 선택·수정 피드백) ──────────────────────

export const generations = pgTable('generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('caption'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  // 채널별 후보: { instagram: [...], blog: [...] }
  candidates: jsonb('candidates').$type<Record<string, unknown>>().notNull().default({}),
  // 원장님이 고른 후보 { instagram?: number, blog?: number } 와 직접 고친 최종본
  chosen: jsonb('chosen').$type<Record<string, number>>(),
  edited: jsonb('edited').$type<Record<string, string>>(),
  promptVersions: jsonb('prompt_versions').$type<Record<string, string>>().notNull().default({}),
  model: text('model'),
  postId: uuid('post_id'),
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
  // ── 프리셋 기반 생성 (docs/ARCHITECTURE.md) ──
  storageKey: text('storage_key'),
  mimeType: text('mime_type'),
  // 콘텐츠 목적 템플릿에서의 역할: before | after | process | detail | shop | owner | review | product | any
  role: text('role'),
  // 비전 분석 결과 (packages/caption MediaAnalysis). 사진당 1회, 캐시
  analysis: jsonb('analysis').$type<Record<string, unknown>>(),
  // 얼굴 게시 동의: unknown | granted(고객 동의 확인) | blurred(얼굴 가림) | not_needed(얼굴 없음)
  consent: text('consent').notNull().default('unknown'),
  consentAt: timestamp('consent_at'),
  // 얼굴 영역 [{x,y,w,h}] (0~1)
  faces: jsonb('faces').$type<{ x: number; y: number; w: number; h: number }[]>(),
  // 생성물이면 원본 미디어와 만든 방식: upload | photocraft | render | card
  origin: text('origin').notNull().default('upload'),
  parentId: uuid('parent_id'),
  formatId: text('format_id'),
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
  // ── 작업 큐 (apps/api/src/jobs). 상태 의미: pending=대기(재시도 대기 포함, run_after) · processing=임대 중 ·
  //    completed=성공 · failed=재시도 소진. 임대가 만료된 processing 은 다시 가져갈 수 있다 (작업자가 꺼져도 유실 없음)
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAfter: timestamp('run_after').notNull().defaultNow(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at'),
  idempotencyKey: text('idempotency_key').unique(),
  priority: integer('priority').notNull().default(100),
  progress: integer('progress').notNull().default(0),
  stage: text('stage'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
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
