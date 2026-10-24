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
  // 영상은 한 장면만 보고 얼굴이 없다고 할 수 없어서 항상 원장님께 묻는다. 사진은 얼굴이 보일 때만
  return m.type === 'video' || (m.faces?.length ?? 0) > 0
}
