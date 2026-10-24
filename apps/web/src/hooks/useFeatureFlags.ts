import { useQuery } from '@tanstack/react-query'
import { api } from '~/api/client'

// 서버가 정하는 기능 스위치 (/api/config). 인스타그램 계정 연동은 기본 꺼짐 (보류된 기능, 코드는 그대로 둠)
export function useFeatureFlags() {
  const q = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<{ data: { featureFlags: { instagram: boolean; naverBlog: boolean; reels: boolean } } }>('/config').then((r) => r.data.featureFlags),
    staleTime: 10 * 60_000,
  })
  return q.data ?? { instagram: false, naverBlog: true, reels: true }
}
