import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { getDb, schema } from '../db/index.js'
import { claim, complete, fail, failExpired, getJob, heartbeat, release } from '../jobs/queue.js'
import { eq } from 'drizzle-orm'
import { getStorage, makeKey } from '../storage/index.js'
import { ApiError } from '../services/errors.js'

// 렌더 작업자 전용 (RENDER_WORKER_TOKEN). 작업자는 DB 대신 이 API 로 작업을 가져가고 결과를 보고한다.
const worker = new Hono()

worker.use('*', async (c, next) => {
  const want = process.env.RENDER_WORKER_TOKEN
  if (!want) return c.json({ code: 'WORKER_DISABLED', message_ko: '렌더 작업자가 설정되지 않았어요.' }, 503)
  const got = (c.req.header('Authorization') ?? '').replace(/^Bearer /, '')
  const a = Buffer.from(got)
  const b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ code: 'AUTH_FORBIDDEN', message_ko: '접근 권한이 없어요.' }, 403)
  await next()
})

const Lease = z.object({ leaseToken: z.string().min(1) })
function body<T>(s: z.ZodType<T>, raw: unknown): T {
  const r = s.safeParse(raw)
  if (!r.success) throw new ApiError(400, 'VALIDATION_ERROR', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}
const lost = () => new ApiError(409, 'LEASE_LOST', '이 작업의 임대가 끝났어요 (다른 작업자가 가져갔거나 만료).')

worker.post('/claim', async (c) => {
  const b = body(z.object({ workerId: z.string().min(1).max(100), leaseSec: z.number().int().min(30).max(900).optional() }), await c.req.json().catch(() => null))
  const db = getDb()
  // 작업자가 계속 죽어 재시도를 다 쓴 작업은 실패 처리하고 원장님께 알린다
  for (const dead of await failExpired(db)) {
    if (dead.userId) await notifyFailed(db, dead.userId, dead.id)
  }
  const got = await claim(db, b.workerId, { types: ['render_reel'], leaseSec: b.leaseSec })
  if (!got) return c.body(null, 204)
  const { job, leaseToken } = got
  return c.json({ data: { id: job.id, type: job.type, attempts: job.attempts, maxAttempts: job.maxAttempts, payload: job.payload, leaseToken } })
})

worker.post('/jobs/:id/heartbeat', async (c) => {
  const b = body(Lease.extend({ progress: z.number().optional(), stage: z.string().max(40).optional(), leaseSec: z.number().int().min(30).max(900).optional() }), await c.req.json().catch(() => null))
  if (!(await heartbeat(getDb(), c.req.param('id'), b.leaseToken, b))) throw lost()
  return c.json({ data: { ok: true } })
})

worker.post('/jobs/:id/upload-ticket', async (c) => {
  const b = body(Lease.extend({ name: z.string().regex(/^[\w.-]{1,60}$/), contentType: z.enum(['video/mp4', 'image/jpeg', 'image/png']), size: z.number().int().positive() }), await c.req.json().catch(() => null))
  const db = getDb()
  const job = await getJob(db, c.req.param('id'))
  if (!job || job.leaseOwner !== b.leaseToken || job.status !== 'processing') throw lost()
  // 재시도마다 다른 경로 → 이전 시도의 결과를 덮지 않는다
  const key = makeKey('renders', job.userId ?? 'system', `${job.id}-${job.attempts}-${b.name}`)
  return c.json({ data: await getStorage().createUploadTicket(key, { contentType: b.contentType, maxBytes: 500 * 1024 * 1024 }) })
})

const Output = z.object({ key: z.string(), url: z.string() })

worker.post('/jobs/:id/complete', async (c) => {
  const b = body(Lease.extend({
    result: z.object({
      video: Output, cover: Output, width: z.number().int(), height: z.number().int(), duration: z.number(),
      qa: z.array(z.string()).default([]), warnings: z.array(z.string()).default([]),
    }),
  }), await c.req.json().catch(() => null))
  const db = getDb()
  const job = await getJob(db, c.req.param('id'))
  if (!job || job.leaseOwner !== b.leaseToken) throw lost()
  const storage = getStorage()
  const prefix = `renders/${job.userId ?? 'system'}/`
  for (const o of [b.result.video, b.result.cover]) {
    if (!o.key.startsWith(prefix) || storage.keyFromUrl(o.url) !== o.key || !(await storage.exists(o.url))) {
      throw new ApiError(400, 'VALIDATION_ERROR', '결과 파일 경로가 올바르지 않아요.')
    }
  }
  // 완료 전환(원자적)을 먼저 → 이번 호출이 완료시킨 경우에만 영상 등록·알림 (중복·고아 방지)
  const state = await complete(db, job.id, b.leaseToken, { ...b.result })
  if (state === 'not_owner') throw lost()
  if (state === 'completed' && job.userId) {
    const payload = job.payload as { format?: { id?: string } }
    const [v] = await db
      .insert(schema.media)
      .values({
        userId: job.userId, type: 'video', originalUrl: b.result.video.url, storageKey: b.result.video.key, mimeType: 'video/mp4',
        thumbnailUrl: b.result.cover.url, width: b.result.width, height: b.result.height, durationSeconds: Math.round(b.result.duration),
        sizeBytes: 0, status: 'ready', origin: 'render', formatId: payload.format?.id ?? null, consent: 'granted',
      })
      .returning()
    await db.update(schema.jobs).set({ result: { ...b.result, videoMediaId: v!.id } }).where(eq(schema.jobs.id, job.id))
    await db.insert(schema.notifications).values({
      userId: job.userId, event: 'reel_ready', title: '영상이 완성됐어요 🎬', body: '저장해서 인스타그램에 바로 올려 보세요.',
      route: '/library', params: { jobId: job.id },
    })
  }
  return c.json({ data: { ok: true } })
})

worker.post('/jobs/:id/fail', async (c) => {
  const b = body(Lease.extend({ error: z.string().max(4000), retryable: z.boolean().default(true) }), await c.req.json().catch(() => null))
  const db = getDb()
  const job = await getJob(db, c.req.param('id'))
  const r = await fail(db, c.req.param('id'), b.leaseToken, b.error, { retryable: b.retryable })
  if (r === 'not_owner') throw lost()
  if (r === 'failed' && job?.userId) await notifyFailed(db, job.userId, job.id)
  return c.json({ data: { result: r } })
})

worker.post('/jobs/:id/release', async (c) => {
  const b = body(Lease, await c.req.json().catch(() => null))
  if (!(await release(getDb(), c.req.param('id'), b.leaseToken))) throw lost()
  return c.json({ data: { ok: true } })
})

export default worker

async function notifyFailed(db: ReturnType<typeof getDb>, userId: string, jobId: string) {
  await db.insert(schema.notifications).values({
    userId, event: 'render_failed', title: '영상을 만들지 못했어요', body: '사진·영상을 바꿔서 다시 시도해 주세요.',
    route: '/library', params: { jobId },
  })
}
