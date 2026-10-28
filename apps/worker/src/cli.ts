// 큐 없이 렌더 한 번 (디버깅·프리셋 확인용)
//   pnpm --filter @beautypost/worker render-local <spec.json> [작업 id]
// spec.json = RenderSpec (packages/render). media[].url 은 http(s) 또는 file 절대 경로도 된다.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureFonts } from './fonts.js'
import { renderJob } from './pipeline.js'

const [specPath, jobId = `local-${Date.now()}`] = process.argv.slice(2)
if (!specPath) {
  console.error('사용법: render-local <spec.json> [작업 id]')
  process.exit(2)
}
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { media?: { url: string }[]; logoUrl?: string | null }
// 로컬 파일 경로를 file:// URL 로
for (const m of spec.media ?? []) if (m.url.startsWith('/') && !m.url.startsWith('/api/')) m.url = pathToFileURL(m.url).href

const filmcraftDir = resolve(process.env.FILMCRAFT_DIR ?? '../../../filmcraft')
const engine = process.env.RENDER_ENGINE === 'filmcraft' ? 'filmcraft' : 'native'
if (engine === 'filmcraft') {
  const installed = ensureFonts(resolve(process.env.FONTS_DIR ?? '../../presets/fonts/files'))
  if (installed.length) console.log(`폰트 설치: ${installed.join(', ')}`)
}
const t0 = Date.now()
const r = await renderJob(spec, jobId, {
  workDir: resolve(process.env.WORK_DIR ?? '.data/renders'),
  filmcraftDir,
  engine,
  apiUrl: process.env.RENDER_API_URL,
  allowFileUrls: true,
  stage: (s, p) => console.log(`  [${String(p).padStart(3)}%] ${s}`),
})
console.log(JSON.stringify({ ...r, seconds: Math.round((Date.now() - t0) / 1000) }, null, 2))
