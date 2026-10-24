import { Hono } from 'hono'
import { extname } from 'node:path'
import { LOCAL_FILES_PREFIX, localStorage } from '../storage/index.js'

// 로컬 저장소(STORAGE=local, 개발·테스트)의 파일 읽기·서명 업로드. Vercel Blob 을 쓰면 404.
const files = new Hono()

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
}

function keyOf(path: string): string {
  return decodeURIComponent(path.slice(path.indexOf(LOCAL_FILES_PREFIX) + LOCAL_FILES_PREFIX.length))
}

files.get('/*', async (c) => {
  const store = localStorage()
  if (!store) return c.json({ code: 'NOT_FOUND', message_ko: '찾을 수 없어요.' }, 404)
  try {
    const key = keyOf(c.req.path)
    const data = await store.readKey(key)
    return c.body(new Uint8Array(data), 200, { 'Content-Type': TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' })
  } catch {
    return c.json({ code: 'NOT_FOUND', message_ko: '파일을 찾을 수 없어요.' }, 404)
  }
})

files.put('/*', async (c) => {
  const store = localStorage()
  if (!store) return c.json({ code: 'NOT_FOUND', message_ko: '찾을 수 없어요.' }, 404)
  const key = keyOf(c.req.path)
  if (!store.verify(key, Number(c.req.query('exp')), c.req.query('sig') ?? '')) {
    return c.json({ code: 'AUTH_FORBIDDEN', message_ko: '업로드 권한이 없거나 만료됐어요.' }, 403)
  }
  const obj = await store.put(key, Buffer.from(await c.req.arrayBuffer()))
  return c.json({ data: obj })
})

export default files
