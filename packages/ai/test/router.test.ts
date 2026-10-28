import { describe, expect, it } from 'vitest'
import { APICallError } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { AiUnavailableError, createAiClient, describeFailure, type Candidate } from '../src/index.js'

// 모델 후보 순회 규칙: 한도(429)는 짧게 기다렸다 한 번 더, 결제 수단 없음은 건너뛰기, 실패 원인은 AiUnavailableError 로

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [] }
}

function apiError(status: number, message: string) {
  return new APICallError({ message, url: 'https://x', requestBodyValues: {}, statusCode: status, isRetryable: status === 429 })
}

/** 실제 운영 로그에 남은 Gemini 무료 등급 한도 메시지 */
const QUOTA = 'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash. Please retry in 1.2s.'
const BILLING = 'AI Gateway requires a valid credit card on file to service requests.'

function model(steps: (() => ReturnType<typeof ok>)[]) {
  let i = 0
  const m = new MockLanguageModelV3({ doGenerate: async () => steps[Math.min(i++, steps.length - 1)]!() })
  return { m, calls: () => i }
}

const schema = z.object({ a: z.number() })
const req = { role: 'copy' as const, task: 't', schema, prompt: 'p' }

describe('describeFailure', () => {
  it('Gemini 무료 등급 한도: quota + 다시 될 때까지 초', () => {
    expect(describeFailure(apiError(429, QUOTA))).toMatchObject({ quota: true, billing: false, retryAfterSec: 2 })
  })
  it('AI Gateway 카드 미등록은 billing', () => {
    expect(describeFailure(new Error(BILLING))).toMatchObject({ quota: false, billing: true })
  })
})

describe('ModelRouterClient', () => {
  it('한도에 걸리면 알려 준 시간만큼 기다렸다가 같은 모델로 한 번 더', async () => {
    const g = model([
      () => {
        throw apiError(429, QUOTA)
      },
      () => ok('{"a":1}'),
    ])
    const ai = createAiClient({ candidates: () => [{ name: 'g', model: g.m } as Candidate] })
    const t0 = Date.now()
    expect((await ai.generate(req)).object).toEqual({ a: 1 })
    expect(g.calls()).toBe(2)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500)
  })

  it('계속 한도면 AiUnavailableError(quota) — 결제 수단 없는 예비 모델은 다음부터 건너뛴다', async () => {
    const g = model([
      () => {
        throw apiError(429, QUOTA.replace('1.2s', '50s'))
      },
    ])
    const gw = model([
      () => {
        throw apiError(403, BILLING)
      },
    ])
    const ai = createAiClient({ candidates: () => [{ name: 'g2', model: g.m } as Candidate, { name: 'gw', model: gw.m } as Candidate] })
    const err = await ai.generate(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiUnavailableError)
    expect((err as AiUnavailableError).reason).toBe('quota')
    expect((err as AiUnavailableError).retryAfterSec).toBe(50)
    expect(g.calls()).toBe(1) // 50초는 기다리지 않는다
    expect(gw.calls()).toBe(1)
    await ai.generate(req).catch(() => undefined)
    expect(gw.calls()).toBe(1) // 건너뜀
  })

  it('일시적인 서버 오류는 한 번 더, 그래도 안 되면 다음 후보', async () => {
    const a = model([
      () => {
        throw apiError(500, 'internal')
      },
    ])
    const b = model([() => ok('{"a":2}')])
    const ai = createAiClient({ candidates: () => [{ name: 'a', model: a.m } as Candidate, { name: 'b', model: b.m } as Candidate] })
    const r = await ai.generate(req)
    expect(r).toEqual({ object: { a: 2 }, model: 'b' })
    expect(a.calls()).toBe(2)
  })
})
