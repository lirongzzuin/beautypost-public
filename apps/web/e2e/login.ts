import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// 로그인은 개발 서버가 콘솔(API_LOG)에 찍는 매직링크로 한다 (RESEND_API_KEY 없음). 온보딩은 API 로.

const API_LOG = process.env.API_LOG!

function tokens(email: string): string[] {
  return [...readFileSync(API_LOG, 'utf8').matchAll(new RegExp(`To: ${email}[\\s\\S]*?verify\\?token=([a-f0-9]+)`, 'g'))].map((m) => m[1]!)
}

async function magicToken(email: string, not?: string): Promise<string> {
  await expect.poll(() => tokens(email).filter((t) => t !== not).length, { timeout: 10_000 }).toBeGreaterThan(0)
  return tokens(email).at(-1)!
}

/** 새 원장님 계정으로 화면 로그인 → 대시보드 */
export async function login(page: Page, request: APIRequestContext): Promise<string> {
  const email = `ui${Date.now()}@test.kr`
  await request.post('/api/auth/magic-link', { data: { email } })
  const t0 = await magicToken(email)
  const v = await (await request.get(`/api/auth/verify?token=${t0}`)).json()
  const r = await request.post('/api/auth/onboarding', {
    headers: { Authorization: `Bearer ${v.data.accessToken}` },
    data: { shopName: '뷰티룸', region: '서울 강남구 역삼동', services: ['eyebrow_tattoo'], tone: 'friendly' },
  })
  expect(r.ok()).toBeTruthy()

  await page.goto('/auth/login')
  await page.getByPlaceholder('example@email.com').fill(email)
  await page.getByRole('button', { name: /링크|로그인|시작/ }).first().click()
  // 방금 요청한 링크 (온보딩용으로 쓴 것과 다른 새 토큰)
  await expect.poll(() => tokens(email).at(-1) !== t0, { timeout: 10_000 }).toBeTruthy()
  await page.goto(`/auth/verify?token=${await magicToken(email, t0)}`)
  await expect(page).toHaveURL(/\/$/)
  return email
}
