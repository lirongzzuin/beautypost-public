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
      const value = trimmed.slice(idx + 1).trim()
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
import app from './app.js'

const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, () => {
  console.log(`API server running at http://localhost:${port}/api`)
})
