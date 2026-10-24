import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { openLocalDb } from '../src/db/local.js'
import type { Db } from '../src/db/index.js'
import { claim, complete, enqueue, fail, heartbeat, release, getJob } from '../src/jobs/queue.js'

let db: Db

beforeAll(async () => {
  db = (await openLocalDb('pglite:memory')).db as unknown as Db
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM jobs`)
})

const job = (key?: string) => enqueue(db, { type: 'render_reel', userId: null, payload: { n: 1 }, idempotencyKey: key })

async function expireLease(id: string) {
  await db.execute(sql`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = ${id}`)
}

describe('작업 큐', () => {
  it('등록 → 임대 → 완료', async () => {
    const j = await job()
    const c = await claim(db, 'w1')
    expect(c?.job.id).toBe(j.id)
    expect(c?.job.status).toBe('processing')
    expect(c?.job.attempts).toBe(1)
    expect(await claim(db, 'w2')).toBeNull() // 같은 작업을 두 작업자가 가져가지 않음
    expect(await complete(db, j.id, c!.leaseToken, { url: 'x' })).toBe('completed')
    expect(await complete(db, j.id, c!.leaseToken, { url: 'x' })).toBe('already') // 멱등 (후속 처리는 한 번만)
    expect((await getJob(db, j.id))?.status).toBe('completed')
  })

  it('같은 idempotencyKey 는 한 번만 등록', async () => {
    const a = await job('k1')
    const b = await job('k1')
    expect(b.id).toBe(a.id)
  })

  it('작업자가 죽으면(임대 만료) 다른 작업자가 이어받고, 옛 작업자의 보고는 무시', async () => {
    const j = await job()
    const first = await claim(db, 'w1')
    await expireLease(j.id)
    const second = await claim(db, 'w2')
    expect(second?.job.id).toBe(j.id)
    expect(second?.job.attempts).toBe(2)
    expect(await heartbeat(db, j.id, first!.leaseToken)).toBe(false)
    expect(await complete(db, j.id, first!.leaseToken, {})).toBe('not_owner')
    expect(await complete(db, j.id, second!.leaseToken, { ok: 1 })).toBe('completed')
  })

  it('하트비트가 임대를 연장하고 진행률을 남긴다', async () => {
    const j = await job()
    const c = await claim(db, 'w1', { leaseSec: 1 })
    expect(await heartbeat(db, j.id, c!.leaseToken, { progress: 42.4, stage: 'render', leaseSec: 300 })).toBe(true)
    const row = await getJob(db, j.id)
    expect(row?.progress).toBe(42)
    expect(row?.stage).toBe('render')
    expect(row!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 200_000)
  })

  it('실패하면 백오프 후 재시도, 횟수를 다 쓰면 failed', async () => {
    const j = await enqueue(db, { type: 'render_reel', userId: null, payload: {}, maxAttempts: 2 })
    const c1 = await claim(db, 'w1')
    expect(await fail(db, j.id, c1!.leaseToken, 'boom')).toBe('retry')
    expect(await claim(db, 'w1')).toBeNull() // 백오프 중
    await db.execute(sql`UPDATE jobs SET run_after = now() WHERE id = ${j.id}`)
    const c2 = await claim(db, 'w1')
    expect(c2?.job.attempts).toBe(2)
    expect(await fail(db, j.id, c2!.leaseToken, 'boom again')).toBe('failed')
    expect((await getJob(db, j.id))?.status).toBe('failed')
  })

  it('재시도를 다 쓴 작업의 임대가 만료되면 failed 로 정리', async () => {
    const j = await enqueue(db, { type: 'render_reel', userId: null, payload: {}, maxAttempts: 1 })
    await claim(db, 'w1')
    await expireLease(j.id)
    expect(await claim(db, 'w2')).toBeNull()
    expect((await getJob(db, j.id))?.status).toBe('failed')
  })

  it('정상 종료 시 임대 반납 → 시도 횟수 되돌리고 바로 다시 가져갈 수 있음', async () => {
    const j = await job()
    const c = await claim(db, 'w1')
    expect(await release(db, j.id, c!.leaseToken)).toBe(true)
    const again = await claim(db, 'w2')
    expect(again?.job.attempts).toBe(1)
  })

  it('작업 종류로 걸러서 가져간다', async () => {
    await job()
    expect(await claim(db, 'w1', { types: ['normalize_media'] })).toBeNull()
    expect(await claim(db, 'w1', { types: ['render_reel'] })).not.toBeNull()
  })
})

describe('refresh 토큰', () => {
  it('같은 사용자가 같은 초에 두 번 로그인해도 토큰이 다르다 (unique 충돌 방지)', async () => {
    process.env.JWT_REFRESH_SECRET ??= 'x'.repeat(40)
    const { signRefreshToken } = await import('../src/lib/jwt.js')
    const [a, b] = await Promise.all([signRefreshToken('u1'), signRefreshToken('u1')])
    expect(a).not.toBe(b)
  })
})
