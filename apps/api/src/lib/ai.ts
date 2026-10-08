import { generateObject } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { BeautyCategory, ToneStyle } from '@beautypost/shared'
import { DEFAULT_HASHTAGS, DEFAULT_PROHIBITED_PHRASES } from '@beautypost/shared'

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

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
const GATEWAY_MODEL = process.env.AI_FALLBACK_MODEL ?? 'anthropic/claude-sonnet-4.6'

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
  prohibitedPhrases?: string[]
  customHashtags?: string[]
}

export interface GeneratedContent {
  caption: string
  hashtags: string[]
}

export async function generateCaption(input: GenerateCaptionInput): Promise<GeneratedContent> {
  const prohibited = [...DEFAULT_PROHIBITED_PHRASES, ...(input.prohibitedPhrases ?? [])]
  const categoryHashtags = DEFAULT_HASHTAGS[input.category] ?? DEFAULT_HASHTAGS['other'] ?? []
  const extraHashtags = input.customHashtags?.join(', ') ?? ''

  const toneDesc = {
    friendly: '친근하고 따뜻한 말투, 이모지 적극 활용, 고객과 친구처럼',
    professional: '전문적이고 신뢰감 있는 말투, 시술 효과와 기술을 강조',
    trendy: '트렌디하고 감각적인 말투, MZ 세대 감성, 짧고 임팩트 있게',
  }[input.tone]

  const prompt = `당신은 뷰티 자영업자를 위한 SNS 마케터입니다.
가게명: ${input.shopName}
업종: ${input.category}
게시 주제: ${input.theme}
${input.keywords ? `키워드: ${input.keywords}` : ''}
말투: ${toneDesc}
금지 표현: ${prohibited.join(', ')}

다음 조건에 맞는 인스타그램 캡션을 작성해주세요:
- 200~300자 이내
- 줄바꿈을 활용해 읽기 편하게
- 마지막 줄에 CTA(행동 유도) 포함
- 금지 표현 절대 사용 금지
- 과장 광고 없이 진실되게

그리고 적절한 해시태그 10~15개를 선택해주세요.
기본 해시태그: ${categoryHashtags.join(', ')}
추가 해시태그 후보: ${extraHashtags}`

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
