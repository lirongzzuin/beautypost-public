// 로컬 사진으로 영상 하나 만들어 보기 (엔진 확인용)
//   pnpm --filter @beautypost/reel try <비포.jpg> <애프터.jpg> [과정.jpg|mp4 ...] [--mood warm-natural] [--format reel] [--out /tmp/reel]
//     [--area-b x,y,w,h] [--area-a x,y,w,h]  (시술 부위 0~1, 분석 결과 대신)
import { mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { getRegistry, resolvePreset } from '@beautypost/preset'
import { RenderSpec, planVideo, type RenderMedia } from '@beautypost/render'
import { renderReel } from '../src/index.js'

const args = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`)
  if (i < 0) return d
  const v = args[i + 1]!
  args.splice(i, 2)
  return v
}
const mood = opt('mood', 'warm-natural')
const format = opt('format', 'reel')
const purpose = opt('purpose', 'before-after')
const out = resolve(opt('out', '/tmp/reel'))
const box = (v: string) => {
  if (!v) return null
  const [x, y, w, h] = v.split(',').map(Number)
  return { x: x!, y: y!, w: w!, h: h! }
}
const areaB = box(opt('area-b', ''))
const areaA = box(opt('area-a', ''))
const [before, after, ...rest] = args
if (!before || !after) throw new Error('비포·애프터 파일이 필요해요')
mkdirSync(out, { recursive: true })

const p = resolvePreset(getRegistry(), { purpose, industry: 'eyebrow', format, mood })
const media: RenderMedia[] = [
  { id: 'b', url: before, kind: 'image', role: 'before', focus: null, area: areaB, blurFaces: [] },
  { id: 'a', url: after, kind: 'image', role: 'after', focus: null, area: areaA, blurFaces: [] },
  ...rest.map((f, i): RenderMedia => ({ id: `p${i}`, url: f, kind: /\.(mp4|mov)$/i.test(f) ? 'video' : 'image', role: 'process', durationSec: 6, focus: null, blurFaces: [] })),
]
const spec = RenderSpec.parse({
  specVersion: 1, mood: p.mood, purpose: p.purpose, format: p.format, videoDurationSec: p.videoDurationSec, industryLabel: p.industry.label,
  gradeLimits: p.industry.gradeLimits,
  shop: { name: '예시뷰티', region: '서울 마포', booking: '예약은 프로필 링크 · 카카오채널', handle: '@example_shop' },
  media, lines: { '0': '반전 있어요', '1': '꼬리 숱이 비어 있던 상태', '2': '결 방향대로 채워요', '3': '앞머리부터 꼬리까지 이어진 결', '4': '상담은 카카오채널로' },
})
const plan = planVideo(spec)
const files = Object.fromEntries(media.map((m) => [m.id, resolve(m.url)]))
const t0 = Date.now()
const r = await renderReel({ spec, plan, files, out: { video: `${out}/${mood}-${format}.mp4`, cover: `${out}/${mood}-${format}.jpg` } })
console.log(`${basename(r.video)} ${r.duration}s ${r.frames}프레임 — ${((Date.now() - t0) / 1000).toFixed(1)}초`, plan.clips.map((c) => `${c.role}:${(c.end - c.start).toFixed(1)}`).join(' '))
