import { Hono } from 'hono'
import { put } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '../db/index.js'
import { authMiddleware, entitlementMiddleware, type AuthVariables } from '../middleware/auth.js'
import { apiRateLimit } from '../middleware/ratelimit.js'

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

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const blobPath = `uploads/${userId}/${Date.now()}_${safeName}`

  let blobUrl: string

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(blobPath, file, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    })
    blobUrl = blob.url
  } else {
    // Dev fallback: use placeholder URL (upload UI still works, AI generation may fail for media)
    blobUrl = `/_dev/media/${blobPath}`
  }

  const db = getDb()
  const inserted = await db
    .insert(schema.media)
    .values({
      userId,
      type: isImage ? 'image' : 'video',
      originalUrl: blobUrl,
      sizeBytes: file.size,
      status: 'ready',
    })
    .returning()

  const media = inserted[0]!
  return c.json({ data: { mediaId: media.id, url: blobUrl } })
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
