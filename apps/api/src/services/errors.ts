// 원장님에게 보여 줄 한국어 메시지를 가진 오류. 라우트에서 그대로 응답으로 바꾼다.
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
    readonly code: string,
    readonly messageKo: string,
    readonly details?: unknown,
  ) {
    super(messageKo)
  }
}

export function toResponse(e: unknown): { status: ApiError['status']; body: Record<string, unknown> } | null {
  if (e instanceof ApiError) {
    return { status: e.status, body: { code: e.code, message_ko: e.messageKo, ...(e.details ? { details: e.details } : {}) } }
  }
  return null
}
