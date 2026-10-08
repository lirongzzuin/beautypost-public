export const APP_VERSION = '1.0.0'
export const API_VERSION = 'v1'

export const BEAUTY_CATEGORY_LABELS: Record<string, string> = {
  eyebrow_tattoo: '눈썹문신',
  lash_perm: '속눈썹펌',
  nail: '네일',
  tattoo: '타투',
  lip_blush: '입술반영구',
  other: '기타',
}

export const TONE_LABELS: Record<string, string> = {
  friendly: '친근한',
  professional: '전문적인',
  trendy: '트렌디한',
}

export const CHANNEL_LABELS: Record<string, string> = {
  instagram: '인스타그램',
  naver_blog: '네이버 블로그',
}

// 게시 주제 (create-post step2)
export const POST_THEMES = [
  { id: 'review', label: '시술 후기', icon: 'favorite', desc: '고객 감동 리뷰' },
  { id: 'before_after', label: '전후 비교', icon: 'compare', desc: '확연한 비포/애프터' },
  { id: 'event', label: '이벤트·할인', icon: 'loyalty', desc: '이달의 혜택 알림' },
  { id: 'care_guide', label: '관리 방법 안내', icon: 'spa', desc: '시술 후 홈케어 팁' },
  { id: 'shop_intro', label: '매장 소개', icon: 'storefront', desc: '원장님 감성 공간' },
  { id: 'booking_notice', label: '예약 안내', icon: 'event_available', desc: '예약 현황 및 공지' },
] as const

export const CAPTION_TONES = [
  { id: 'friendly', label: '친근한', desc: '인스타 감성 톤' },
  { id: 'informative', label: '정보형', desc: '시술 신뢰도 강조' },
  { id: 'emotional', label: '감성형', desc: '고객 공감 표현' },
] as const

// 업종별 금지어 (과장 광고 방지) — 설정으로 분리 가능
export const DEFAULT_PROHIBITED_PHRASES = [
  '100% 효과',
  '영구적',
  '완전히 제거',
  '부작용 없음',
  '세계 최고',
  '최저가',
]

// 업종별 기본 해시태그
export const DEFAULT_HASHTAGS: Record<string, string[]> = {
  eyebrow_tattoo: ['#눈썹문신', '#반영구눈썹', '#자연눈썹', '#눈썹문신후기'],
  lash_perm: ['#속눈썹펌', '#자연속눈썹', '#속눈썹연장', '#뷰티살롱'],
  nail: ['#네일아트', '#네일살롱', '#젤네일', '#네일디자인'],
  tattoo: ['#타투', '#타투이스트', '#tattoo', '#타투샵'],
  lip_blush: ['#입술반영구', '#립블러쉬', '#반영구화장'],
  other: ['#뷰티살롱', '#뷰티케어', '#뷰티시술'],
}

// 엔타이틀먼트 기본값
export const DEFAULT_TRIAL_DAYS = 30
export const TRIAL_EXPIRY_WARNING_DAYS = 7

// 미디어 제한
export const MAX_MEDIA_PER_POST = 10
export const MAX_VIDEO_DURATION_SECONDS = 60
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100MB

// 일일 생성 한도 (비용 가드레일)
export const DAILY_AI_GENERATION_LIMIT = 20
export const DAILY_RENDER_LIMIT = 5

// 예약 발행 최소 선행 시간 (분)
export const SCHEDULE_MIN_LEAD_MINUTES = 10
