import { randomBytes } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { schema, type Db } from '../db/index.js'

// DB 테이블 기반 작업 큐 (docs/ARCHITECTURE.md 8-2).
//
// 상태: pending(대기·재시도 대기) → processing(임대 중) → completed | failed(재시도 소진)
// - 작업자는 claim 으로 하나를 임대하고 heartbeat 로 임대를 연장한다.
// - 작업자가 죽어 heartbeat 가 끊기면 lease_expires_at 이 지나고, 다음 claim 이 그 작업을 다시 가져간다 → 유실 없음.
// - 임대마다 새 토큰(lease_owner)을 발급한다. 임대가 넘어간 뒤 늦게 도착한 옛 작업자의 보고는 무시된다.
// - neon-http 는 대화형 트랜잭션이 없어서, 원자성이 필요한 부분은 SQL 한 문장으로 처리한다.

export type JobRow = typeof schema.jobs.$inferSelect
export type JobType = JobRow['type']

export const DEFAULT_LEASE_SEC = 120
const RETRY_BACKOFF_SEC = [30, 120, 600]

export interface EnqueueInput {
  type: JobType
  userId: string | null
  payload: Record<string, unknown>
  idempotencyKey?: string
  maxAttempts?: number
  priority?: number
}

/** 작업 등록. 같은 idempotencyKey 가 이미 있으면 새로 만들지 않고 기존 작업을 돌려준다. */
export async function enqueue(db: Db, input: EnqueueInput): Promise<JobRow> {
  const inserted = await db
    .insert(schema.jobs)
    .values({
      type: input.type,
      userId: input.userId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 3,
      priority: input.priority ?? 100,
    })
    .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
    .returning()
  if (inserted[0]) return inserted[0]
  const [existing] = await db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, input.idempotencyKey!)).limit(1)
  return existing!
}

function rowsOf(res: unknown): Record<string, unknown>[] {
  return ((res as { rows?: Record<string, unknown>[] }).rows ?? (res as Record<string, unknown>[])) as Record<string, unknown>[]
}

/** 대기 중이거나 임대가 만료된 작업 하나를 원자적으로 임대한다. 없으면 null. */
export async function claim(
  db: Db,
  workerId: string,
  opts: { types?: JobType[]; leaseSec?: number } = {},
): Promise<{ job: JobRow; leaseToken: string } | null> {
  const leaseSec = opts.leaseSec ?? DEFAULT_LEASE_SEC
  const types = opts.types?.length ? opts.types : null
  const leaseToken = `${workerId}/${randomBytes(6).toString('hex')}`

  // 임대가 만료됐는데 재시도도 다 쓴 작업은 실패로 정리 (작업자가 계속 죽는 작업)
  await db.execute(sql`
    UPDATE jobs SET status = 'failed', error = COALESCE(error, '작업자 응답 없음 (임대 만료)'),
      lease_owner = NULL, finished_at = now(), updated_at = now()
    WHERE status = 'processing' AND lease_expires_at < now() AND attempts >= max_attempts`)

  const res = await db.execute(sql`
    UPDATE jobs SET status = 'processing', lease_owner = ${leaseToken},
      lease_expires_at = now() + make_interval(secs => ${leaseSec}),
      attempts = attempts + 1, started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE ((status = 'pending' AND run_after <= now())
          OR (status = 'processing' AND lease_expires_at < now()))
        AND attempts < max_attempts
        ${types ? sql`AND type::text IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``}
      ORDER BY priority, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
    RETURNING id`)
  const id = rowsOf(res)[0]?.id as string | undefined
  if (!id) return null
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1)
  return job ? { job, leaseToken } : null
}

function owns(jobId: string, leaseToken: string) {
  return and(eq(schema.jobs.id, jobId), eq(schema.jobs.leaseOwner, leaseToken), eq(schema.jobs.status, 'processing'))
}

/** 임대 연장 + 진행률. false 면 임대를 잃었다 (작업을 멈춰야 함). */
export async function heartbeat(
  db: Db,
  jobId: string,
  leaseToken: string,
  p: { progress?: number; stage?: string; leaseSec?: number } = {},
): Promise<boolean> {
  const rows = await db
    .update(schema.jobs)
    .set({
      leaseExpiresAt: sql`now() + make_interval(secs => ${p.leaseSec ?? DEFAULT_LEASE_SEC})`,
      ...(p.progress !== undefined ? { progress: Math.max(0, Math.min(100, Math.round(p.progress))) } : {}),
      ...(p.stage !== undefined ? { stage: p.stage } : {}),
      updatedAt: new Date(),
    })
    .where(owns(jobId, leaseToken))
    .returning({ id: schema.jobs.id })
  return rows.length > 0
}

/** 완료 보고. 같은 임대로 두 번 보고해도 결과는 같다 (멱등). */
export async function complete(db: Db, jobId: string, leaseToken: string, result: Record<string, unknown>): Promise<boolean> {
  const rows = await db
    .update(schema.jobs)
    .set({ status: 'completed', result, progress: 100, stage: 'done', error: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(owns(jobId, leaseToken))
    .returning({ id: schema.jobs.id })
  if (rows.length) return true
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
  return job?.status === 'completed' && job.leaseOwner === leaseToken
}

/** 실패 보고. 재시도 가능하고 횟수가 남았으면 백오프 후 대기열로, 아니면 failed. */
export async function fail(
  db: Db,
  jobId: string,
  leaseToken: string,
  error: string,
  opts: { retryable?: boolean } = {},
): Promise<'retry' | 'failed' | 'not_owner'> {
  const [job] = await db.select().from(schema.jobs).where(owns(jobId, leaseToken)).limit(1)
  if (!job) return 'not_owner'
  const retry = (opts.retryable ?? true) && job.attempts < job.maxAttempts
  const backoff = RETRY_BACKOFF_SEC[Math.min(job.attempts - 1, RETRY_BACKOFF_SEC.length - 1)] ?? 600
  await db
    .update(schema.jobs)
    .set(
      retry
        ? { status: 'pending', error, leaseOwner: null, leaseExpiresAt: null, runAfter: new Date(Date.now() + backoff * 1000), updatedAt: new Date() }
        : { status: 'failed', error, leaseOwner: null, finishedAt: new Date(), updatedAt: new Date() },
    )
    .where(owns(jobId, leaseToken))
  return retry ? 'retry' : 'failed'
}

/** 작업자가 정상 종료할 때 임대를 돌려준다 (시도 횟수도 되돌림). */
export async function release(db: Db, jobId: string, leaseToken: string): Promise<boolean> {
  const rows = await db
    .update(schema.jobs)
    .set({ status: 'pending', leaseOwner: null, leaseExpiresAt: null, attempts: sql`GREATEST(attempts - 1, 0)`, stage: null, updatedAt: new Date() })
    .where(owns(jobId, leaseToken))
    .returning({ id: schema.jobs.id })
  return rows.length > 0
}

export async function getJob(db: Db, jobId: string): Promise<JobRow | null> {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
  return job ?? null
}
