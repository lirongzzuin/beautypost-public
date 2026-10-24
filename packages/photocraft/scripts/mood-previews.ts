// 무드 프리셋 미리보기 썸네일 생성: presets/moods/<id>/thumb.jpg
//   pnpm --filter @beautypost/photocraft previews [--sheet <out.png>]
//
// presets/_samples/before.jpg·after.jpg 가 있으면 그 사진으로, 없으면 합성 샘플로 만든다.
// 썸네일 = 그 무드의 색보정 + 프레임 + 라벨·문구 서체로 만든 비포·애프터 (실제 결과물과 같은 코드 경로).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { getRegistry } from '@beautypost/preset'
import { beforeAfter, renderCard } from '../src/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SAMPLES = join(ROOT, 'presets/_samples')

async function synthetic(c1: string, c2: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="900" height="900" fill="url(#g)"/><ellipse cx="450" cy="420" rx="260" ry="70" fill="#5b4033"/><circle cx="300" cy="650" r="90" fill="#d9a38a"/></svg>`
  return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

async function sample(name: string, c1: string, c2: string): Promise<Buffer> {
  const f = join(SAMPLES, `${name}.jpg`)
  return existsSync(f) ? readFileSync(f) : synthetic(c1, c2)
}

const reg = getRegistry()
const before = await sample('before', '#c9a48f', '#8a6f63')
const after = await sample('after', '#e8c9b5', '#b0897a')
const tiles: Buffer[] = []
for (const m of reg.data.moods) {
  const r = await beforeAfter({
    width: 1080, height: 1350, grade: m.grade, before: { data: before }, after: { data: after },
    labels: { before: 'BEFORE', after: 'AFTER', style: m.photo.overlay },
    frame: { style: m.photo.frame, color: m.palette.accent },
    overlay: { text: `${m.label} · 샵 이름`, style: m.photo.overlay }, background: m.palette.background,
  })
  const thumb = await sharp(r.data).resize(480, 600).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  writeFileSync(join(ROOT, 'presets/moods', m.id, 'thumb.jpg'), thumb)
  tiles.push(await sharp(thumb).resize(360, 450).toBuffer())
  console.log(`✓ moods/${m.id}/thumb.jpg`)
}

const sheetIdx = process.argv.indexOf('--sheet')
if (sheetIdx > 0) {
  const m = reg.mood('modern-black-gold')
  const card = await renderCard({ width: 1080, height: 1920, background: m.palette.background, lines: [
    { text: '뷰티룸 · 역삼', style: m.video.captions.emphasis, scale: 0.09 },
    { text: '예약은 프로필 링크에서', style: m.video.captions.main, scale: 0.05 },
  ] })
  tiles.push(await sharp(card).resize(253, 450).toBuffer())
  await sharp({ create: { width: 370 * tiles.length + 10, height: 470, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((t, i) => ({ input: t, left: 10 + i * 370, top: 10 })))
    .png()
    .toFile(process.argv[sheetIdx + 1]!)
}
