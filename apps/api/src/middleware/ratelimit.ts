import type { Context, Next } from 'hono'
import { createMiddleware } from 'hono/factory'

// Lightweight in-process rate limiter (falls back gracefully if Redis unavailable)
// Uses Upstash Redis when UPSTASH_REDIS_REST_URL is set

interface RateLimit {
  requests: number
  windowSeconds: number
}

function makeKey(prefix: string, id: string) {
  return `rl:${prefix}:${id}`
}

async function checkLimit(key: string, limit: RateLimit): Promise<{ allowed: boolean; remaining: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  // Require a real https URL — treat empty/placeholder values as "no Redis"
  // and fail open so a missing/misconfigured cache never blocks requests.
  if (!url || !url.startsWith('http') || !token) {
    return { allowed: true, remaining: limit.requests - 1 }
  }

  try {
    const { Redis } = await import('@upstash/redis')
    const redis = new Redis({ url, token })

    const current = await redis.incr(key)
    if (current === 1) {
      await redis.expire(key, limit.windowSeconds)
    }

    const remaining = Math.max(0, limit.requests - current)
    return { allowed: current <= limit.requests, remaining }
  } catch {
    // Never let rate-limiting infra take down the endpoint.
    return { allowed: true, remaining: limit.requests - 1 }
  }
}

// 60 requests per minute for auth endpoints
export const authRateLimit = createMiddleware(async (c: Context, next: Next) => {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
  const { allowed } = await checkLimit(makeKey('auth', ip), { requests: 10, windowSeconds: 60 })
  if (!allowed) {
    return c.json({ code: 'RATE_LIMITED', message_ko: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' }, 429)
  }
  await next()
})

// 100 requests per minute per user for general API
export const apiRateLimit = createMiddleware(async (c: Context, next: Next) => {
  const userId = c.get('userId') as string | undefined
  if (!userId) return next()

  const { allowed, remaining } = await checkLimit(makeKey('api', userId), { requests: 100, windowSeconds: 60 })
  c.header('X-RateLimit-Remaining', String(remaining))
  if (!allowed) {
    return c.json({ code: 'RATE_LIMITED', message_ko: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' }, 429)
  }
  await next()
})

// 20 AI generations per user per day
export const aiRateLimit = createMiddleware(async (c: Context, next: Next) => {
  const userId = c.get('userId') as string | undefined
  if (!userId) return next()

  const today = new Date().toISOString().slice(0, 10)
  const { allowed, remaining } = await checkLimit(
    makeKey(`ai:${today}`, userId),
    { requests: 20, windowSeconds: 86400 },
  )
  c.header('X-AI-RateLimit-Remaining', String(remaining))
  if (!allowed) {
    return c.json({ code: 'AI_DAILY_LIMIT_EXCEEDED', message_ko: '오늘 생성 한도를 초과했어요. 내일 다시 시도해주세요.' }, 429)
  }
  await next()
})
