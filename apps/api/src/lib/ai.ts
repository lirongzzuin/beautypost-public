import { generateText } from 'ai'
import type { BeautyCategory, ToneStyle } from '@beautypost/shared'
import { DEFAULT_HASHTAGS, DEFAULT_PROHIBITED_PHRASES } from '@beautypost/shared'

// Routes through Vercel AI Gateway (OIDC on Vercel, AI_GATEWAY_API_KEY locally)
const MODEL = 'anthropic/claude-sonnet-4.6'

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
추가 해시태그 후보: ${extraHashtags}

JSON으로 응답해주세요:
{"caption": "캡션 내용", "hashtags": ["#태그1", "#태그2", ...]}`

  const { text } = await generateText({ model: MODEL, prompt })

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI response parse error')

  const parsed = JSON.parse(jsonMatch[0]) as { caption: string; hashtags: string[] }
  return {
    caption: parsed.caption ?? '',
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
  }
}

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
- 자연스럽고 진정성 있는 블로그 글투

JSON으로 응답:
{"title": "제목", "body": "본문 내용", "tags": ["태그1", "태그2"]}`

  const { text } = await generateText({ model: MODEL, prompt, maxOutputTokens: 2048 })

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI blog response parse error')

  const parsed = JSON.parse(jsonMatch[0]) as BlogDraft
  return {
    title: parsed.title ?? '',
    body: parsed.body ?? '',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  }
}
