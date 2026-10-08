export const ERROR_CODES = {
  // Auth
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_EXPIRED_TOKEN: 'AUTH_EXPIRED_TOKEN',
  AUTH_MAGIC_LINK_EXPIRED: 'AUTH_MAGIC_LINK_EXPIRED',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  // Channel
  CHANNEL_NOT_CONNECTED: 'CHANNEL_NOT_CONNECTED',
  CHANNEL_TOKEN_EXPIRED: 'CHANNEL_TOKEN_EXPIRED',
  CHANNEL_PERMISSION_DENIED: 'CHANNEL_PERMISSION_DENIED',
  // Post
  POST_NOT_FOUND: 'POST_NOT_FOUND',
  POST_DAILY_LIMIT_EXCEEDED: 'POST_DAILY_LIMIT_EXCEEDED',
  POST_PUBLISH_FAILED: 'POST_PUBLISH_FAILED',
  // Media
  MEDIA_UPLOAD_FAILED: 'MEDIA_UPLOAD_FAILED',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  MEDIA_INVALID_FORMAT: 'MEDIA_INVALID_FORMAT',
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
  // AI
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
  AI_DAILY_LIMIT_EXCEEDED: 'AI_DAILY_LIMIT_EXCEEDED',
  // Entitlement
  ENTITLEMENT_EXPIRED: 'ENTITLEMENT_EXPIRED',
  ENTITLEMENT_PLAN_REQUIRED: 'ENTITLEMENT_PLAN_REQUIRED',
  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const ERROR_MESSAGES_KO: Record<ErrorCode, string> = {
  AUTH_INVALID_TOKEN: '로그인 정보가 올바르지 않아요. 다시 로그인해주세요.',
  AUTH_EXPIRED_TOKEN: '로그인이 만료됐어요. 다시 로그인해주세요.',
  AUTH_MAGIC_LINK_EXPIRED: '링크가 만료됐어요. 새 링크를 요청해주세요.',
  AUTH_UNAUTHORIZED: '로그인이 필요해요.',
  AUTH_FORBIDDEN: '접근 권한이 없어요.',
  CHANNEL_NOT_CONNECTED: '채널이 연결되지 않았어요. 설정에서 연결해주세요.',
  CHANNEL_TOKEN_EXPIRED: '인스타그램 연결이 만료됐어요. 다시 연결해주세요.',
  CHANNEL_PERMISSION_DENIED: '인스타그램 권한이 부족해요. 비즈니스 계정인지 확인해주세요.',
  POST_NOT_FOUND: '게시물을 찾을 수 없어요.',
  POST_DAILY_LIMIT_EXCEEDED: '오늘 게시 한도를 초과했어요. 내일 다시 시도해주세요.',
  POST_PUBLISH_FAILED: '게시에 실패했어요. 잠시 후 다시 시도해주세요.',
  MEDIA_UPLOAD_FAILED: '사진/영상 업로드에 실패했어요. 다시 시도해주세요.',
  MEDIA_TOO_LARGE: '파일 크기가 너무 커요. 100MB 이하로 줄여주세요.',
  MEDIA_INVALID_FORMAT: '지원하지 않는 파일 형식이에요.',
  MEDIA_NOT_READY: '미디어 처리 중이에요. 잠시만 기다려주세요.',
  AI_GENERATION_FAILED: '문구 생성에 실패했어요. 다시 시도해주세요.',
  AI_DAILY_LIMIT_EXCEEDED: '오늘 생성 한도를 초과했어요. 내일 다시 시도해주세요.',
  ENTITLEMENT_EXPIRED: '체험 기간이 끝났어요. 구독을 시작해주세요.',
  ENTITLEMENT_PLAN_REQUIRED: '이 기능은 구독 후 사용할 수 있어요.',
  VALIDATION_ERROR: '입력 내용을 다시 확인해주세요.',
  NOT_FOUND: '찾을 수 없어요.',
  INTERNAL_ERROR: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
  RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.',
}
