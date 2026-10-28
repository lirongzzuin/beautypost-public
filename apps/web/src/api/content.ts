import type { UploadTicket } from '@beautypost/platform'
import { api } from './client'

// 콘텐츠 만들기 API (게시글 초안·사진 보정·영상 작업). 생성 로직은 전부 서버에 있고 화면은 고르고 보여 주기만 한다.

export interface PresetCatalog {
  moods: { id: string; label: string; palette: Record<string, string>; thumb: string | null; video: { durationSec: [number, number]; music: { genres: string[]; bpm: [number, number]; energy: string } } }[]
  purposes: { id: string; label: string; description: string; requiredMedia: { role: string; min: number; max: number }[]; photoLayout: string; legacyThemes: string[] }[]
  industries: { id: string; label: string }[]
  formats: { id: string; label: string; kind: 'video' | 'photo' | 'both'; width: number; height: number }[]
}

export interface ContentSettings {
  /** 모든 인스타 글 끝에 붙는 고정 안내 (예약 방법·위치 등) */
  signature: string
  hashtagCount: number
  brandHashtags: string[]
  instagramHandle: string
  allowFaceBlur: boolean
}

export interface Brand {
  industry: string
  mood: string
  brandColor: string | null
  logoMediaId: string | null
  bookingLabel: string
  bookingUrl: string
  settings: ContentSettings
}

export interface Media {
  id: string
  type: 'image' | 'video'
  url: string
  thumbnailUrl: string | null
  role: string | null
  consent: 'unknown' | 'granted' | 'blurred' | 'not_needed'
  faces: { x: number; y: number; w: number; h: number }[] | null
  analysis: Record<string, unknown> | null
  durationSeconds: number | null
}

export interface Finding {
  listId: string
  severity: 'block' | 'warn'
  match: string
  reason: string
  suggest?: string
}

export interface InstagramCandidate { angle: string; caption: string; hashtags: string[]; text: string; kakao: string; findings: Finding[]; rewritten: boolean }
export interface BlogCandidate { title: string; text: string; tags: string[]; findings: Finding[]; rewritten: boolean }
export interface Drafts { id: string; keyword: string; industry: string; mood: string; instagram: InstagramCandidate[]; blog: BlogCandidate[] }

export interface PhotoOutput { mediaId: string; url: string; formatId: string; kind: 'single' | 'collage'; sourceIds: string[]; width: number; height: number }

export interface Job {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  stage: string | null
  error: string | null
  title: string
  createdAt: string
  result: null | { video: { url: string }; cover: { url: string }; duration: number; width: number; height: number; videoMediaId: string | null }
}

export interface CreateCommon {
  mediaIds: string[]
  purpose: string
  industry?: string
  mood?: string
}

export const contentApi = {
  presets: () => api.get<{ data: PresetCatalog }>('/presets').then((r) => r.data),
  brand: () => api.get<{ data: Brand }>('/brand').then((r) => r.data),
  saveBrand: (b: Partial<Omit<Brand, 'settings'>> & { settings?: Partial<ContentSettings> }) => api.put<{ data: { ok: true } }>('/brand', b),
  ticket: (filename: string, contentType: string, size: number) =>
    api.post<{ data: UploadTicket }>('/upload/ticket', { filename, contentType, size }).then((r) => r.data),
  register: (body: Record<string, unknown>) => api.post<{ data: Media }>('/upload/register', body).then((r) => r.data),
  patchMedia: (id: string, body: { role?: string | null; consent?: Media['consent'] }) => api.patch<{ data: Media }>(`/media/${id}`, body).then((r) => r.data),
  /** 여러 장을 AI 요청 한 번으로 분석 (사진마다 부르면 AI 분당 요청 한도에 걸린다) */
  analyzeMany: (ids: string[], industry?: string) => api.post<{ data: Media[] }>('/media/analyze', { ids, industry }).then((r) => r.data),
  previews: (id: string, industry?: string) =>
    api.post<{ data: { moodId: string; label: string; dataUrl: string }[] }>(`/media/${id}/previews${industry ? `?industry=${industry}` : ''}`).then((r) => r.data),
  drafts: (body: CreateCommon & { keywords?: string; customerId?: string }) => api.post<{ data: Drafts }>('/create/drafts', body).then((r) => r.data),
  blog: (id: string) => api.post<{ data: { keyword: string; blog: BlogCandidate[] } }>(`/create/drafts/${id}/blog`).then((r) => r.data),
  feedback: (id: string, body: { channel: 'instagram' | 'blog'; index: number; text: string }) => api.post(`/create/drafts/${id}/feedback`, body),
  photos: (body: CreateCommon & { formats: string[]; overlayText?: string; useLogo?: boolean }) =>
    api.post<{ data: { outputs: PhotoOutput[]; clamped: string[] } }>('/create/photos', body).then((r) => r.data),
  video: (body: CreateCommon & { format: string; keywords?: string }) =>
    api.post<{ data: { jobId: string; warnings: string[]; estimatedSeconds: number } }>('/create/videos', body).then((r) => r.data),
  job: (id: string) => api.get<{ data: Job }>(`/create/jobs/${id}`).then((r) => r.data),
  jobs: () => api.get<{ data: Job[] }>('/create/jobs').then((r) => r.data),
}

export const ROLE_LABELS: Record<string, string> = {
  before: '비포 (시술 전)', after: '애프터 (시술 후)', process: '시술 과정', detail: '디테일', shop: '매장 사진',
  owner: '원장님 사진', review: '고객 후기 캡처', product: '제품', any: '사진·영상',
}

export const STAGE_LABELS: Record<string, string> = {
  start: '준비 중', download: '사진·영상 불러오는 중', prepare: '장면 구성 중', render: '영상 만드는 중', upload: '저장 중', done: '완성',
}

export const GENRE_LABELS: Record<string, string> = {
  acoustic: '어쿠스틱', lofi: '로파이', folk: '포크', chill: '칠아웃', 'deep-house': '딥하우스', pop: '팝', ukulele: '우쿨렐레',
  hiphop: '힙합', edm: 'EDM',
}
