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
  // 대표 화면을 못 읽은 영상은 얼굴이 나오는지 원장님께 물어본다
  return (m.faces?.length ?? 0) > 0 || (m.type === 'video' && !m.analysis)
}
