import { expect, test, type Page } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from './login'

// 원장님 흐름: 로그인 → 만들기(목적 → 역할별 업로드 → 내 사진 스타일 미리보기 → 글·사진·영상) → 복사·저장 → 만든 영상 → 브랜드 설정
// 로그인은 개발 서버가 콘솔(API_LOG)에 찍는 매직링크로 한다 (RESEND_API_KEY 없음).

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = process.env.SHOTS_DIR
const MEDIA = process.env.E2E_MEDIA_DIR ?? resolve(here, '../../worker/.data/sample/sample-media')
const VIDEO = process.env.E2E_VIDEO ?? resolve(here, '../../../../filmcraft/tests/footage/test_portrait_01.mp4')

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

test('원장님 콘텐츠 만들기 전체 흐름', async ({ page, request }) => {
  await login(page, request)
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
  // 영상은 항상 고객 얼굴이 나오는지 묻는다 → 다음 버튼은 답하기 전까지 꺼져 있다
  await expect(page.getByText('이 영상에 고객 얼굴이 나오나요?')).toBeVisible({ timeout: 60_000 })
  const next = page.getByRole('button', { name: '다음' })
  await expect(next).toBeDisabled()
  await page.getByRole('button', { name: '얼굴 안 나와요' }).click()
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
  // 블로그 글은 탭을 열 때 만든다
  await page.getByRole('button', { name: '네이버 블로그' }).click()
  await expect(page.locator('textarea').first()).toHaveValue(/역삼 눈썹문신[\s\S]*\[사진 1\]/, { timeout: 30_000 })
  await page.getByRole('button', { name: '카카오톡' }).click()
  await expect(page.locator('textarea').first()).toHaveValue(/📍 뷰티룸/)
  await expect(page.getByText('비포·애프터 · 피드 세로 (4:5)')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /모두 저장/ })).toBeVisible()
  await shot(page, '05-results-drafts-photos')
  await expect(page.locator('video[controls]')).toBeVisible({ timeout: 4 * 60_000 })
  await expect(page.getByRole('button', { name: '⬇ 영상 저장' })).toBeVisible()
  await expect(page.getByText(/인스타그램 앱에서 인기 음악/)).toBeVisible()
  const src = await page.locator('video[controls]').getAttribute('src')
  const vid = await request.get(src!)
  expect(vid.headers()['content-type']).toBe('video/mp4')
  expect((await vid.body()).length).toBeGreaterThan(100_000)
  await shot(page, '06-results-video')
  if (SHOTS) {
    // 결과 화면은 안쪽 스크롤이라 패널을 따로 찍는다
    await page.locator('section', { has: page.getByRole('heading', { name: /게시용 사진/ }) }).screenshot({ path: `${SHOTS}/06b-photos.png` })
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
  await page.getByPlaceholder(/𝗿𝗲𝘀𝗲𝗿𝘃𝗮𝘁𝗶𝗼𝗻/).fill('예약은 카카오채널 #뷰티룸')
  await page.getByRole('button', { name: '3개' }).click()
  await page.getByPlaceholder(/my_beauty_shop/).fill('beauty_room')
  await expect(page.getByText('얼굴 가림(흐리게) 쓰기')).toBeVisible()
  await page.getByPlaceholder('내가 쓴 게시글을 붙여넣기').fill('오늘도 손끝까지 예쁘게 :)')
  await page.getByRole('button', { name: '샘플 추가' }).click()
  await expect(page.getByText('오늘도 손끝까지 예쁘게 :)')).toBeVisible()
  await shot(page, '08-brand')
  await page.getByRole('button', { name: '저장' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  // 다시 열면 저장한 값 (아이디는 @ 를 붙여 정리)
  await page.getByRole('link', { name: /브랜드 설정/ }).click()
  await expect(page.getByPlaceholder(/𝗿𝗲𝘀𝗲𝗿𝘃𝗮𝘁𝗶𝗼𝗻/)).toHaveValue('예약은 카카오채널 #뷰티룸')
  await expect(page.getByPlaceholder(/my_beauty_shop/)).toHaveValue('@beauty_room')
})
