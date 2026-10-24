import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'

import authRoutes from './routes/auth.js'
import uploadRoutes from './routes/upload.js'
import postsRoutes from './routes/posts.js'
import aiRoutes from './routes/ai.js'
import channelsRoutes from './routes/channels.js'
import customersRoutes from './routes/customers.js'
import notificationsRoutes from './routes/notifications.js'
import entitlementsRoutes from './routes/entitlements.js'
import styleExamplesRoutes from './routes/style-examples.js'
import cronRoutes from './routes/cron.js'
import presetsRoutes from './routes/presets.js'
import brandRoutes from './routes/brand.js'
import mediaRoutes from './routes/media.js'
import createRoutes from './routes/create.js'
import workerRoutes from './routes/worker.js'
import filesRoutes from './routes/files.js'
import { toResponse } from './services/errors.js'
import { getStorage } from './storage/index.js'

const app = new Hono().basePath('/api')

app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      process.env.APP_URL ?? 'http://localhost:5173',
      'http://localhost:5173',
      'http://localhost:3000',
    ]
    return allowed.includes(origin) ? origin : allowed[0]!
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger())
  app.use('*', prettyJSON())
}

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

app.get('/config', (c) => {
  return c.json({
    data: {
      minSupportedVersion: '1.0.0',
      latestVersion: '1.0.0',
      maintenanceNotice: null,
      // 인스타그램 계정 연동·자동 게시는 보류 (FEATURE_INSTAGRAM=true 일 때만). 기본은 "다운로드 + 복사" 흐름
      featureFlags: { instagram: process.env.FEATURE_INSTAGRAM === 'true', naverBlog: true, reels: true },
      storage: getStorage().mode,
      serverTime: new Date().toISOString(),
    },
  })
})

app.route('/auth', authRoutes)
app.route('/upload', uploadRoutes)
app.route('/posts', postsRoutes)
app.route('/ai', aiRoutes)
app.route('/channels', channelsRoutes)
app.route('/customers', customersRoutes)
app.route('/notifications', notificationsRoutes)
app.route('/entitlements', entitlementsRoutes)
app.route('/style-examples', styleExamplesRoutes)
app.route('/cron', cronRoutes)
app.route('/presets', presetsRoutes)
app.route('/brand', brandRoutes)
app.route('/media', mediaRoutes)
app.route('/create', createRoutes)
app.route('/worker', workerRoutes)
app.route('/files', filesRoutes)

app.onError((err, c) => {
  const known = toResponse(err)
  if (known) return c.json(known.body, known.status)
  console.error(err)
  return c.json(
    { code: 'INTERNAL_ERROR', message_ko: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.' },
    500,
  )
})

app.notFound((c) => c.json({ code: 'NOT_FOUND', message_ko: '찾을 수 없어요.' }, 404))

export default app
