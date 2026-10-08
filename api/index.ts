import { handle } from '@hono/node-server/vercel'
import app from '../apps/api/api/index.js'

export default handle(app)
