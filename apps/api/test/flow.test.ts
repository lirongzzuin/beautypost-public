import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createAiClient, type MockResponder } from '@beautypost/ai'
import { mockResponder } from '@beautypost/caption'

// 전체 흐름 통합 테스트: 실제 Hono 앱 + PGlite(메모리) + 로컬 저장소 + 목 AI.
// 업로드 → 역할·동의 → 게시글 초안 → 사진 보정 → 영상 작업 등록 → 작업자 임대·업로드·완료 → 결과 조회

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234'
process.env.JWT_REFRESH_SECRET = 'test-refresh-test-refresh-test-refresh-12'
process.env.STORAGE = 'local'
process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'bp-storage-'))
process.env.RENDER_WORKER_TOKEN = 'worker-token'
delete process.env.UPSTASH_REDIS_REST_URL

type App = { fetch: (r: Request) => Promise<Response> }
let app: App
let token = ''
let faceMode = false

// 목 모델: 'face' 라는 역할의 사진에는 얼굴이 있다고 답한다
const mock: MockResponder = (req) => {
  const r = mockResponder(req) as Record<string, unknown>
  if (req.task === 'media-analysis' && faceMode) return { ...r, faces: [{ x: 0.3, y: 0.2, w: 0.2, h: 0.2 }] }
  return r
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, ...headers } }
  if (body instanceof FormData || body instanceof Uint8Array) init.body = body as BodyInit
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  const res = await app.fetch(new Request(`http://local/api${path}`, init))
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function jpeg(color: string, w = 900, h = 1100): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer())
}

async function uploadPhoto(color: string, role: string) {
  const fd = new FormData()
  fd.append('file', new File([await jpeg(color)], 'p.jpg', { type: 'image/jpeg' }))
  const up = await call('POST', '/upload/file', fd)
  expect(up.status).toBe(200)
  const id = up.json.data.mediaId as string
  expect((await call('PATCH', `/media/${id}`, { role })).status).toBe(200)
  return id
}

beforeAll(async () => {
  const { openLocalDb } = await import('../src/db/local.js')
  const { db } = await openLocalDb('pglite:memory')
  const { setAi } = await import('../src/services/ai.js')
  setAi(createAiClient({ mock }))
  app = (await import('../src/app.js')).default as unknown as App
  const { schema } = await import('../src/db/index.js')
  const { signAccessToken } = await import('../src/lib/jwt.js')
  const [u] = await db.insert(schema.users).values({ email: 'owner@test.kr', name: 'owner' }).returning()
  await db.insert(schema.entitlements).values({ userId: u!.id, periodEnd: new Date(Date.now() + 86400_000) })
  await db.insert(schema.profiles).values({ userId: u!.id, shopName: '뷰티룸', region: '서울 강남구 역삼동', category: 'eyebrow_tattoo', services: ['eyebrow_tattoo'] })
  token = await signAccessToken({ sub: u!.id, email: u!.email, role: 'user' })
})

describe('프리셋·브랜드', () => {
  it('프리셋 목록과 미리보기 이미지', async () => {
    const r = await call('GET', '/presets')
    expect(r.json.data.moods).toHaveLength(5)
    expect(r.json.data.industries.map((i: { id: string }) => i.id)).toContain('hair')
    const thumb = await app.fetch(new Request(`http://local${r.json.data.moods[0].thumb}`))
    expect(thumb.headers.get('content-type')).toBe('image/jpeg')
  })
  it('브랜드 기본값 저장·조회 (서비스에서 업종 추정)', async () => {
    expect((await call('GET', '/brand')).json.data.industry).toBe('eyebrow')
    expect((await call('PUT', '/brand', { industry: 'nail', mood: 'warm-natural', bookingLabel: '예약은 프로필 링크', brandColor: '#aa3366' })).status).toBe(200)
    const b = (await call('GET', '/brand')).json.data
    expect(b).toMatchObject({ industry: 'nail', mood: 'warm-natural', bookingLabel: '예약은 프로필 링크', brandColor: '#aa3366' })
    expect((await call('PUT', '/brand', { mood: 'nope' })).status).toBe(400)
  })
})

describe('직접 업로드 (큰 영상용)', () => {
  it('티켓 → 서명 URL 로 PUT → 등록, 남의 경로는 거부', async () => {
    const t = await call('POST', '/upload/ticket', { filename: 'clip.mp4', contentType: 'video/mp4', size: 1234 })
    expect(t.json.data.mode).toBe('local')
    const put = await app.fetch(new Request(`http://local${t.json.data.uploadUrl}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) }))
    expect(put.status).toBe(200)
    const reg = await call('POST', '/upload/register', { key: t.json.data.key, url: t.json.data.url, contentType: 'video/mp4', size: 3, durationSeconds: 7.6 })
    expect(reg.status).toBe(201)
    expect(reg.json.data.durationSeconds).toBe(8)
    const bad = await call('POST', '/upload/register', { key: 'uploads/other/x.mp4', url: '/api/files/uploads/other/x.mp4', contentType: 'video/mp4', size: 3 })
    expect(bad.status).toBe(403)
    const forged = await app.fetch(new Request(`http://local${t.json.data.uploadUrl.replace(/sig=\w+/, 'sig=00')}`, { method: 'PUT', body: new Uint8Array([1]) }))
    expect(forged.status).toBe(403)
  })
})

describe('게시글 초안', () => {
  it('사진 분석 → 인스타 3·블로그 2, 고른 글 저장', async () => {
    const before = await uploadPhoto('#b08070', 'before')
    const after = await uploadPhoto('#e0b8a0', 'after')
    const r = await call('POST', '/create/drafts', { mediaIds: [before, after], purpose: 'before-after', industry: 'eyebrow' })
    expect(r.status).toBe(200)
    expect(r.json.data.instagram).toHaveLength(3)
    expect(r.json.data.blog).toHaveLength(2)
    expect(r.json.data.keyword).toBe('역삼 눈썹문신')
    expect(r.json.data.instagram[0].text).toContain('#역삼눈썹문신')
    const fb = await call('POST', `/create/drafts/${r.json.data.id}/feedback`, { channel: 'instagram', index: 1, text: '직접 고친 글이에요\n\n#태그' })
    expect(fb.status).toBe(200)
    const media = await call('POST', `/media/${before}/analyze`)
    expect(media.json.data.consent).toBe('not_needed') // 얼굴 없음 → 동의 단계 불필요
  })
})

describe('사진 보정', () => {
  it('포맷별 결과 + 비포·애프터 콜라주, 내려받기 가능한 URL', async () => {
    const before = await uploadPhoto('#a07060', 'before')
    const after = await uploadPhoto('#e8c0a8', 'after')
    const r = await call('POST', '/create/photos', { mediaIds: [before, after], purpose: 'before-after', industry: 'nail', mood: 'trendy-fast', formats: ['feed-portrait', 'story'], overlayText: '뷰티룸', adjust: { grade: { saturation: 25 } } })
    expect(r.status).toBe(200)
    const outs = r.json.data.outputs as { url: string; formatId: string; kind: string; width: number; height: number }[]
    expect(outs.filter((o) => o.kind === 'collage')).toHaveLength(2)
    expect(outs).toHaveLength(6)
    expect(r.json.data.clamped.join()).toContain('grade.saturation') // 네일 채도 상한
    const file = await app.fetch(new Request(`http://local${outs[0]!.url}`))
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([1080, 1350])
    expect((await call('POST', '/create/photos', { mediaIds: [before], purpose: 'before-after', formats: ['reel'] })).status).toBe(400)
  })

  it('무드 미리보기 5장 (원장님 사진으로)', async () => {
    const id = await uploadPhoto('#d0a090', 'after')
    const r = await call('POST', `/media/${id}/previews`)
    expect(r.json.data).toHaveLength(5)
    expect(r.json.data[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })

  afterEach(() => {
    faceMode = false
  })

  it('얼굴이 보이면 동의 전에는 막고, 얼굴 가림을 고르면 진행', async () => {
    faceMode = true
    const id = await uploadPhoto('#c09080', 'after').finally(() => undefined)
    const r1 = await call('POST', '/create/photos', { mediaIds: [id], purpose: 'review', formats: ['feed-square'] })
    expect(r1.status).toBe(409)
    expect(r1.json.code).toBe('CONSENT_REQUIRED')
    expect((await call('PATCH', `/media/${id}`, { consent: 'blurred' })).status).toBe(200)
    expect((await call('POST', '/create/photos', { mediaIds: [id], purpose: 'review', formats: ['feed-square'] })).status).toBe(200)
  })
})

describe('영상: 작업 등록 → 작업자 → 결과', () => {
  it('등록은 즉시 응답(202), 작업자가 임대·업로드·완료하면 결과가 보인다', async () => {
    const before = await uploadPhoto('#a07060', 'before')
    const after = await uploadPhoto('#e8c0a8', 'after')
    const r = await call('POST', '/create/videos', { mediaIds: [before, after], purpose: 'before-after', mood: 'clean-white', format: 'reel' })
    expect(r.status).toBe(202)
    const jobId = r.json.data.jobId as string
    expect(Object.keys(r.json.data.lines).length).toBeGreaterThan(0)
    const again = await call('POST', '/create/videos', { mediaIds: [before, after], purpose: 'before-after', mood: 'clean-white', format: 'reel' })
    expect(again.json.data.jobId).toBe(jobId) // 연달아 눌러도 작업 하나

    const W = { Authorization: 'Bearer worker-token' }
    expect((await call('POST', '/worker/claim', { workerId: 'w' }, { Authorization: 'Bearer wrong' })).status).toBe(403)
    const claimed = await call('POST', '/worker/claim', { workerId: 'mac' }, W)
    expect(claimed.json.data.id).toBe(jobId)
    const lease = claimed.json.data.leaseToken as string
    expect(claimed.json.data.payload.lines).toBeDefined()
    expect((await call('POST', `/worker/jobs/${jobId}/heartbeat`, { leaseToken: lease, progress: 40, stage: 'render' }, W)).status).toBe(200)
    expect((await call('GET', `/create/jobs/${jobId}`)).json.data).toMatchObject({ status: 'processing', progress: 40, stage: 'render' })

    const upload = async (name: string, contentType: string) => {
      const t = await call('POST', `/worker/jobs/${jobId}/upload-ticket`, { leaseToken: lease, name, contentType, size: 3 }, W)
      expect(t.status).toBe(200)
      await app.fetch(new Request(`http://local${t.json.data.uploadUrl}`, { method: 'PUT', body: new Uint8Array([9, 9, 9]) }))
      return { key: t.json.data.key, url: t.json.data.url }
    }
    const video = await upload('video.mp4', 'video/mp4')
    const cover = await upload('cover.jpg', 'image/jpeg')
    expect((await call('POST', `/worker/jobs/${jobId}/heartbeat`, { leaseToken: 'stale' }, W)).status).toBe(409)
    const done = await call('POST', `/worker/jobs/${jobId}/complete`, { leaseToken: lease, result: { video, cover, width: 1080, height: 1920, duration: 18.5 } }, W)
    expect(done.status).toBe(200)
    const job = (await call('GET', `/create/jobs/${jobId}`)).json.data
    expect(job.status).toBe('completed')
    expect(job.result.video.url).toBe(video.url)
    expect(job.result.videoMediaId).toBeTruthy()
    expect((await call('GET', '/create/jobs')).json.data[0].id).toBe(jobId)
    const notes = await call('GET', '/notifications')
    expect(JSON.stringify(notes.json)).toContain('영상이 완성됐어요')
  })

  it('재료가 없는 구성은 등록하지 않는다, 사진 전용 포맷은 거부', async () => {
    const p = await uploadPhoto('#aa8877', 'shop')
    expect((await call('POST', '/create/videos', { mediaIds: [p], purpose: 'before-after', format: 'reel' })).json.code).toBe('NO_SCENES')
  })

  it('작업자가 실패를 보고하면 재시도 대기 → 재시도 불가면 실패 + 알림', async () => {
    const a = await uploadPhoto('#998877', 'after')
    const r = await call('POST', '/create/videos', { mediaIds: [a], purpose: 'review', format: 'story' })
    const W = { Authorization: 'Bearer worker-token' }
    const c1 = await call('POST', '/worker/claim', { workerId: 'mac' }, W)
    expect(c1.json.data.id).toBe(r.json.data.jobId)
    const f = await call('POST', `/worker/jobs/${c1.json.data.id}/fail`, { leaseToken: c1.json.data.leaseToken, error: '입력 오류', retryable: false }, W)
    expect(f.json.data.result).toBe('failed')
    const job = (await call('GET', `/create/jobs/${r.json.data.jobId}`)).json.data
    expect(job).toMatchObject({ status: 'failed', error: '입력 오류' })
  })
})

// 이 묶음은 큐에 작업을 남기므로 맨 뒤에 (앞 테스트의 작업자 임대 순서에 끼어들지 않게)
describe('처리할 수 없는 파일·알 수 없는 얼굴', () => {
  it('서버가 못 푸는 사진(HEIC 등)은 이해할 수 있는 422 안내', async () => {
    const t = await call('POST', '/upload/ticket', { filename: 'p.heic', contentType: 'image/heic', size: 10 })
    await app.fetch(new Request(`http://local${t.json.data.uploadUrl}`, { method: 'PUT', body: new Uint8Array(Buffer.from('not-really-an-image')) }))
    const reg = await call('POST', '/upload/register', { key: t.json.data.key, url: t.json.data.url, contentType: 'image/heic', size: 10, role: 'after' })
    const r = await call('POST', `/media/${reg.json.data.id}/analyze`)
    expect(r.status).toBe(422)
    expect(r.json.message_ko).toContain('높은 호환성')
  })

  it('대표 화면이 없는 영상은 얼굴 여부를 확인받기 전엔 쓰지 않는다 → "얼굴 안 나와요" 후 진행', async () => {
    const t = await call('POST', '/upload/ticket', { filename: 'v.mp4', contentType: 'video/mp4', size: 3 })
    await app.fetch(new Request(`http://local${t.json.data.uploadUrl}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) }))
    const v = (await call('POST', '/upload/register', { key: t.json.data.key, url: t.json.data.url, contentType: 'video/mp4', size: 3, durationSeconds: 6, role: 'process' })).json.data
    const after = await uploadPhoto('#d8b0a0', 'after')
    const before = await uploadPhoto('#a08070', 'before')
    const body = { mediaIds: [before, after, v.id], purpose: 'before-after', format: 'story' }
    const r1 = await call('POST', '/create/videos', body)
    expect(r1.json.code).toBe('CONSENT_REQUIRED')
    expect(r1.json.details.mediaIds).toEqual([v.id])
    expect((await call('PATCH', `/media/${v.id}`, { consent: 'not_needed' })).status).toBe(200)
    expect((await call('POST', '/create/videos', body)).status).toBe(202)
  })
})
