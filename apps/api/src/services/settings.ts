import { z } from 'zod'

// 샵 단위 콘텐츠 설정 (brand_profiles.content_settings). 레퍼런스 계정들이 매 글마다 똑같이 붙이는 요소를 원장님이 한 번만 정한다.

export const ContentSettings = z.object({
  /** 모든 인스타 글 끝에 그대로 붙는 고정 안내 (예약 방법·위치·주차 등). 빈 값이면 AI 가 마지막 줄에 예약 안내를 쓴다 */
  signature: z.string().max(600).default(''),
  /** 해시태그 개수 (레퍼런스 계정들은 3~5개) */
  hashtagCount: z.number().int().min(0).max(30).default(5),
  /** 매번 넣을 해시태그 (예: #마이샵) */
  brandHashtags: z.array(z.string().max(41)).max(10).default([]), // '#' 포함
  /** 영상 워터마크에 쓸 인스타 아이디 (예: @example_shop). 비우면 샵 이름 */
  instagramHandle: z.string().max(41).default(''), // '@' 포함
  /** 얼굴 가림(블러) 사용. 기본은 끔 — 시술 부위까지 흐려지기 쉬워서, 쓰려면 설정에서 켠다 */
  allowFaceBlur: z.boolean().default(false),
})
export type ContentSettings = z.infer<typeof ContentSettings>

export function parseSettings(raw: unknown): ContentSettings {
  const r = ContentSettings.safeParse(raw ?? {})
  return r.success ? r.data : ContentSettings.parse({})
}

/** "#a #b, c" → ["#a", "#b", "#c"] */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.flatMap((t) => t.split(/[\s,]+/)).map((t) => t.replace(/^#+/, '').trim()).filter(Boolean).map((t) => `#${t}`))].slice(0, 10)
}

export function normalizeHandle(h: string): string {
  const v = h.trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')
  return v ? `@${v}` : ''
}
