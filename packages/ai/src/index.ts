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
//
// 속도: Gemini 3 계열은 기본으로 길게 "생각"한 뒤 답한다 (글 하나에 20~40초). 이 서비스의 작업(사진 관찰 기록·글 초안)은
// 추론이 거의 필요 없어 AI_THINKING=minimal(기본)로 끈다. 호출마다 걸린 시간을 로그로 남긴다 ([AI] 작업 모델 n.n초).

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

export interface Candidate {
  name: string
  model: LanguageModel
  providerOptions?: Record<string, Record<string, JSONValue>>
}

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }

/** Gemini 생각(추론) 수준. 3.x 는 thinkingLevel, 2.5 는 thinkingBudget(0 = 끔) */
function geminiThinking(id: string): Record<string, JSONValue> | undefined {
  const level = (process.env.AI_THINKING ?? 'minimal') as 'minimal' | 'low' | 'medium' | 'high' | 'default'
  if (level === 'default') return undefined
  const pro = /pro/i.test(id) // Pro 모델은 생각을 끌 수 없다 (minimal·0 을 거부) → 가장 낮은 값으로
  if (/^gemini-2\./.test(id)) return { thinkingConfig: { thinkingBudget: level === 'minimal' ? (pro ? 128 : 0) : level === 'low' ? 512 : 2048 } }
  return { thinkingConfig: { thinkingLevel: pro && level === 'minimal' ? 'low' : level } }
}

/** 한 모델이 오래 응답하지 않으면 다음 후보로 넘어간다 */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45_000)

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
      const thinking = geminiThinking(id)
      out.push({ name: `gemini:${id}`, model: google(id), providerOptions: thinking ? { google: thinking } : undefined })
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

/** 지금 AI 를 쓸 수 없음. reason=quota 는 사용량 한도(무료 등급 분당 요청 수 등), error 는 그 밖의 실패 */
export class AiUnavailableError extends Error {
  constructor(
    readonly reason: 'quota' | 'error',
    /** 한도라면 몇 초 뒤에 다시 될지 (제공자가 알려 준 값, 모르면 null) */
    readonly retryAfterSec: number | null,
    readonly cause?: unknown,
  ) {
    super(reason === 'quota' ? 'AI 사용량 한도에 걸렸어요' : 'AI 응답을 받지 못했어요')
    this.name = 'AiUnavailableError'
  }
}

interface FailureInfo {
  quota: boolean
  /** 결제 수단이 없어 아예 못 쓰는 상태 (예: AI Gateway 카드 미등록) */
  billing: boolean
  retryAfterSec: number | null
  timeout: boolean
}

export function describeFailure(err: unknown): FailureInfo {
  const parts: string[] = []
  let status: number | undefined
  for (let e: unknown = err, i = 0; e && i < 5; i++) {
    const o = e as { message?: string; statusCode?: number; responseBody?: string; lastError?: unknown; cause?: unknown; name?: string }
    parts.push(String(o.message ?? ''), String(o.responseBody ?? ''), String(o.name ?? ''))
    status ??= o.statusCode
    e = o.lastError ?? o.cause
  }
  const text = parts.join(' ')
  const retry = text.match(/retry in ([\d.]+)\s*s/i) ?? text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/)
  return {
    quota: status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(text),
    billing: /credit card|billing account|payment method/i.test(text) && !/quota/i.test(text),
    retryAfterSec: retry ? Math.ceil(Number(retry[1])) : null,
    timeout: /timeout|aborted/i.test(text),
  }
}

/** 한도에 걸렸을 때 이 시간(초) 안에 풀린다고 하면 기다렸다가 한 번 더 (요청 하나가 너무 길어지지 않게 짧게) */
const QUOTA_WAIT_MAX_SEC = Number(process.env.AI_QUOTA_WAIT_SEC ?? 20)
/** 결제 수단이 없어 실패한 모델은 한동안 건너뛴다 (매 요청 1초씩 버리지 않게) */
const BILLING_SKIP_MS = 10 * 60_000
const skipUntil = new Map<string, number>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class ModelRouterClient implements AiClient {
  constructor(private readonly candidatesOf: (role: AiRole) => Candidate[] = candidatesFor) {}

  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const candidates = this.candidatesOf(req.role).filter((c) => (skipUntil.get(c.name) ?? 0) < Date.now())
    let lastError: unknown
    let quotaRetry: number | null | undefined // undefined = 한도 때문에 실패한 모델 없음
    for (const { name, model, providerOptions } of candidates) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const t0 = Date.now()
        try {
          // AI SDK v6: generateObject 는 deprecated → generateText + Output.object
          // 재시도는 아래에서 직접 한다 (SDK 재시도는 한도 초과에도 바로 다시 보내 한도를 더 쓴다)
          const { output } = await generateText({
            model,
            output: Output.object({ schema: req.schema }),
            system: req.system,
            messages: toMessages(req as StructuredRequest<unknown>),
            providerOptions,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(TIMEOUT_MS),
            ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          })
          console.log(`[AI] ${req.task} ${name} ${((Date.now() - t0) / 1000).toFixed(1)}초`)
          return { object: output as T, model: name }
        } catch (err) {
          const f = describeFailure(err)
          console.error(`[AI] ${req.task}: "${name}" 실패 (${((Date.now() - t0) / 1000).toFixed(1)}초, ${attempt}번째):`, err instanceof Error ? err.message.slice(0, 300) : err)
          lastError = err
          if (f.billing) {
            skipUntil.set(name, Date.now() + BILLING_SKIP_MS)
            break
          }
          if (f.quota) {
            quotaRetry = Math.min(quotaRetry ?? Infinity, f.retryAfterSec ?? 60)
            if (attempt === 1 && f.retryAfterSec !== null && f.retryAfterSec <= QUOTA_WAIT_MAX_SEC) {
              await sleep(f.retryAfterSec * 1000 + 500)
              continue
            }
            break
          }
          if (f.timeout || attempt === 2) break
          await sleep(800) // 일시적인 서버 오류는 한 번 더
        }
      }
    }
    if (quotaRetry !== undefined) throw new AiUnavailableError('quota', Number.isFinite(quotaRetry) ? quotaRetry : null, lastError)
    throw new AiUnavailableError('error', null, lastError ?? new Error('사용할 수 있는 AI 모델이 없어요'))
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

/** candidates: 테스트에서 모델 후보를 직접 줄 때 (실제 호출·재시도·건너뛰기 규칙을 그대로 탄다) */
export function createAiClient(opts: { mock?: MockResponder; candidates?: (role: AiRole) => Candidate[] } = {}): AiClient {
  if (opts.mock) return new MockClient(opts.mock)
  return new ModelRouterClient(opts.candidates)
}

export function isMockMode(): boolean {
  return process.env.AI_PROVIDER === 'mock'
}
