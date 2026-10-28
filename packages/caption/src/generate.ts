import type { AiClient, ImageInput } from '@beautypost/ai'
import type { ResolvedPreset } from '@beautypost/preset'
import { getPrompt, renderPrompt } from './prompts.js'
import { checkText, describeFindings, hasBlocking, type Finding, type PolicyInput } from './policy.js'
import {
  blogText,
  fixBlogPhotos,
  instagramText,
  kakaoText,
  keywordsFor,
  normalizeHashtags,
  screenLine,
} from './format.js'
import {
  BlogDrafts,
  InstagramDrafts,
  MediaAnalysis,
  Rewrite,
  VideoCopy,
  type BlogDraft,
  type InstagramDraft,
} from './schemas.js'

// 게시글 생성 흐름: (사진 분석) → 채널별 후보 생성 → 정책 검사 → 걸린 후보는 1회 자동 수정 → 남은 문제는 표시.

export const SECTION_LABELS: Record<string, string> = {
  hook: '첫 줄 후킹',
  empathy: '고객 고민 공감',
  point: '시술 포인트',
  trust: '신뢰 요소(경력·위생·꼼꼼함)',
  cta: '예약 유도',
  info: '안내 정보(혜택·기간·방법)',
  'care-tip': '관리 팁',
}

export const TONE_LABELS: Record<string, string> = {
  calm: '차분하고 담백하게',
  friendly: '친근하고 따뜻하게, 단골에게 말 걸듯',
  bright: '밝고 사랑스럽게',
  premium: '고급스럽고 절제된 말투, 감탄사 없이',
  witty: '짧고 재치 있게, 트렌디하게',
}

export const ROLE_LABELS: Record<string, string> = {
  before: '비포', after: '애프터', process: '시술 과정', detail: '디테일', shop: '매장', owner: '원장님',
  review: '고객 후기', product: '제품', any: '사진',
}

export interface MediaFact {
  /** 올린 순서 (1부터) */
  index: number
  role?: string | null
  kind: 'image' | 'video'
  analysis?: MediaAnalysis | null
}

export interface DraftContext {
  shop: { name: string; region: string; booking?: string | null }
  preset: ResolvedPreset
  keywords?: string
  customerName?: string
  media: MediaFact[]
  voiceSamples: string[]
  userBanned?: string[]
  /** 샵 설정: 글 끝 고정 안내 문구(예약 방법 등), 해시태그 개수, 항상 넣을 해시태그 */
  settings?: CaptionSettings
}

export interface CaptionSettings {
  signature?: string | null
  hashtagCount?: number
  brandHashtags?: string[]
}

export const DEFAULT_HASHTAG_COUNT = 5

export interface Checked<T> {
  draft: T
  /** 복사해서 바로 붙여넣는 최종 텍스트 */
  text: string
  findings: Finding[]
  /** 정책 검사에 걸려 자동으로 고친 후보인지 */
  rewritten: boolean
}

export interface DraftResult {
  instagram: (Checked<InstagramDraft> & { kakao: string })[]
  blog: Checked<BlogDraft>[]
  keyword: string
  promptVersions: Record<string, string>
  model: string
}

export function describeMedia(media: MediaFact[]): string {
  if (!media.length) return '(사진 없음 — 사진 내용을 지어내지 말고 일반적인 안내로)'
  return media
    .map((m) => {
      const head = `사진 ${m.index}${m.role ? ` (${ROLE_LABELS[m.role] ?? m.role})` : ''}${m.kind === 'video' ? ' [영상]' : ''}`
      const a = m.analysis
      if (!a) return `${head}: 분석 없음`
      const bits = [a.subject]
      if (a.details.length) bits.push(`관찰: ${a.details.join('; ')}`)
      if (a.colors.length) bits.push(`색: ${a.colors.join(', ')}`)
      if (a.textInImage) bits.push(`사진 속 글자: "${a.textInImage}"`)
      return `${head}: ${bits.join(' / ')}`
    })
    .join('\n')
}

export function policyInput(ctx: DraftContext): PolicyInput {
  return { lists: ctx.preset.policy, industryBanned: ctx.preset.extraBannedPhrases, userBanned: ctx.userBanned }
}

function bannedList(ctx: DraftContext): string {
  const fromRules = ctx.preset.policy
    .filter((p) => p.severity === 'block')
    .flatMap((p) => p.rules.map((r) => (r.kind === 'regex' ? r.reason : r.match)))
  return [...new Set([...fromRules, ...ctx.preset.extraBannedPhrases, ...(ctx.userBanned ?? [])])].slice(0, 30).join(', ')
}

function baseVars(ctx: DraftContext) {
  const p = ctx.preset
  const keywords = keywordsFor(p.industry.keywordPatterns, ctx.shop.region)
  return {
    shopName: ctx.shop.name,
    region: ctx.shop.region,
    industry: p.industry.label,
    purpose: p.purpose.label,
    purposeDescription: p.purpose.description,
    structure: p.purpose.copyStructure.map((s, i) => `${i + 1}. ${SECTION_LABELS[s] ?? s}`).join(' → '),
    keywords: ctx.keywords ?? '',
    customerName: ctx.customerName ?? '',
    booking: ctx.shop.booking ?? '',
    media: describeMedia(ctx.media),
    tone: TONE_LABELS[p.mood.copy.tone] ?? p.mood.copy.tone,
    // 레퍼런스 계정들은 글 전체에 이모지 0~3개 (항목 표시·문장 끝 장식). 문단당 값 × 2 를 글 전체 상한으로
    emoji: String(p.mood.copy.emojiPerParagraph[1] * 2),
    sentenceLength: p.mood.copy.sentenceLength === 'short' ? '짧게' : '보통',
    vocabulary: p.industry.vocabulary.join(', '),
    banned: bannedList(ctx),
    keywordTags: keywords.map((k) => `#${k.replace(/\s+/g, '')}`).join(' '),
    hashtagSeeds: p.industry.hashtagSeeds.join(' '),
    voice: ctx.voiceSamples.slice(0, 5).map((v, i) => `예시${i + 1}: """${v.trim()}"""`).join('\n'),
    keyword: keywords[0] ?? '',
    subKeywords: keywords.slice(1).join(', '),
    hasSignature: ctx.settings?.signature?.trim() ? '1' : '',
    noSignature: ctx.settings?.signature?.trim() ? '' : '1',
    hashtagCount: hashtagCount(ctx),
  }
}

export function hashtagCount(ctx: DraftContext): number {
  return Math.min(30, Math.max(0, ctx.settings?.hashtagCount ?? DEFAULT_HASHTAG_COUNT))
}

/** 해시태그 정리 기준: 지역+시술 태그 2개 → 샵 고정 태그 → 모델 제안 → (모자라면) 업종 기본 태그, 정확히 설정 개수 */
export function hashtagOptions(ctx: DraftContext): Parameters<typeof normalizeHashtags>[1] {
  const n = hashtagCount(ctx)
  const keywords = keywordsFor(ctx.preset.industry.keywordPatterns, ctx.shop.region)
  return {
    priority: [...keywords.slice(0, 2).map((k) => k.replace(/\s+/g, '')), ...(ctx.settings?.brandHashtags ?? [])],
    fill: ctx.preset.industry.hashtagSeeds,
    min: n,
    max: n,
  }
}

async function rewriteIfBlocked(ai: AiClient, text: string, findings: Finding[]): Promise<string | null> {
  if (!hasBlocking(findings)) return null
  const tpl = getPrompt('caption-rewrite')
  const { object } = await ai.generate({
    role: 'copy',
    task: 'caption-rewrite',
    schema: Rewrite,
    prompt: renderPrompt(tpl, { findings: describeFindings(findings.filter((f) => f.severity === 'block')), text }),
    temperature: 0.2,
  })
  return object.text
}

async function checkInstagram(ai: AiClient, ctx: DraftContext, d: InstagramDraft) {
  // 해시태그도 정책 검사: 금지(block) 표현이 든 태그는 뺀다
  const tags = normalizeHashtags(d.hashtags, hashtagOptions(ctx)).filter((t) => !hasBlocking(checkText(t, policyInput(ctx))))
  let draft = { ...d, hashtags: tags }
  let findings = checkText(draft.caption, policyInput(ctx))
  let rewritten = false
  const fixed = await rewriteIfBlocked(ai, draft.caption, findings)
  if (fixed) {
    draft = { ...draft, caption: fixed }
    findings = checkText(fixed, policyInput(ctx))
    rewritten = true
  }
  // 샵 고정 안내 문구도 검사한다 (AI 가 쓴 글이 아니라 고치지는 않고 표시만)
  const signature = ctx.settings?.signature?.trim()
  if (signature) findings = [...findings, ...checkText(signature, policyInput(ctx))]
  return {
    draft,
    text: instagramText(draft.caption, draft.hashtags, signature),
    kakao: kakaoText(draft.caption, { name: ctx.shop.name, booking: ctx.shop.booking }),
    findings,
    rewritten,
  }
}

async function checkBlog(ai: AiClient, ctx: DraftContext, d: BlogDraft, keyword: string, photos: number) {
  let draft = fixBlogPhotos(d, photos)
  // 제목에 검색 키워드가 없으면 앞에 붙인다 (네이버 검색 노출의 핵심)
  if (keyword && !draft.title.replace(/\s+/g, '').includes(keyword.replace(/\s+/g, ''))) {
    draft = { ...draft, title: `${keyword} | ${draft.title}` }
  }
  let text = blogText(draft)
  let findings = checkText(text, policyInput(ctx))
  let rewritten = false
  if (hasBlocking(findings)) {
    // 섹션 단위로 고쳐서 구조(소제목·사진 자리)를 지킨다
    const sections = await Promise.all(
      draft.sections.map(async (s) => {
        const f = checkText(s.body, policyInput(ctx))
        const fixed = await rewriteIfBlocked(ai, s.body, f)
        return fixed ? { ...s, body: fixed } : s
      }),
    )
    const title = (await rewriteIfBlocked(ai, draft.title, checkText(draft.title, policyInput(ctx)))) ?? draft.title
    draft = { ...draft, title, sections }
    text = blogText(draft)
    findings = checkText(text, policyInput(ctx))
    rewritten = true
  }
  return { draft, text, findings, rewritten }
}

export async function generateDrafts(
  ai: AiClient,
  ctx: DraftContext,
  opts: { instagram?: number; blog?: number } = {},
): Promise<DraftResult> {
  const igCount = opts.instagram ?? 3
  const blogCount = opts.blog ?? 2
  const vars = baseVars(ctx)
  const igTpl = getPrompt('caption-instagram')
  const blogTpl = getPrompt('caption-blog')
  const keywords = keywordsFor(ctx.preset.industry.keywordPatterns, ctx.shop.region)
  const photos = ctx.media.length

  const [ig, blog] = await Promise.all([
    igCount
      ? ai.generate({ role: 'copy', task: 'caption-instagram', schema: InstagramDrafts, prompt: renderPrompt(igTpl, { ...vars, count: igCount }), temperature: 0.9 })
      : null,
    blogCount
      ? ai.generate({ role: 'copy', task: 'caption-blog', schema: BlogDrafts, prompt: renderPrompt(blogTpl, { ...vars, count: blogCount }), maxOutputTokens: 8000, temperature: 0.8 })
      : null,
  ])

  const instagram = await Promise.all((ig?.object.candidates ?? []).slice(0, igCount).map((d) => checkInstagram(ai, ctx, d)))
  const blogs = await Promise.all((blog?.object.candidates ?? []).slice(0, blogCount).map((d) => checkBlog(ai, ctx, d, keywords[0] ?? '', photos)))

  return {
    instagram,
    blog: blogs,
    keyword: keywords[0] ?? '',
    promptVersions: { instagram: igTpl.ref, blog: blogTpl.ref },
    model: ig?.model ?? blog?.model ?? 'none',
  }
}

// ─── 사진 분석 ────────────────────────────────────────────────────────────────

export async function analyzeImage(
  ai: AiClient,
  image: ImageInput,
  opts: { industryLabel: string; role?: string | null },
): Promise<{ analysis: MediaAnalysis; model: string; prompt: string }> {
  const tpl = getPrompt('media-analysis')
  const { object, model } = await ai.generate({
    role: 'vision',
    task: 'media-analysis',
    schema: MediaAnalysis,
    prompt: renderPrompt(tpl, { industry: opts.industryLabel, role: opts.role ? ROLE_LABELS[opts.role] ?? opts.role : '' }),
    images: [image],
    temperature: 0,
  })
  return { analysis: object, model, prompt: tpl.ref }
}

// ─── 영상 화면 자막 ───────────────────────────────────────────────────────────

export interface SlotCopyRequest {
  index: number
  role: string
  intent: string
  maxChars: number
}

/** 슬롯마다 화면 자막 한 줄. 이모지 제거·글자 수 제한·정책 검사 후, 걸리면 안전한 기본 문구로 대체 */
export async function generateVideoCopy(
  ai: AiClient,
  ctx: DraftContext,
  slots: SlotCopyRequest[],
): Promise<{ lines: Record<number, string>; prompt: string }> {
  const tpl = getPrompt('video-captions')
  const vars = baseVars(ctx)
  const { object } = await ai.generate({
    role: 'copy',
    task: 'video-captions',
    schema: VideoCopy,
    prompt: renderPrompt(tpl, {
      ...vars,
      format: ctx.preset.format.label,
      slots: slots.map((s) => `${s.index}. [${s.role}] ${s.intent} — ${s.maxChars}자 이내`).join('\n'),
    }),
    temperature: 0.7,
  })
  const lines: Record<number, string> = {}
  for (const s of slots) {
    const raw = object.lines.find((l) => l.slot === s.index)?.text ?? ''
    let line = screenLine(raw, s.maxChars)
    if (!line || hasBlocking(checkText(line, policyInput(ctx)))) line = screenLine(defaultSlotLine(s.role, ctx), s.maxChars)
    lines[s.index] = line
  }
  return { lines, prompt: tpl.ref }
}

export function defaultSlotLine(role: string, ctx: DraftContext): string {
  switch (role) {
    case 'cta':
      return ctx.shop.booking ? `${ctx.shop.name} · ${ctx.shop.booking}` : `${ctx.shop.name} 예약 문의`
    case 'before':
      return '시술 전'
    case 'after':
      return '시술 후'
    case 'process':
      return '시술 과정'
    case 'compare':
      return ctx.shop.booking ? `예약 · ${ctx.shop.booking}` : '시술 전 · 후'
    case 'hook':
      return ctx.preset.purpose.label
    default:
      return ctx.preset.industry.label
  }
}
