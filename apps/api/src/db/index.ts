import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

// 운영: Neon HTTP 드라이버. 로컬 개발·테스트: PGlite(프로세스 안의 Postgres)를 setDb() 로 주입한다
// (src/db/local.ts). PGlite 는 무거운 wasm 이라 운영 번들에 넣지 않으려고 여기서 import 하지 않는다.
// 두 드라이버 모두 drizzle 의 PgDatabase 라서 쿼리 코드는 같다. 단, 대화형 트랜잭션은 neon-http 에서
// 안 되므로 쓰지 않는다 (원자성이 필요하면 SQL 한 문장으로).

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!)
    _db = drizzle(sql, { schema })
  }
  return _db
}

/** 로컬 개발·테스트용 DB 주입 (src/db/local.ts). */
export function setDb(db: unknown): void {
  _db = db as Db
}

export { schema }
export type Db = ReturnType<typeof getDb>
