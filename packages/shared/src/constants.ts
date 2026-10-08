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

// 확장 서비스 카탈로그 — 원장님은 여러 서비스를 동시에 선택할 수 있다.
// `style`은 AI 캡션 생성 시 업종별 "실제 잘나가는 게시글" 톤을 유도하는 힌트.
// `category`는 하위호환용 기존 enum 매핑(해시태그/통계용).
export interface ServiceDef {
  key: string
  label: string
  category: string // maps to BeautyCategory enum for backward compat
  hashtags: string[]
  style: string
}

export const SERVICE_CATALOG: ServiceDef[] = [
  {
    key: 'eyebrow_tattoo', label: '눈썹문신', category: 'eyebrow_tattoo',
    hashtags: ['#눈썹문신', '#반영구눈썹', '#자연눈썹', '#눈썹문신추천'],
    style: '얼굴형·눈매에 맞춘 디자인 설명, 자연스러움·지속력 강조, 시술 과정 신뢰감',
  },
  {
    key: 'lash', label: '속눈썹', category: 'lash_perm',
    hashtags: ['#속눈썹연장', '#속눈썹펌', '#자연속눈썹', '#속눈썹추천'],
    style: '눈매 또렷해지는 변화, 자연스러운 컬·볼륨, 데일리 편안함 강조',
  },
  {
    key: 'nail', label: '네일아트', category: 'nail',
    hashtags: ['#네일아트', '#젤네일', '#네일디자인', '#손끝완성'],
    style: '시즌·트렌드 컬러, 디자인 디테일, 손끝 분위기, 지속력',
  },
  {
    key: 'skincare', label: '피부미용', category: 'other',
    hashtags: ['#피부관리', '#피부미용', '#스킨케어', '#피부관리실'],
    style: '피부 고민별 솔루션, 관리 후 결·톤 변화, 꾸준한 관리 루틴 제안',
  },
  {
    key: 'hair', label: '헤어', category: 'other',
    hashtags: ['#헤어', '#염색', '#펌', '#헤어스타일'],
    style: '얼굴형·모질에 맞춘 스타일 제안, 컬러·펌 변화, 손질 편함',
  },
  {
    key: 'makeup', label: '메이크업', category: 'other',
    hashtags: ['#메이크업', '#웨딩메이크업', '#데일리메이크업', '#메이크업샵'],
    style: 'TPO별 룩 제안, 이목구비 살리는 포인트, 지속력·화사함',
  },
  {
    key: 'tattoo', label: '타투', category: 'tattoo',
    hashtags: ['#타투', '#타투이스트', '#tattoo', '#감성타투'],
    style: '도안의 의미·감성, 디테일, 위생·아프지 않은 시술, 아티스트 색깔',
  },
  {
    key: 'semi_permanent', label: '반영구', category: 'lip_blush',
    hashtags: ['#반영구', '#반영구화장', '#자연반영구', '#반영구추천'],
    style: '자연스러운 발색, 생기 더하는 효과, 번짐 없는 데일리, 지속력',
  },
  {
    key: 'lip_blush', label: '입술반영구', category: 'lip_blush',
    hashtags: ['#입술반영구', '#립블러쉬', '#입술반영구추천'],
    style: '혈색·생기, 자연스러운 톤, 번짐 없음, 화장 시간 단축',
  },
  {
    key: 'waxing', label: '왁싱', category: 'other',
    hashtags: ['#왁싱', '#브라질리언왁싱', '#왁싱샵', '#위생왁싱'],
    style: '위생·프라이버시 강조, 매끈함·관리 주기, 편안한 분위기',
  },
  {
    key: 'skin_lifting', label: '피부·리프팅', category: 'other',
    hashtags: ['#리프팅', '#피부탄력', '#동안관리', '#탄력관리'],
    style: '탄력·윤곽 변화, 즉각 효과+누적 효과, 꾸준한 관리 권유',
  },
]

export const SERVICE_LABELS: Record<string, string> = Object.fromEntries(
  SERVICE_CATALOG.map((s) => [s.key, s.label]),
)

export function getServiceDef(key: string): ServiceDef | undefined {
  return SERVICE_CATALOG.find((s) => s.key === key)
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

// 스타일 예시(few-shot) 계정당 최대 개수 — 프롬프트 크기/비용 가드레일
export const STYLE_EXAMPLE_LIMIT = 5

// 일일 생성 한도 (비용 가드레일)
export const DAILY_AI_GENERATION_LIMIT = 20
export const DAILY_RENDER_LIMIT = 5

// 예약 발행 최소 선행 시간 (분)
export const SCHEDULE_MIN_LEAD_MINUTES = 10
