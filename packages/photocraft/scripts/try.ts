// 로컬 사진으로 게시용 사진(비포·애프터 콜라주 + 한 장) 만들어 보기 (구도·보정 확인용)
//   pnpm --filter @beautypost/photocraft try <비포.jpg> <애프터.jpg> [--mood warm-natural] [--out /tmp/photos]
//     [--area-b x,y,w,h] [--area-a x,y,w,h]  (시술 부위 0~1, 분석 결과 대신)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { getRegistry } from '@beautypost/preset'
import { autoPatch, beforeAfter, combineGrade, imageStats, processPhoto } from '../src/index.js'

const args = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`)
  if (i < 0) return d
  const v = args[i + 1]!
  args.splice(i, 2)
  return v
}
const box = (v: string) => {
  if (!v) return null
  const [x, y, w, h] = v.split(',').map(Number)
  return { x: x!, y: y!, w: w!, h: h! }
}
const mood = getRegistry().mood(opt('mood', 'warm-natural'))
const out = resolve(opt('out', '/tmp/photos'))
const areaB = box(opt('area-b', ''))
const areaA = box(opt('area-a', ''))
const [beforeFile, afterFile] = args
if (!beforeFile || !afterFile) throw new Error('비포·애프터 파일이 필요해요')
mkdirSync(out, { recursive: true })

const before = readFileSync(beforeFile)
const after = readFileSync(afterFile)
const grade = combineGrade(mood.grade, autoPatch([await imageStats(before), await imageStats(after)]), getRegistry().industry('eyebrow').gradeLimits)
const label = { ...mood.video.captions.label, stroke: null, background: null, shadow: true }
const results: [string, Buffer][] = []
for (const f of ['feed-portrait', 'feed-square', 'story']) {
  const { width, height } = getRegistry().format(f)
  const r = await beforeAfter({
    width, height, grade, before: { data: before, area: areaB }, after: { data: after, area: areaA },
    labels: { before: mood.video.labelText.before, after: mood.video.labelText.after, style: label }, gap: 0, background: mood.video.dividerColor,
  })
  results.push([`collage-${f}.jpg`, r.data])
}
results.push(['single-before.jpg', (await processPhoto(before, { width: 1080, height: 1350, grade, area: areaB })).data])
results.push(['single-after.jpg', (await processPhoto(after, { width: 1080, height: 1350, grade, area: areaA })).data])
for (const [name, data] of results) writeFileSync(`${out}/${name}`, data)
// 한눈에 보기
const tiles = await Promise.all(results.map(([, d]) => sharp(d).resize(300, 480, { fit: 'contain', background: '#888' }).toBuffer()))
await sharp({ create: { width: 300 * tiles.length, height: 480, channels: 3, background: '#888' } })
  .composite(tiles.map((t, i) => ({ input: t, left: i * 300, top: 0 })))
  .jpeg()
  .toFile(`${out}/sheet.jpg`)
console.log(`✓ ${out}/sheet.jpg`)
