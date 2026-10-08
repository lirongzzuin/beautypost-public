// Instagram Graph API adapter with mock mode until Meta app approval

const MOCK_MODE = !process.env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_MOCK === 'true'

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

export async function getOAuthUrl(state: string): Promise<string> {
  if (MOCK_MODE) return `${process.env.APP_URL}/mock-instagram-callback?state=${state}`
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
    scope: 'instagram_basic,instagram_content_publish,pages_read_engagement',
    response_type: 'code',
    state,
  })
  return `https://www.facebook.com/dialog/oauth?${params}`
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

  const res = await fetch('https://graph.facebook.com/v20.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
      code,
    }),
  })
  const data = await res.json() as { access_token: string; error?: { message: string } }
  if (data.error) throw new Error(data.error.message)

  const longLived = await exchangeForLongLived(data.access_token)
  const userInfo = await getUserInfo(longLived.accessToken)
  return { ...longLived, ...userInfo }
}

async function exchangeForLongLived(shortToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.INSTAGRAM_APP_ID}&client_secret=${process.env.INSTAGRAM_APP_SECRET}&fb_exchange_token=${shortToken}`,
  )
  const data = await res.json() as { access_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

async function getUserInfo(accessToken: string): Promise<{ userId: string; handle: string }> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/me/accounts?fields=instagram_business_account&access_token=${accessToken}`,
  )
  const data = await res.json() as { data: Array<{ instagram_business_account?: { id: string } }> }
  const igUserId = data.data[0]?.instagram_business_account?.id
  if (!igUserId) throw new Error('Instagram Business 계정이 연결되지 않았습니다')

  const profileRes = await fetch(
    `https://graph.facebook.com/v20.0/${igUserId}?fields=username&access_token=${accessToken}`,
  )
  const profile = await profileRes.json() as { username: string }
  return { userId: igUserId, handle: profile.username }
}

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

  const containerRes = await fetch(
    `https://graph.facebook.com/v20.0/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
    },
  )
  const container = await containerRes.json() as { id: string; error?: { message: string } }
  if (container.error) throw new Error(container.error.message)

  await waitForContainer(accessToken, container.id)

  const publishRes = await fetch(
    `https://graph.facebook.com/v20.0/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
    },
  )
  const published = await publishRes.json() as { id: string; error?: { message: string } }
  if (published.error) throw new Error(published.error.message)

  return { instagramMediaId: published.id }
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
    imageUrls.map(async (url) => {
      const res = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: accessToken }),
      })
      const data = await res.json() as { id: string }
      return data.id
    }),
  )

  const containerRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: accessToken }),
  })
  const container = await containerRes.json() as { id: string; error?: { message: string } }
  if (container.error) throw new Error(container.error.message)

  await waitForContainer(accessToken, container.id)

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  })
  const published = await publishRes.json() as { id: string; error?: { message: string } }
  if (published.error) throw new Error(published.error.message)
  return { instagramMediaId: published.id }
}

async function waitForContainer(accessToken: string, containerId: string, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${containerId}?fields=status_code&access_token=${accessToken}`,
    )
    const data = await res.json() as { status_code: string }
    if (data.status_code === 'FINISHED') return
    if (data.status_code === 'ERROR') throw new Error('Instagram container creation failed')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Instagram container timed out')
}
