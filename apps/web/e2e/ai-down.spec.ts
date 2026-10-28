import { expect, test } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login } from './login'

// AI 를 쓸 수 없을 때(무료 등급 분당 한도·장애)의 원장님 흐름. AI 가 실패하도록 띄운 API 로만 돈다:
//   AI_PROVIDER=live AI_MODELS_VISION=gateway:none/none AI_MODELS_COPY=gateway:none/none AI_GATEWAY_API_KEY= pnpm --filter @beautypost/api dev:local
//   E2E_AI_DOWN=1 API_LOG=… pnpm --filter @beautypost/web e2e ai-down
// 기대: 사진 분석이 안 되면 얼굴이 나오는지 직접 묻고, 답하면 게시용 사진·영상은 만들어진다. 글은 다시 시도 안내.

const here = dirname(fileURLToPath(import.meta.url))
const MEDIA = process.env.E2E_MEDIA_DIR ?? resolve(here, '../../worker/.data/sample/sample-media')

test.skip(!process.env.E2E_AI_DOWN, 'AI 가 실패하도록 띄운 API 에서만 (E2E_AI_DOWN=1)')

test('AI 를 못 써도: 얼굴 여부를 물어보고 사진·영상은 만든다', async ({ page, request }) => {
  await login(page, request)
  await page.goto('/posts/create')
  await page.getByRole('button', { name: '반영구 눈썹' }).click()
  await page.getByRole('button', { name: /비포·애프터/ }).first().click()
  await page.getByRole('button', { name: '다음' }).click()

  const inputs = page.locator('input[type=file]')
  await inputs.nth(0).setInputFiles(`${MEDIA}/before1.jpg`)
  await inputs.nth(1).setInputFiles(`${MEDIA}/after1.jpg`)
  await expect(page.getByText('이 사진에 고객 얼굴이 나오나요?')).toHaveCount(2, { timeout: 30_000 })
  const next = page.getByRole('button', { name: '다음' })
  await expect(next).toBeDisabled()
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '얼굴 안 나와요' }).first().click()
  await expect(next).toBeEnabled()
  await next.click()

  await page.getByText('영상', { exact: true }).click()
  await page.getByRole('button', { name: '릴스 (9:16)' }).click()
  await page.getByRole('button', { name: '✨ 만들기' }).click()

  await expect(page.getByText(/AI 응답이 늦어지고|AI 사용량이 잠깐 몰렸어요/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('비포·애프터 · 피드 세로 (4:5)')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('video[controls]')).toBeVisible({ timeout: 2 * 60_000 })
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/ai-down.png`, fullPage: true })
})
