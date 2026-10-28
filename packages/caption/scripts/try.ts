// 실제 AI 로 글 품질·속도 확인 (사진 분석 → 인스타 후보 3 → 영상 자막)
//   GOOGLE_GENERATIVE_AI_API_KEY=... pnpm --filter @beautypost/caption try <사진...> [--industry eyebrow] [--mood warm-natural]
//     [--memo "콤보 눈썹, 꼬리 채움"] [--shop 뷰티룸] [--region "서울 강남구 역삼동"] [--signature "예약은 카카오채널"] [--blog]
// 사진 역할은 파일 이름으로: before*, after*, process* (나머지는 역할 없음)
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import sharp from 'sharp'
import { createAiClient } from '@beautypost/ai'
import { getRegistry, resolvePreset } from '@beautypost/preset'
import { analyzeImage, generateDrafts, generateVideoCopy, type MediaAnalysis } from '../src/index.js'

const args = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const i = args.indexOf(`--${k}`)
  if (i < 0) return d
  const v = args[i + 1] ?? ''
  args.splice(i, 2)
  return v
}
const flag = (k: string) => {
  const i = args.indexOf(`--${k}`)
  if (i >= 0) args.splice(i, 1)
  return i >= 0
}
const industry = opt('industry', 'eyebrow')
const mood = opt('mood', 'warm-natural')
const memo = opt('memo')
const shop = { name: opt('shop', '뷰티룸'), region: opt('region', '서울 강남구 역삼동'), booking: opt('booking', '프로필 링크') }
const signature = opt('signature')
const blog = flag('blog')
const files = args
if (!files.length) throw new Error('사진 파일을 넣어 주세요')

const ai = createAiClient()
const preset = resolvePreset(getRegistry(), { purpose: 'before-after', industry, format: 'reel', mood })
const roleOf = (f: string) => (/^before/i.test(basename(f)) ? 'before' : /^after/i.test(basename(f)) ? 'after' : /^process/i.test(basename(f)) ? 'process' : null)
const sec = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}초`

let t = Date.now()
const analyses = await Promise.all(
  files.map(async (f) => {
    const img = await sharp(readFileSync(f)).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
    return (await analyzeImage(ai, { data: img, mediaType: 'image/jpeg' }, { industryLabel: preset.industry.label, role: roleOf(f) })).analysis
  }),
)
console.log(`\n■ 사진 분석 ${files.length}장 (동시) ${sec(t)}`)
analyses.forEach((a, i) => console.log(`  ${basename(files[i]!)}: ${a.subject} / ${a.details.join('; ')} / areaBox ${JSON.stringify(a.areaBox)}`))

const ctx = {
  shop, preset, keywords: memo || undefined, voiceSamples: [],
  media: files.map((f, i) => ({ index: i + 1, role: roleOf(f), kind: 'image' as const, analysis: analyses[i] as MediaAnalysis })),
  settings: { signature, hashtagCount: 5 },
}
t = Date.now()
const [drafts, video] = await Promise.all([
  generateDrafts(ai, ctx, { instagram: 3, blog: blog ? 2 : 0 }),
  generateVideoCopy(ai, ctx, preset.purpose.video.slots.flatMap((s, i) => (s.caption ? [{ index: i, role: s.role, intent: s.caption.intent, maxChars: s.caption.maxChars }] : []))),
])
console.log(`\n■ 인스타 후보 3${blog ? ' + 블로그 2' : ''} + 영상 자막 (동시) ${sec(t)} — ${drafts.model}`)
for (const c of drafts.instagram) {
  console.log(`\n──── ${c.draft.angle}${c.rewritten ? ' (자동 수정됨)' : ''}\n${c.text}`)
  for (const f of c.findings) console.log(`  ⚠ ${f.severity} "${f.match}" — ${f.reason}`)
}
for (const b of drafts.blog) console.log(`\n──── 블로그\n${b.text}`)
console.log('\n■ 영상 화면 자막', video.lines)
