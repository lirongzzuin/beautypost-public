import type { IncomingMessage, ServerResponse } from 'node:http'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { default: app } = await import('../apps/api/src/app.js')

  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  const host = req.headers.host ?? 'localhost'
  const url = `${proto}://${host}${req.url ?? '/'}`

  const headers = new Headers()
  for (const [key, val] of Object.entries(req.headers)) {
    if (!val) continue
    if (Array.isArray(val)) val.forEach(v => headers.append(key, v))
    else headers.set(key, val)
  }

  let body: Buffer | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    if (chunks.length) body = Buffer.concat(chunks)
  }

  const request = new Request(url, {
    method: req.method ?? 'GET',
    headers,
    body: body ?? null,
    // @ts-ignore — Node.js requires duplex for streaming body
    duplex: 'half',
  })

  const response = await app.fetch(request)

  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
