import { generateText, Output, type LanguageModel, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { z } from 'zod'

// AI 모델 호출의 단일 관문. 다른 모듈은 AiClient 인터페이스만 안다 (제공자 교체는 설정으로).
//
// 역할(role)별 후보 모델을 순서대로 시도한다. 기본값:
//   1) Google Gemini (GOOGLE_GENERATIVE_AI_API_KEY 가 있을 때, 무료 티어)
//   2) Vercel AI Gateway → Claude (Vercel 에서는 OIDC, 로컬은 AI_GATEWAY_API_KEY)
// 덮어쓰기: AI_MODELS_<ROLE>="gemini:gemini-3.8-flash,gateway:anthropic/claude-sonnet-5.5"
// 테스트·키 없는 로컬: AI_PROVIDER=mock 또는 createAiClient({ mock })

export type AiRole = 'vision' | 'copy'

export interface ImageInput {
  data: Uint8Array
  mediaType: string
}

export interface StructuredRequest<T> {
  role: AiRole
  /** 목 응답기가 어떤 요청인지 구분할 이름 (예: 'media-analysis', 'caption') */
  task: string
  schema: z.ZodType<T>
  system?: string
  prompt: string
  images?: ImageInput[]
  maxOutputTokens?: number
  temperature?: number
}

export interface StructuredResult<T> {
  object: T
  /** 실제로 응답한 모델 (생성 기록용) */
  model: string
}

export interface AiClient {
  generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>
}

export type MockResponder = (req: StructuredRequest<unknown>) => unknown | Promise<unknown>

interface Candidate {
  name: string
  model: LanguageModel
}

const DEFAULTS: Record<AiRole, string> = {
  vision: `gemini:${process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'},gateway:${process.env.AI_FALLBACK_MODEL ?? 'anthropic/claude-sonnet-5.5'}`,
  copy: `gemini:${process.env.GEMINI_MODEL ?? 'gemini-3.8-flash'},gateway:${process.env.AI_FALLBACK_MODEL ?? 'anthropic/claude-sonnet-5.5'}`,
}

export function parseModelList(spec: string): { provider: string; id: string }[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':')
      if (i < 1) throw new Error(`모델 지정 형식은 provider:model 이에요: "${s}"`)
      return { provider: s.slice(0, i), id: s.slice(i + 1) }
    })
}

function candidatesFor(role: AiRole): Candidate[] {
  const spec = process.env[`AI_MODELS_${role.toUpperCase()}`] ?? DEFAULTS[role]
  const out: Candidate[] = []
  for (const { provider, id } of parseModelList(spec)) {
    if (provider === 'gemini') {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) continue
      const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
      out.push({ name: `gemini:${id}`, model: google(id) })
    } else if (provider === 'gateway') {
      // 문자열 모델 id 는 AI SDK 가 Vercel AI Gateway 로 보낸다
      out.push({ name: `gateway:${id}`, model: id })
    } else {
      throw new Error(`알 수 없는 AI 제공자: ${provider}`)
    }
  }
  return out
}

function toMessages(req: StructuredRequest<unknown>): ModelMessage[] {
  if (!req.images?.length) return [{ role: 'user', content: req.prompt }]
  return [
    {
      role: 'user',
      content: [
        ...req.images.map((img) => ({ type: 'image' as const, image: img.data, mediaType: img.mediaType })),
        { type: 'text' as const, text: req.prompt },
      ],
    },
  ]
}

class ModelRouterClient implements AiClient {
  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const candidates = candidatesFor(req.role)
    let lastError: unknown
    for (const { name, model } of candidates) {
      try {
        // AI SDK v6: generateObject 는 deprecated → generateText + Output.object
        const { output } = await generateText({
          model,
          output: Output.object({ schema: req.schema }),
          system: req.system,
          messages: toMessages(req as StructuredRequest<unknown>),
          ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        })
        return { object: output as T, model: name }
      } catch (err) {
        console.error(`[AI] ${req.task}: "${name}" 실패:`, err instanceof Error ? err.message : err)
        lastError = err
      }
    }
    throw lastError ?? new Error('사용할 수 있는 AI 모델이 없어요')
  }
}

class MockClient implements AiClient {
  constructor(private readonly respond: MockResponder) {}
  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const raw = await this.respond(req as StructuredRequest<unknown>)
    // 실제 모델과 똑같이 스키마 검증을 거친다 (목 응답이 스키마와 어긋나면 테스트가 잡도록)
    return { object: req.schema.parse(raw), model: 'mock' }
  }
}

export function createAiClient(opts: { mock?: MockResponder } = {}): AiClient {
  if (opts.mock) return new MockClient(opts.mock)
  return new ModelRouterClient()
}

export function isMockMode(): boolean {
  return process.env.AI_PROVIDER === 'mock'
}
