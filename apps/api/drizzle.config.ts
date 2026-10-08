import type { Config } from 'drizzle-kit'

// Node.js v20.12+ built-in env loader — works with drizzle-kit's esbuild context
try {
  process.loadEnvFile(new URL('../../.env.local', import.meta.url))
} catch { /* ignored if file not found */ }

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
