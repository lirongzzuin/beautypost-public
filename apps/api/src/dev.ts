import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env.local from monorepo root in development
function loadEnv() {
  const envPath = resolve(import.meta.dirname, '../../../.env.local')
  try {
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      let value = trimmed.slice(idx + 1).trim()
      // Strip surrounding quotes so KEY="" resolves to an empty string, not `""`.
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1)
      }
      if (key && !(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // .env.local not found — env vars must be set externally
  }
}

loadEnv()

import { serve } from '@hono/node-server'
import { isLocalDbUrl, openLocalDb } from './db/local.js'

// pnpm dev:local → DATABASE_URL=pglite:… : 운영 DB 대신 로컬 PGlite (마이그레이션 자동 적용)
if (isLocalDbUrl(process.env.DATABASE_URL)) {
  await openLocalDb(process.env.DATABASE_URL!)
  console.log(`로컬 DB: ${process.env.DATABASE_URL}`)
}
const { default: app } = await import('./app.js')

const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, () => {
  console.log(`API server running at http://localhost:${port}/api`)
})
