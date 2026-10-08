export default async function handler(req: Request): Promise<Response> {
  const { default: app } = await import('../apps/api/api/index.js')
  return app.fetch(req)
}
