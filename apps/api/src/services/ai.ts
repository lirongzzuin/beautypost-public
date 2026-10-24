import { createAiClient, isMockMode, type AiClient } from '@beautypost/ai'
import { mockResponder } from '@beautypost/caption'

// AI 클라이언트 하나를 앱 전체가 공유한다. AI_PROVIDER=mock 이면 키 없이 결정적 응답 (로컬·테스트).
let client: AiClient | null = null

export function getAi(): AiClient {
  client ??= createAiClient(isMockMode() ? { mock: mockResponder } : {})
  return client
}

export function setAi(c: AiClient | null): void {
  client = c
}
