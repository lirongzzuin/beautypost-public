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
            <span className={`${styles.channelIcon} ${styles.igTile}`}><InstagramGlyph /></span>
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
            <span className={`${styles.channelIcon} ${styles.naverTile}`}><NaverGlyph /></span>
            <div>
              <p className={styles.channelName}>네이버 블로그 · 카카오 채널</p>
              <p className={styles.channelStatus}>연동 없이 초안 복사 → 붙여넣기</p>
            </div>
          </div>
          <span className={styles.comingSoon}>복사형</span>
        </div>

        <p className={styles.note}>
          인스타그램만 자동 게시돼요 (비즈니스 계정 필요, 연결 시 +3일 🎁).<br />
          네이버 블로그·카카오 채널은 공식 자동 게시 API가 없어,<br />
          글 만들 때 <strong>초안을 복사해 직접 붙여넣는</strong> 방식으로 도와드려요.
        </p>
      </div>
    </div>
  )
}

// ─── Brand glyphs ──────────────────────────────────────────────────────────────

function InstagramGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5.2" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}

function NaverGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 4h4.6l4.9 7.1V4H19v16h-4.6L9.5 12.9V20H5V4Z" />
    </svg>
  )
}
