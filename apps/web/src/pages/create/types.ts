import type { Media } from '~/api/content'

export type Step = 1 | 2 | 3 | 4

/** 올리는 중이거나 올린 파일 하나 */
export interface Item {
  localId: string
  role: string
  kind: 'image' | 'video'
  preview: string
  name: string
  progress: number
  media?: Media
  analyzing?: boolean
  /** 분석을 못 했음 (AI 한도 등) → 얼굴이 나오는지 원장님께 직접 묻는다 */
  analysisFailed?: boolean
  error?: string
}

export interface Choices {
  purpose: string
  industry: string
  mood: string
  wantDrafts: boolean
  wantPhotos: boolean
  photoFormats: string[]
  overlayShopName: boolean
  wantVideo: boolean
  videoFormat: string
  keywords: string
  customerId: string
}

/** 얼굴이 보여 게시 동의(또는 가림)가 필요한지 */
export function needsConsent(item: Item): boolean {
  const m = item.media
  if (!m || item.analyzing || m.consent !== 'unknown') return false
  // 영상은 한 장면만 보고 얼굴이 없다고 할 수 없어서 항상 원장님께 묻는다. 사진은 얼굴이 보일 때,
  // 또는 분석을 못 해서 얼굴이 있는지 모를 때
  if (m.type === 'video') return true
  if (!m.analysis) return !!item.analysisFailed
  return (m.faces?.length ?? 0) > 0
}

/** 얼굴 여부를 모르는 항목 (영상, 분석 못 한 사진) — "얼굴 안 나와요"를 고를 수 있다 */
export function faceUnknown(item: Item): boolean {
  return item.media?.type === 'video' || !item.media?.analysis
}
