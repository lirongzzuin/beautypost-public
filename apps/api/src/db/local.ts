import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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

// PGlite 는 한 폴더를 한 프로세스만 열 수 있다. 둘이 동시에 쓰면 WAL 이 깨져 다시 열리지 않는다
// ("could not locate a valid checkpoint record"). 그래서 <폴더>.lock 에 pid 를 적고, 살아 있는 다른
// 프로세스가 잡고 있으면 바로 실패한다. 강제 종료로 남은 잠금은 pid 가 죽어 있으면 넘겨받는다.
function lockDataDir(dir: string) {
  const lock = `${dir}.lock`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      process.on('exit', () => {
        try {
          if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock)
        } catch {}
      })
      return
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    const pid = Number(readFileSync(lock, 'utf8'))
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(
        `로컬 DB(${dir})를 다른 프로세스(pid ${pid})가 쓰고 있습니다. 그 서버를 먼저 끄세요: kill ${pid}`,
      )
    }
    unlinkSync(lock)
  }
  throw new Error(`로컬 DB 잠금을 잡지 못했습니다: ${lock}`)
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// tsx watch 재시작·Ctrl+C 때 체크포인트를 남기고 닫는다 (닫지 않고 죽으면 다음 시작이 복구부터 한다)
function closeOnExit(client: PGlite) {
  const close = () => {
    client.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

export async function openLocalDb(url: string) {
  const target = url.slice('pglite:'.length)
  let client: PGlite
  if (target === 'memory' || target === '') {
    client = new PGlite()
  } else {
    const dir = resolve(target)
    mkdirSync(dirname(dir), { recursive: true })
    lockDataDir(dir)
    client = new PGlite(dir)
    closeOnExit(client)
  }
  // Neon 과 같게 UTC. timestamp(시간대 없음) 컬럼에 JS Date(UTC)와 SQL now() 를 함께 쓰므로 세션 시간대가 UTC 여야 한다
  await client.exec(`SET TIME ZONE 'UTC'`)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  setDb(db)
  return { db, client }
}
