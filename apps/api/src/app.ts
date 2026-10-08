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
import cronRoutes from './routes/cron.js'

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
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger())
  app.use('*', prettyJSON())
}

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

app.get('/api/config', (c) => {
  return c.json({
    data: {
      minSupportedVersion: '1.0.0',
      latestVersion: '1.0.0',
      maintenanceNotice: null,
      featureFlags: { instagram: true, naverBlog: true, reels: false },
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
app.route('/cron', cronRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json(
    { code: 'INTERNAL_ERROR', message_ko: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.' },
    500,
  )
})

app.notFound((c) => c.json({ code: 'NOT_FOUND', message_ko: '찾을 수 없어요.' }, 404))

export default app
