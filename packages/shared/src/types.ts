// ─── Auth ────────────────────────────────────────────────────────────────────

export type ClientType = 'web' | 'ios' | 'android'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface AuthUser {
  id: string
  email: string
  name: string
  shopName?: string
  avatarUrl?: string
  role: 'user' | 'admin'
  entitlement: Entitlement
}

// ─── Entitlement / Subscription ─────────────────────────────────────────────

export type EntitlementPlan = 'trial' | 'basic' | 'pro' | 'expired'
export type EntitlementSource = 'manual' | 'reward' | 'web_pg' | 'apple_iap' | 'google_play'
export type EntitlementStatus = 'active' | 'expired' | 'cancelled'

export interface Entitlement {
  plan: EntitlementPlan
  status: EntitlementStatus
  source: EntitlementSource
  periodEnd: string // ISO date
  trialDaysLeft?: number
}

// ─── Reward ───────────────────────────────────────────────────────────────────

export type RewardEventType =
  | 'onboarding_complete'
  | 'instagram_connect'
  | 'first_post'
  | 'weekly_goal_met'
  | 'streak_4weeks'

export interface RewardEvent {
  type: RewardEventType
  daysGranted: number
  message: string
}

export const REWARD_CONFIG: Record<RewardEventType, RewardEvent> = {
  onboarding_complete: { type: 'onboarding_complete', daysGranted: 2, message: '온보딩 완료! 2일 추가됩니다 🎉' },
  instagram_connect: { type: 'instagram_connect', daysGranted: 3, message: '인스타 연동 완료! 3일 추가됩니다 📸' },
  first_post: { type: 'first_post', daysGranted: 5, message: '첫 게시 완료! 5일 추가됩니다 🚀' },
  weekly_goal_met: { type: 'weekly_goal_met', daysGranted: 3, message: '이번 주 목표 달성! 3일 추가됩니다 👏' },
  streak_4weeks: { type: 'streak_4weeks', daysGranted: 14, message: '4주 연속 달성! 14일 보너스 🏆' },
}

// ─── User Profile ────────────────────────────────────────────────────────────

export type BeautyCategory =
  | 'eyebrow_tattoo'
  | 'lash_perm'
  | 'nail'
  | 'tattoo'
  | 'lip_blush'
  | 'other'

export type ToneStyle = 'friendly' | 'professional' | 'trendy'

export interface UserProfile {
  id: string
  userId: string
  shopName: string
  region: string
  category: BeautyCategory
  tone: ToneStyle
  instagramHandle?: string
  weeklyPostGoal: number
  createdAt: string
  updatedAt: string
}

// ─── Channel ─────────────────────────────────────────────────────────────────

export type ChannelType = 'instagram' | 'naver_blog'

export interface ChannelConnection {
  id: string
  userId: string
  channelType: ChannelType
  status: 'connected' | 'disconnected' | 'expired' | 'error'
  handle?: string
  expiresAt?: string
}

// ─── Post ────────────────────────────────────────────────────────────────────

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed'
export type PostType = 'feed' | 'carousel' | 'reel'

export interface Post {
  id: string
  userId: string
  type: PostType
  status: PostStatus
  caption: string
  hashtags: string[]
  mediaIds: string[]
  scheduledAt?: string
  publishedAt?: string
  failureReason?: string
  channels: ChannelType[]
  instagramMediaId?: string
  jobId?: string
  blogDraft?: BlogDraft
  createdAt: string
  updatedAt: string
}

export interface BlogDraft {
  title: string
  body: string
  tags: string[]
}

// ─── Media ───────────────────────────────────────────────────────────────────

export type MediaType = 'image' | 'video'

export interface Media {
  id: string
  userId: string
  type: MediaType
  originalUrl: string
  processedUrl?: string
  thumbnailUrl?: string
  width?: number
  height?: number
  durationSeconds?: number
  sizeBytes: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  createdAt: string
}

// ─── Upload Session ──────────────────────────────────────────────────────────

export interface UploadSession {
  sessionId: string
  files: UploadFileSession[]
  expiresAt: string
}

export interface UploadFileSession {
  fileId: string
  uploadUrl: string
  fields?: Record<string, string>
  expiresAt: string
}

// ─── Customer ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string
  userId: string
  name: string
  phone?: string
  memo?: string
  tags: string[]
  visitCount: number
  lastVisitAt?: string
  createdAt: string
}

// ─── Notification ────────────────────────────────────────────────────────────

export type NotificationEvent =
  | 'post_published'
  | 'post_failed'
  | 'reel_ready'
  | 'instagram_token_expiring'
  | 'trial_expiring'
  | 'weekly_goal_achieved'
  | 'reward_granted'

export interface Notification {
  id: string
  userId: string
  event: NotificationEvent
  title: string
  body: string
  route?: string
  params?: Record<string, string>
  readAt?: string
  createdAt: string
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type JobType = 'normalize_media' | 'publish_post' | 'render_reel' | 'send_notification'

export interface Job {
  id: string
  type: JobType
  status: JobStatus
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  attempts: number
  createdAt: string
  updatedAt: string
}

// ─── App Config ──────────────────────────────────────────────────────────────

export interface AppConfig {
  minSupportedVersion: string
  latestVersion: string
  maintenanceNotice?: string
  featureFlags: Record<string, boolean>
  serverTime: string
}

// ─── Weekly Stats ─────────────────────────────────────────────────────────────

export interface WeeklyStats {
  goal: number
  achieved: number
  days: { date: string; posted: boolean }[]
  currentStreak: number
}

// ─── API Response ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T
  meta?: Record<string, unknown>
}

export interface ApiError {
  code: string
  message_ko: string
  retryable: boolean
  action?: string
}
