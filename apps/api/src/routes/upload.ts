import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { apiRateLimit } from '../middleware/ratelimit.js'
import { getStorage, makeKey } from '../storage/index.js'
import { ApiError } from '../services/errors.js'
import { present } from './media.js'

const upload = new Hono<{ Variables: AuthVariables }>()
upload.use('*', authMiddleware, entitlementMiddleware, apiRateLimit)

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'])
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/mov'])
const MAX_SIZE = 100 * 1024 * 1024 // 100MB

// POST /api/upload/file — multipart file upload (client → server → Vercel Blob)
upload.post('/file', async (c) => {
  const userId = c.get('userId')

  let file: File
  try {
    const body = await c.req.parseBody()
    file = body['file'] as File
    if (!file || typeof file === 'string') {
      return c.json({ code: 'VALIDATION_ERROR', message_ko: '파일이 없어요.' }, 400)
    }
  } catch {
    return c.json({ code: 'VALIDATION_ERROR', message_ko: '파일 형식이 올바르지 않아요.' }, 400)
  }

  if (file.size > MAX_SIZE) {
    return c.json({ code: 'MEDIA_TOO_LARGE', message_ko: '파일 크기가 너무 커요. 100MB 이하로 줄여주세요.' }, 400)
  }

  const contentType = file.type
  const isImage = ALLOWED_IMAGE_TYPES.has(contentType)
  const isVideo = ALLOWED_VIDEO_TYPES.has(contentType)
  if (!isImage && !isVideo) {
    return c.json({ code: 'MEDIA_INVALID_FORMAT', message_ko: '지원하지 않는 파일 형식이에요.' }, 400)
  }

  // 작은 파일용 (서버 경유). 큰 영상은 /ticket → 직접 업로드 → /register (Vercel 함수 본문 4.5MB 제한)
  const stored = await getStorage().put(makeKey('uploads', userId, file.name), Buffer.from(await file.arrayBuffer()), contentType)
  const blobUrl = stored.url

  const db = getDb()
  const inserted = await db
    .insert(schema.media)
    .values({
      userId,
      type: isImage ? 'image' : 'video',
      originalUrl: blobUrl,
      storageKey: stored.key,
      mimeType: contentType,
      sizeBytes: file.size,
      status: 'ready',
    })
    .returning()

  const media = inserted[0]!
  return c.json({ data: { mediaId: media.id, url: blobUrl } })
})

// POST /api/upload/ticket — 직접 업로드 권한 (Vercel Blob 클라이언트 토큰 또는 로컬 서명 URL)
const Ticket = z.object({ filename: z.string().min(1).max(200), contentType: z.string(), size: z.number().int().positive() })

upload.post('/ticket', async (c) => {
  const body = Ticket.safeParse(await c.req.json().catch(() => null))
  if (!body.success) throw new ApiError(400, 'VALIDATION_ERROR', '파일 정보가 올바르지 않아요.')
  const { filename, contentType, size } = body.data
  if (!ALLOWED_IMAGE_TYPES.has(contentType) && !ALLOWED_VIDEO_TYPES.has(contentType)) {
    throw new ApiError(400, 'MEDIA_INVALID_FORMAT', '지원하지 않는 파일 형식이에요.')
  }
  if (size > MAX_SIZE) throw new ApiError(400, 'MEDIA_TOO_LARGE', '파일 크기가 너무 커요. 100MB 이하로 줄여주세요.')
  const ticket = await getStorage().createUploadTicket(makeKey('uploads', c.get('userId'), filename), { contentType, maxBytes: MAX_SIZE })
  return c.json({ data: ticket })
})

// POST /api/upload/register — 직접 올린 파일을 미디어로 등록 (영상이면 대표 화면도 함께)
const Register = z.object({
  key: z.string(),
  url: z.string(),
  contentType: z.string(),
  size: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  thumbnail: z.object({ key: z.string(), url: z.string() }).optional(),
  role: z.string().max(20).optional(),
})

upload.post('/register', async (c) => {
  const userId = c.get('userId')
  const body = Register.safeParse(await c.req.json().catch(() => null))
  if (!body.success) throw new ApiError(400, 'VALIDATION_ERROR', '파일 정보가 올바르지 않아요.')
  const b = body.data
  const storage = getStorage()
  const mine = (key: string, url: string) => key.startsWith(`uploads/${userId}/`) && storage.keyFromUrl(url) === key
  if (!mine(b.key, b.url) || (b.thumbnail && !mine(b.thumbnail.key, b.thumbnail.url))) {
    throw new ApiError(403, 'AUTH_FORBIDDEN', '이 파일을 등록할 수 없어요.')
  }
  const isVideo = ALLOWED_VIDEO_TYPES.has(b.contentType)
  if (!isVideo && !ALLOWED_IMAGE_TYPES.has(b.contentType)) throw new ApiError(400, 'MEDIA_INVALID_FORMAT', '지원하지 않는 파일 형식이에요.')
  const [row] = await getDb()
    .insert(schema.media)
    .values({
      userId, type: isVideo ? 'video' : 'image', originalUrl: b.url, storageKey: b.key, mimeType: b.contentType,
      thumbnailUrl: b.thumbnail?.url ?? null, width: b.width, height: b.height,
      durationSeconds: b.durationSeconds !== undefined ? Math.round(b.durationSeconds) : null,
      sizeBytes: b.size, status: 'ready', role: b.role ?? null,
    })
    .returning()
  return c.json({ data: present(row!) }, 201)
})

// GET /api/upload/:mediaId — get media status
upload.get('/:mediaId', async (c) => {
  const userId = c.get('userId')
  const mediaId = c.req.param('mediaId')
  const db = getDb()

  const [media] = await db
    .select()
    .from(schema.media)
    .where(eq(schema.media.id, mediaId))
    .limit(1)

  if (!media || media.userId !== userId) {
    return c.json({ code: 'NOT_FOUND', message_ko: '미디어를 찾을 수 없어요.' }, 404)
  }

  return c.json({
    data: {
      id: media.id,
      type: media.type,
      status: media.status,
      originalUrl: media.originalUrl,
      processedUrl: media.processedUrl,
      thumbnailUrl: media.thumbnailUrl,
      width: media.width,
      height: media.height,
      durationSeconds: media.durationSeconds,
    },
  })
})

export default upload
