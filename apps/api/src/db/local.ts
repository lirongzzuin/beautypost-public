import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema.js'
import { setDb } from './index.js'

// 로컬 개발·테스트용 Postgres (PGlite). 운영 Neon DB 를 건드리지 않고 전체 흐름을 돌려 볼 수 있다.
//   DATABASE_URL=pglite:.data/pglite   → 디스크에 저장 (pnpm dev:local)
//   DATABASE_URL=pglite:memory         → 메모리 (테스트)

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations')

export function isLocalDbUrl(url: string | undefined): boolean {
  return !!url && url.startsWith('pglite:')
}

export async function openLocalDb(url: string) {
  const target = url.slice('pglite:'.length)
  let client: PGlite
  if (target === 'memory' || target === '') {
    client = new PGlite()
  } else {
    const dir = resolve(target)
    mkdirSync(dirname(dir), { recursive: true })
    client = new PGlite(dir)
  }
  // Neon 과 같게 UTC. timestamp(시간대 없음) 컬럼에 JS Date(UTC)와 SQL now() 를 함께 쓰므로 세션 시간대가 UTC 여야 한다
  await client.exec(`SET TIME ZONE 'UTC'`)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  setDb(db)
  return { db, client }
}
