// 렌더 확인용 샘플 작업 입력 만들기 (합성 사진 + filmcraft 테스트 영상)
//   tsx scripts/sample-spec.ts <out.json> [--purpose before-after] [--mood clean-white] [--format reel] [--industry eyebrow]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { getRegistry, resolvePreset } from '@beautypost/preset'

const args = process.argv.slice(2)
const out = resolve(args[0] ?? 'sample-spec.json')
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1]! : d
}
const filmcraft = resolve(process.env.FILMCRAFT_DIR ?? '../../../filmcraft')
const dir = join(dirname(out), 'sample-media')
mkdirSync(dir, { recursive: true })

async function photo(name: string, c1: string, c2: string): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="1440" height="1800" fill="url(#g)"/><ellipse cx="720" cy="760" rx="420" ry="110" fill="#5b4033"/><circle cx="480" cy="1250" r="150" fill="#d9a38a"/></svg>`
  const f = join(dir, `${name}.jpg`)
  writeFileSync(f, await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer())
  return f
}

const reg = getRegistry()
const p = resolvePreset(reg, { purpose: opt('purpose', 'before-after'), industry: opt('industry', 'eyebrow'), format: opt('format', 'reel'), mood: opt('mood', 'clean-white') })
const spec = {
  specVersion: 1, mood: p.mood, purpose: p.purpose, format: p.format, videoDurationSec: p.videoDurationSec,
  industryLabel: p.industry.label, shop: { name: '뷰티룸', region: '서울 역삼', booking: '예약은 프로필 링크' }, brandColor: null, logoUrl: null,
  media: [
    { id: 'before1', url: await photo('before1', '#c9a48f', '#8a6f63'), kind: 'image', role: 'before', focus: { x: 0.5, y: 0.42 }, blurFaces: [] },
    { id: 'after1', url: await photo('after1', '#e8c9b5', '#b0897a'), kind: 'image', role: 'after', focus: { x: 0.5, y: 0.42 }, blurFaces: [] },
    { id: 'after2', url: await photo('after2', '#f1d9c7', '#c49a86'), kind: 'image', role: 'after', focus: { x: 0.5, y: 0.42 }, blurFaces: [{ x: 0.25, y: 0.62, w: 0.2, h: 0.16 }] },
    { id: 'proc1', url: join(filmcraft, 'tests/footage/test_portrait_01.mp4'), kind: 'video', role: 'process', durationSec: 8, focus: { x: 0.5, y: 0.5 }, blurFaces: [] },
    { id: 'any1', url: join(filmcraft, 'tests/footage/test_portrait_02.mp4'), kind: 'video', role: 'any', durationSec: 6, focus: { x: 0.5, y: 0.5 }, blurFaces: [] },
  ],
  lines: { '0': '자연스러운 결 눈썹', '1': '숱이 적어 고민이셨죠', '2': '한 올씩 결을 그려요', '3': '자연스럽게 완성', '4': '뷰티룸 예약 문의', },
}
writeFileSync(out, JSON.stringify(spec, null, 2))
console.log(out)
