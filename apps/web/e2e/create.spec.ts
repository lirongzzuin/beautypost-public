import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 원장님 흐름: 로그인 → 만들기(목적 → 역할별 업로드 → 내 사진 스타일 미리보기 → 글·사진·영상) → 복사·저장 → 만든 영상 → 브랜드 설정
// 로그인은 개발 서버가 콘솔(API_LOG)에 찍는 매직링크로 한다 (RESEND_API_KEY 없음).

const here = dirname(fileURLToPath(import.meta.url))
const API_LOG = process.env.API_LOG!
const SHOTS = process.env.SHOTS_DIR
const MEDIA = process.env.E2E_MEDIA_DIR ?? resolve(here, '../../worker/.data/sample/sample-media')
const VIDEO = process.env.E2E_VIDEO ?? resolve(here, '../../../../filmcraft/tests/footage/test_portrait_01.mp4')

async function magicToken(page: Page, email: string): Promise<string> {
  await expect.poll(() => [...readFileSync(API_LOG, 'utf8').matchAll(new RegExp(`To: ${email}[\\s\\S]*?verify\\?token=([a-f0-9]+)`, 'g'))].length, { timeout: 10_000 }).toBeGreaterThan(0)
  return [...readFileSync(API_LOG, 'utf8').matchAll(new RegExp(`To: ${email}[\\s\\S]*?verify\\?token=([a-f0-9]+)`, 'g'))].at(-1)![1]!
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

test('원장님 콘텐츠 만들기 전체 흐름', async ({ page, request }) => {
  const email = `ui${Date.now()}@test.kr`

  // 온보딩은 API 로 (이 테스트의 대상이 아님)
  await request.post('/api/auth/magic-link', { data: { email } })
  const t0 = await magicToken(page, email)
  const v = await (await request.get(`/api/auth/verify?token=${t0}`)).json()
  const r = await request.post('/api/auth/onboarding', {
    headers: { Authorization: `Bearer ${v.data.accessToken}` },
    data: { shopName: '뷰티룸', region: '서울 강남구 역삼동', services: ['eyebrow_tattoo'], tone: 'friendly' },
  })
  expect(r.ok()).toBeTruthy()

  // 로그인 화면 → 매직링크
  await page.goto('/auth/login')
  await page.getByPlaceholder('example@email.com').fill(email)
  await page.getByRole('button', { name: /링크|로그인|시작/ }).first().click()
  const token = await magicToken(page, email).then(async (first) => {
    // 방금 요청한 링크 (온보딩용으로 쓴 것과 다른 새 토큰)
    await expect.poll(async () => (await magicToken(page, email)) !== t0).toBeTruthy()
    return magicToken(page, email)
  })
  await page.goto(`/auth/verify?token=${token}`)
  await expect(page).toHaveURL(/\/$/)
  await shot(page, '01-dashboard')

  // ① 무엇을 만들까요
  await page.goto('/posts/create')
  await expect(page.getByText('무엇을 만들까요?')).toBeVisible()
  await page.getByRole('button', { name: '반영구 눈썹' }).click()
  await page.getByRole('button', { name: /비포·애프터/ }).first().click()
  await shot(page, '02-purpose')
  await page.getByRole('button', { name: '다음' }).click()

  // ② 역할별 업로드 (비포 · 애프터 · 시술 과정 영상)
  await expect(page.getByText('비포 (시술 전)')).toBeVisible()
  const inputs = page.locator('input[type=file]')
  await inputs.nth(0).setInputFiles(`${MEDIA}/before1.jpg`)
  await inputs.nth(1).setInputFiles([`${MEDIA}/after1.jpg`, `${MEDIA}/after2.jpg`])
  await inputs.nth(2).setInputFiles(VIDEO)
  const next = page.getByRole('button', { name: '다음' })
  await expect(next).toBeEnabled({ timeout: 60_000 })
  await shot(page, '03-upload')
  await next.click()

  // ③ 스타일: 내 사진으로 미리보기 → 모던·블랙&골드 + 영상(릴스)
  await expect(page.locator('img[src^="data:image/jpeg"]').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /모던·블랙&골드/ }).click()
  await page.getByText('영상', { exact: true }).click()
  await page.getByRole('button', { name: '릴스 (9:16)' }).click()
  await page.getByPlaceholder(/리터치 이벤트/).fill('1:1 예약제, 리터치 안내')
  await shot(page, '04-style')
  await page.getByRole('button', { name: '✨ 만들기' }).click()

  // ④ 결과: 글 후보 · 복사 / 보정 사진 / 영상 진행 → 완성
  await expect(page.getByRole('button', { name: '📋 복사하기' }).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: '📋 복사하기' })).toHaveCount(3)
  await page.getByRole('button', { name: '📋 복사하기' }).first().click()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain('#역삼눈썹문신')
  await expect(page.getByRole('button', { name: '✓ 복사됨' })).toBeVisible()
  await page.getByRole('button', { name: '네이버 블로그' }).click()
  await expect(page.locator('textarea').first()).toHaveValue(/역삼 눈썹문신[\s\S]*\[사진 1\]/)
  await page.getByRole('button', { name: '카카오톡' }).click()
  await expect(page.locator('textarea').first()).toHaveValue(/📍 뷰티룸/)
  await expect(page.getByText('비포·애프터 · 피드 세로 (4:5)')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /모두 저장/ })).toBeVisible()
  await shot(page, '05-results-drafts-photos')
  await expect(page.locator('video[controls]')).toBeVisible({ timeout: 4 * 60_000 })
  await expect(page.getByRole('button', { name: '⬇ 영상 저장' })).toBeVisible()
  await expect(page.getByText(/인스타그램 앱에서 음악/)).toBeVisible()
  const src = await page.locator('video[controls]').getAttribute('src')
  const vid = await request.get(src!)
  expect(vid.headers()['content-type']).toBe('video/mp4')
  expect((await vid.body()).length).toBeGreaterThan(100_000)
  await shot(page, '06-results-video')
  if (SHOTS) {
    // 결과 화면은 안쪽 스크롤이라 패널을 따로 찍는다
    await page.locator('section', { has: page.getByRole('heading', { name: /보정 사진/ }) }).screenshot({ path: `${SHOTS}/06b-photos.png` })
    await page.locator('section', { has: page.getByRole('heading', { name: /영상/ }) }).screenshot({ path: `${SHOTS}/06c-video.png` })
  }

  // 게시물로 저장 → 목록
  await page.getByRole('button', { name: '게시물로 저장' }).click()
  await expect(page).toHaveURL(/\/posts$/)

  // 만든 영상 · 브랜드 설정
  await page.goto('/library')
  await expect(page.locator('video[controls]').first()).toBeVisible()
  await shot(page, '07-library')
  await page.goto('/settings')
  await expect(page.getByText('채널 연결 관리')).toHaveCount(0) // 인스타 연동 보류 (기능 스위치 꺼짐)
  await page.getByText(/브랜드 설정/).click()
  await page.getByRole('button', { name: '네일아트' }).click()
  await page.getByPlaceholder(/예약은 프로필 링크/).fill('카톡 채널로 예약')
  await page.getByPlaceholder('내가 쓴 게시글을 붙여넣기').fill('오늘도 손끝까지 예쁘게 :)')
  await page.getByRole('button', { name: '샘플 추가' }).click()
  await expect(page.getByText('오늘도 손끝까지 예쁘게 :)')).toBeVisible()
  await shot(page, '08-brand')
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  const brand = await page.evaluate(async () => (await fetch('/api/config')).ok)
  expect(brand).toBeTruthy()
})
