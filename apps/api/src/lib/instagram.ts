// Instagram adapter — "Instagram API with Instagram Login" flow.
// (graph.instagram.com, scopes instagram_business_*). Mock mode runs the whole
// connect + publish flow end-to-end without a real Meta app until it is live.

const MOCK_MODE = !process.env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_MOCK === 'true'
const GRAPH = 'https://graph.instagram.com/v21.0'
const SCOPE = 'instagram_business_basic,instagram_business_content_publish'

export interface PublishResult {
  instagramMediaId: string
  permalink?: string
}

export interface InstagramToken {
  accessToken: string
  userId: string
  handle?: string
  expiresAt: Date
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

export async function getOAuthUrl(state: string): Promise<string> {
  // In mock mode, skip the Instagram dialog and jump straight to our own
  // callback with a fake code so the full connect flow completes.
  if (MOCK_MODE) {
    return `${process.env.APP_URL}/api/channels/instagram/callback?code=mock_code&state=${state}`
  }
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
    scope: SCOPE,
    response_type: 'code',
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${params}`
}

export async function exchangeCode(code: string): Promise<InstagramToken> {
  if (MOCK_MODE) {
    return {
      accessToken: `mock_token_${Date.now()}`,
      userId: 'mock_user_123',
      handle: 'mock_beauty_shop',
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
    }
  }

  // 1) Short-lived token (also returns the Instagram-scoped user id)
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
      code,
    }),
  })
  const short = await shortRes.json() as { access_token: string; user_id?: number; error_message?: string }
  if (!short.access_token) throw new Error(short.error_message ?? 'Instagram 토큰 교환 실패')

  // 2) Exchange for a long-lived token (~60 days)
  const longRes = await fetch(
    `${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${short.access_token}`,
  )
  const long = await longRes.json() as { access_token: string; expires_in: number }
  const accessToken = long.access_token ?? short.access_token
  const expiresAt = new Date(Date.now() + (long.expires_in ?? 60 * 24 * 60 * 60) * 1000)

  // 3) Profile (id + handle)
  const meRes = await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${accessToken}`)
  const me = await meRes.json() as { user_id?: string; username?: string }
  const userId = me.user_id ?? String(short.user_id ?? '')
  if (!userId) throw new Error('Instagram 사용자 정보를 가져오지 못했습니다')

  return { accessToken, userId, handle: me.username, expiresAt }
}

// ─── Publishing ──────────────────────────────────────────────────────────────

export async function publishFeed(
  accessToken: string,
  igUserId: string,
  imageUrl: string,
  caption: string,
): Promise<PublishResult> {
  if (MOCK_MODE) {
    console.log(`[MOCK INSTAGRAM] Publishing feed for user ${igUserId}`)
    return { instagramMediaId: `mock_media_${Date.now()}`, permalink: 'https://instagram.com/mock' }
  }

  const container = await createContainer(igUserId, accessToken, { image_url: imageUrl, caption })
  await waitForContainer(accessToken, igUserId, container)
  return { instagramMediaId: await publishContainer(igUserId, accessToken, container) }
}

export async function publishCarousel(
  accessToken: string,
  igUserId: string,
  imageUrls: string[],
  caption: string,
): Promise<PublishResult> {
  if (MOCK_MODE) {
    console.log(`[MOCK INSTAGRAM] Publishing carousel (${imageUrls.length} images)`)
    return { instagramMediaId: `mock_carousel_${Date.now()}` }
  }

  const childIds = await Promise.all(
    imageUrls.map((url) => createContainer(igUserId, accessToken, { image_url: url, is_carousel_item: true })),
  )
  const parent = await createContainer(igUserId, accessToken, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
  })
  await waitForContainer(accessToken, igUserId, parent)
  return { instagramMediaId: await publishContainer(igUserId, accessToken, parent) }
}

async function createContainer(
  igUserId: string,
  accessToken: string,
  fields: Record<string, string | boolean>,
): Promise<string> {
  const res = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields, access_token: accessToken }),
  })
  const data = await res.json() as { id?: string; error?: { message: string } }
  if (data.error) throw new Error(data.error.message)
  if (!data.id) throw new Error('Instagram 미디어 컨테이너 생성 실패')
  return data.id
}

async function publishContainer(igUserId: string, accessToken: string, creationId: string): Promise<string> {
  const res = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  })
  const data = await res.json() as { id?: string; error?: { message: string } }
  if (data.error) throw new Error(data.error.message)
  if (!data.id) throw new Error('Instagram 게시 실패')
  return data.id
}

async function waitForContainer(accessToken: string, _igUserId: string, containerId: string, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`)
    const data = await res.json() as { status_code?: string }
    if (data.status_code === 'FINISHED') return
    if (data.status_code === 'ERROR') throw new Error('Instagram 미디어 처리 실패')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Instagram 미디어 처리 시간 초과')
}
