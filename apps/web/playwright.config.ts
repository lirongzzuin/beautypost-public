import { defineConfig, devices } from '@playwright/test'

// 화면 E2E (실제 API·렌더 작업자와 함께). 실행 방법은 README "화면 E2E 테스트"
//   1) pnpm --filter @beautypost/api dev:local   2) pnpm --filter @beautypost/worker start   3) pnpm --filter @beautypost/web dev
//   4) API_LOG=<API 로그 파일> pnpm --filter @beautypost/web e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 5 * 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
})
