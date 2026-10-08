import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api } from '~/api/client'
import styles from './ChannelsPage.module.css'

interface ChannelConnection {
  id: string
  channelType: 'instagram' | 'naver_blog'
  status: string
  handle?: string
  tokenExpiresAt?: string
}

export default function ChannelsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const { data } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ data: ChannelConnection[] }>('/channels').then((r) => r.data),
  })

  const connectMut = useMutation({
    mutationFn: async () => {
      const { data: oauthData } = await api.get<{ data: { url: string } }>('/channels/instagram/oauth')
      window.location.href = oauthData.url
    },
    onError: () => toast.show('연결 요청에 실패했어요.', 'error'),
  })

  const disconnectMut = useMutation({
    mutationFn: (channelType: string) => api.delete(`/channels/${channelType}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.show('채널 연결이 해제됐어요.')
    },
    onError: () => toast.show('연결 해제에 실패했어요.', 'error'),
  })

  const channels = data ?? []
  const instagram = channels.find((c) => c.channelType === 'instagram')

  // Handle callback query params
  const params = new URLSearchParams(window.location.search)
  const connected = params.get('connected')
  const error = params.get('error')

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => navigate({ to: '/settings' })} className={styles.back}>← 더보기</button>
          <h1 className={styles.title}>채널 연결</h1>
        </div>

        {connected && <div className={styles.successBanner}>✅ {connected === 'instagram' ? '인스타그램' : '채널'} 연결 완료!</div>}
        {error && <div className={styles.errorBanner}>❌ 연결에 실패했어요. 다시 시도해주세요.</div>}

        {/* Instagram */}
        <div className={styles.channelCard}>
          <div className={styles.channelInfo}>
            <span className={styles.channelIcon}>📸</span>
            <div>
              <p className={styles.channelName}>인스타그램</p>
              {instagram?.status === 'connected'
                ? <p className={styles.channelHandle}>@{instagram.handle}</p>
                : <p className={styles.channelStatus}>연결되지 않음</p>}
            </div>
          </div>
          {instagram?.status === 'connected' ? (
            <button
              className={styles.disconnectBtn}
              onClick={() => disconnectMut.mutate('instagram')}
              disabled={disconnectMut.isPending}
            >
              연결 해제
            </button>
          ) : (
            <button
              className={styles.connectBtn}
              onClick={() => connectMut.mutate()}
              disabled={connectMut.isPending}
            >
              {connectMut.isPending ? '연결 중...' : '연결하기'}
            </button>
          )}
        </div>

        {/* Naver blog — draft only */}
        <div className={`${styles.channelCard} ${styles.channelCardDisabled}`}>
          <div className={styles.channelInfo}>
            <span className={styles.channelIcon}>📝</span>
            <div>
              <p className={styles.channelName}>네이버 블로그</p>
              <p className={styles.channelStatus}>초안 저장 전용 (자동 게시 준비 중)</p>
            </div>
          </div>
          <span className={styles.comingSoon}>초안</span>
        </div>

        <p className={styles.note}>
          인스타그램 연결 시 비즈니스 계정이 필요해요.<br />
          연결하면 +3일 무료 체험이 추가돼요 🎁
        </p>
      </div>
    </div>
  )
}
