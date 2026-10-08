import { generateObject } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { BeautyCategory, ToneStyle } from '@beautypost/shared'
import { DEFAULT_HASHTAGS, DEFAULT_PROHIBITED_PHRASES, SERVICE_CATALOG } from '@beautypost/shared'

// ─── Provider strategy ───────────────────────────────────────────────────────
// Primary:  Google Gemini free tier — genuinely free (≈1,500 req/day), activated
//           by setting GOOGLE_GENERATIVE_AI_API_KEY. Cost = 0 for early volume.
// Fallback: Vercel AI Gateway → Claude, which runs on Vercel's free monthly
//           credits. Used automatically when Gemini is absent, rate-limited, or
//           errors. This keeps generation working no matter what.
//
// A self-hosted/installed LLM was considered and rejected: it cannot run inside
// Vercel serverless functions (no GPU, multi-GB weights, 300s limit) and a
// dedicated GPU host costs far more than these free tiers at early scale.

// Defaults current as of 2026-10. Both are overridable via env.
// Gemini 3.8 Flash — latest stable free-tier Flash (GA 2026-09-02). For the
// strictest free guarantee use 'gemini-3.5-flash-lite'.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'
// Gateway slugs use dots for versions: anthropic/claude-sonnet-5.5
const GATEWAY_MODEL = process.env.AI_FALLBACK_MODEL ?? 'anthropic/claude-sonnet-5.5'

interface Candidate {
  name: string
  model: LanguageModel
}

// Ordered list of models to try. Gemini first (free), gateway second (fallback).
function getCandidates(): Candidate[] {
  const candidates: Candidate[] = []

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
    candidates.push({ name: `gemini:${GEMINI_MODEL}`, model: google(GEMINI_MODEL) })
  }

  // String model id routes through the Vercel AI Gateway automatically (OIDC on
  // Vercel, AI_GATEWAY_API_KEY locally). Always available as a fallback.
  candidates.push({ name: `gateway:${GATEWAY_MODEL}`, model: GATEWAY_MODEL })

  return candidates
}

// Run generateObject against each candidate in order, returning the first
// success. Only the final error propagates if all providers fail.
async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  prompt: string,
  maxOutputTokens?: number,
): Promise<T> {
  const candidates = getCandidates()
  let lastError: unknown

  for (const { name, model } of candidates) {
    try {
      const { object } = await generateObject({
        model,
        schema,
        prompt,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
      })
      return object
    } catch (err) {
      console.error(`[AI] provider "${name}" failed:`, err instanceof Error ? err.message : err)
      lastError = err
    }
  }

  throw lastError ?? new Error('No AI provider available')
}

// ─── Caption generation ──────────────────────────────────────────────────────

const captionSchema = z.object({
  caption: z.string().describe('인스타그램 캡션 본문 (200~300자, 줄바꿈 포함)'),
  hashtags: z.array(z.string()).describe('해시태그 10~15개, 각 항목은 # 포함'),
})

export interface GenerateCaptionInput {
  theme: string
  keywords?: string
  category: BeautyCategory
  tone: ToneStyle
  shopName: string
  region?: string
  /** SERVICE_CATALOG keys selected by the shop. */
  services?: string[]
  /** Free-text services the shop added. */
  customServices?: string[]
  /** Customer name to weave into a review post (후기). */
  customerName?: string
  /** Up to N of this account's preferred past captions, used as style few-shot. */
  styleExamples?: string[]
  prohibitedPhrases?: string[]
  customHashtags?: string[]
}

export interface GeneratedContent {
  caption: string
  hashtags: string[]
}

const THEME_GUIDE: Record<string, string> = {
  review: '고객 시술 후기. 고객의 고민→시술→만족스러운 변화 흐름. 실제 겪은 일처럼 생생하게. 고객 이름이 주어지면 "○○님" 호칭으로 자연스럽게 녹여라.',
  before_after: '전/후 변화가 주인공. 어떤 점이 어떻게 달라졌는지 구체적으로. 과장 없이 사실 기반.',
  event: '이벤트·할인 안내. 혜택과 기간을 명확히, 부담 없이 방문 유도. 마감 임박 느낌은 살리되 거짓 긴박감 금지.',
  care_guide: '시술 후 홈케어·관리 팁. 원장님이 알려주는 전문가 꿀팁 느낌. 저장하고 싶은 유용한 정보.',
  shop_intro: '매장·원장 소개. 공간 분위기와 철학, 믿고 맡길 수 있는 이유를 감성적으로.',
  booking_notice: '예약 안내·공지. 예약 방법과 현황을 친절하고 깔끔하게.',
}

export async function generateCaption(input: GenerateCaptionInput): Promise<GeneratedContent> {
  const prohibited = [...DEFAULT_PROHIBITED_PHRASES, ...(input.prohibitedPhrases ?? [])]

  // Gather selected-service definitions for hashtags + domain style hints.
  const defs = (input.services ?? [])
    .map((k) => SERVICE_CATALOG.find((s) => s.key === k))
    .filter(Boolean) as (typeof SERVICE_CATALOG)[number][]
  const serviceLabels = [...defs.map((d) => d.label), ...(input.customServices ?? [])]
  const serviceLine = serviceLabels.length ? serviceLabels.join(', ') : '뷰티 시술'
  const styleHints = defs.length
    ? defs.map((d) => `· ${d.label}: ${d.style}`).join('\n')
    : ''

  const catalogHashtags = defs.flatMap((d) => d.hashtags)
  const fallbackHashtags = DEFAULT_HASHTAGS[input.category] ?? DEFAULT_HASHTAGS['other'] ?? []
  const seedHashtags = [...new Set([...catalogHashtags, ...fallbackHashtags, ...(input.customHashtags ?? [])])]

  const toneDesc = {
    friendly: '친근하고 따뜻한 말투. 이모지는 과하지 않게 포인트로. 단골에게 말 걸듯',
    professional: '차분하고 전문적인 말투. 시술 디테일과 신뢰를 중심으로',
    trendy: '감각적이고 트렌디한 말투. 짧은 호흡, MZ 감성, 군더더기 없이',
  }[input.tone]

  const themeGuide = THEME_GUIDE[input.theme] ?? `게시 주제: ${input.theme}`
  const customerLine = input.customerName
    ? `\n고객 이름: ${input.customerName} (후기 글에 "${input.customerName}님"으로 자연스럽게 등장시켜라. 개인정보는 이름 외엔 쓰지 마라.)`
    : ''

  // Few-shot personalization: mimic the account's own preferred past captions.
  const examples = (input.styleExamples ?? []).filter((t) => t && t.trim()).slice(0, 5)
  const styleExampleBlock = examples.length
    ? `\n\n[이 계정이 좋아하는 글 스타일 — 아래 예시들의 말투·길이·리듬·이모지 사용을 그대로 닮게 써라. 내용은 베끼지 말고 이번 주제로 새로 써라]\n${examples.map((e, i) => `예시${i + 1}: """${e.trim()}"""`).join('\n')}`
    : ''

  const prompt = `너는 뷰티샵 ${input.shopName} 원장님의 인스타그램을 10년째 운영해 온 현지 SNS 담당자다.
${input.region ? `지역: ${input.region}` : ''}
제공 서비스: ${serviceLine}
${styleHints ? `업종별 포인트:\n${styleHints}` : ''}

이번 글 주제: ${themeGuide}${customerLine}
${input.keywords ? `꼭 반영할 키워드: ${input.keywords}` : ''}
말투: ${toneDesc}

[잘 나가는 뷰티 인스타 글의 특징 — 반드시 지켜라]
- 첫 줄에서 바로 눈길을 끈다 (질문·공감·상황 묘사 중 하나). 인삿말·자기소개로 시작하지 마라.
- 광고티 나는 상투적 표현 금지: "안녕하세요 원장입니다", "최고의", "믿고 맡겨주세요", "많은 관심 부탁드립니다" 같은 뻔한 문구 쓰지 마라.
- AI가 쓴 티 나는 번역투·격식체 금지. 실제 한국 뷰티샵 사장님이 폰으로 쓴 것처럼 구어체로.
- 짧은 문장과 줄바꿈으로 리듬감 있게. 문단당 1~2줄.
- 이모지는 문장을 대체하지 말고 감정 포인트에만 1~3개.
- 구체적인 디테일 하나 이상 (컬러명·시술 과정·지속기간·고객 반응 등).
- 마지막은 부담 없는 행동 유도 한 줄 (예약·DM·저장 등). 단, 매번 같은 말 반복 금지.
- 전체 180~320자. 금지 표현 절대 사용 금지: ${prohibited.join(', ')}

해시태그는 10~15개. 아래를 참고하되 지역·시술 특화 태그를 섞어 자연스럽게:
${seedHashtags.join(', ')}${styleExampleBlock}`

  const result = await generateWithFallback(captionSchema, prompt)
  return {
    caption: result.caption ?? '',
    hashtags: Array.isArray(result.hashtags) ? result.hashtags : [],
  }
}

// ─── Blog draft generation ───────────────────────────────────────────────────

const blogSchema = z.object({
  title: z.string().describe('SEO 친화적 제목, 30자 이내'),
  body: z.string().describe('블로그 본문 600~1000자, 소제목 포함'),
  tags: z.array(z.string()).describe('태그 3~7개, # 없이'),
})

export interface GenerateBlogDraftInput {
  caption: string
  hashtags: string[]
  theme: string
  shopName: string
  category: BeautyCategory
}

export interface BlogDraft {
  title: string
  body: string
  tags: string[]
}

export async function generateBlogDraft(input: GenerateBlogDraftInput): Promise<BlogDraft> {
  const prompt = `다음 인스타그램 캡션을 네이버 블로그 포스팅으로 변환해주세요.

가게명: ${input.shopName}
업종: ${input.category}
주제: ${input.theme}
인스타 캡션: ${input.caption}
해시태그: ${input.hashtags.join(' ')}

조건:
- 제목은 SEO에 적합하게 (키워드 포함, 30자 이내)
- 본문은 600~1000자, 소제목 포함, 블로그 감성
- 태그는 3~7개 (해시태그 # 없이)
- 자연스럽고 진정성 있는 블로그 글투`

  const result = await generateWithFallback(blogSchema, prompt, 2048)
  return {
    title: result.title ?? '',
    body: result.body ?? '',
    tags: Array.isArray(result.tags) ? result.tags : [],
  }
}
