// Runtime validation schemas (framework-agnostic, plain objects)
// Used for both client-side and server-side validation

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export function isPhone(v: string): boolean {
  return /^010-?\d{4}-?\d{4}$/.test(v)
}

export function validateMagicLinkRequest(body: unknown): { email: string } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.email !== 'string' || !isEmail(b.email)) return null
  return { email: b.email.toLowerCase().trim() }
}

export function validateOnboardingProfile(body: unknown): {
  shopName: string
  region: string
  category: string
  tone: string
} | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.shopName !== 'string' || b.shopName.trim().length === 0) return null
  if (typeof b.region !== 'string' || b.region.trim().length === 0) return null
  if (typeof b.category !== 'string') return null
  if (typeof b.tone !== 'string') return null
  return {
    shopName: b.shopName.trim(),
    region: b.region.trim(),
    category: b.category,
    tone: b.tone,
  }
}

export function validateCreatePost(body: unknown): {
  mediaIds: string[]
  theme: string
  keywords: string
  channels: string[]
  scheduledAt?: string
} | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.mediaIds) || b.mediaIds.length === 0) return null
  if (typeof b.theme !== 'string') return null
  if (typeof b.keywords !== 'string') return null
  if (!Array.isArray(b.channels) || b.channels.length === 0) return null
  return {
    mediaIds: b.mediaIds as string[],
    theme: b.theme,
    keywords: b.keywords,
    channels: b.channels as string[],
    scheduledAt: typeof b.scheduledAt === 'string' ? b.scheduledAt : undefined,
  }
}
