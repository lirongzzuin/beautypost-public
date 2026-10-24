import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '~/store/auth'
import { api } from '~/api/client'
import { POST_THEMES } from '@beautypost/shared'
import type { WeeklyStats, Notification } from '@beautypost/shared'
import styles from './DashboardPage.module.css'

// A gentle weekly posting routine — one suggested theme per day so the owner
// always has a "what should I post today?" answer in one tap. Index = getDay()
// (0=Sun … 6=Sat).
const WEEKLY_PLAN: string[] = [
  'shop_intro',     // Sun — relaxed brand story
  'review',         // Mon — kick the week off with social proof
  'care_guide',     // Tue — helpful tip
  'before_after',   // Wed — eye-catching transformation
  'event',          // Thu — nudge weekend bookings
  'review',         // Fri — another happy customer
  'booking_notice', // Sat — next-week availability
]

export const CREATE_THEME_KEY = 'bp:create-theme'

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const todayThemeId = WEEKLY_PLAN[new Date().getDay()] ?? 'review'
  const suggested = POST_THEMES.find((t) => t.id === todayThemeId) ?? POST_THEMES[0]

  function startSuggested() {
    sessionStorage.setItem(CREATE_THEME_KEY, todayThemeId)
    navigate({ to: '/posts/create' })
  }

  const { data: stats } = useQuery({
    queryKey: ['weekly-stats'],
    queryFn: () => api.get<{ data: WeeklyStats }>('/posts/stats/weekly').then((r) => r.data),
  })

  const { data: notifications } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () =>
      api.get<{ data: Notification[]; meta: { unreadCount: number } }>('/notifications?unread=true&limit=3')
        .then((r) => r),
  })

  const trialDaysLeft = user?.entitlement?.trialDaysLeft ?? 0
  const goalPct = stats ? Math.min(100, Math.round((stats.achieved / stats.goal) * 100)) : 0

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <p className={styles.greeting}>안녕하세요 원장님 👋</p>
            <h1 className={styles.shopName}>{user?.shopName ?? user?.name}</h1>
          </div>
          <Link to="/notifications" className={styles.bellBtn} aria-label="알림">
            <BellIcon />
            {(notifications?.meta.unreadCount ?? 0) > 0 && (
              <span className={styles.badge}>{notifications?.meta.unreadCount}</span>
            )}
          </Link>
        </div>

        {/* Trial banner */}
        {user?.entitlement?.plan === 'trial' && trialDaysLeft <= 7 && (
          <div className={styles.trialBanner}>
            <span>무료 체험 <strong>{trialDaysLeft}일</strong> 남았어요</span>
            <Link to="/settings" className={styles.trialLink}>구독하기 →</Link>
          </div>
        )}

        {/* Weekly goal card */}
        <div className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardTitle}>이번 주 목표</span>
            <span className={styles.cardBadge}>{stats?.achieved ?? 0}/{stats?.goal ?? 3}회</span>
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${goalPct}%` }} />
          </div>
          <div className={styles.dayRow}>
            {(stats?.days ?? []).map((d) => (
              <div key={d.date} className={`${styles.day} ${d.posted ? styles.dayPosted : ''}`}>
                <div className={styles.dayDot} />
                <span className={styles.dayLabel}>{new Date(d.date).toLocaleDateString('ko', { weekday: 'narrow' })}</span>
              </div>
            ))}
          </div>
          {goalPct >= 100 && (
            <p className={styles.goalMet}>🎉 이번 주 목표 달성! +3일 보너스</p>
          )}
        </div>

        {/* Today's recommended post */}
        <button className={styles.suggestCard} onClick={startSuggested} type="button">
          <div className={styles.suggestText}>
            <span className={styles.suggestKicker}>오늘의 추천 게시물</span>
            <span className={styles.suggestTitle}>{suggested?.label}</span>
            <span className={styles.suggestDesc}>{suggested?.desc} · 원탭으로 바로 만들기</span>
          </div>
          <span className={styles.suggestGo}>→</span>
        </button>

        {/* Quick actions */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>빠른 시작</h2>
          <div className={styles.quickGrid}>
            <Link to="/posts/create" className={styles.quickCard}>
              <span className={styles.quickIcon}>✍️</span>
              <span className={styles.quickLabel}>글·사진·영상 만들기</span>
            </Link>
            <Link to="/calendar" className={styles.quickCard}>
              <span className={styles.quickIcon}>📅</span>
              <span className={styles.quickLabel}>예약 캘린더</span>
            </Link>
            <Link to="/customers" className={styles.quickCard}>
              <span className={styles.quickIcon}>👥</span>
              <span className={styles.quickLabel}>고객 관리</span>
            </Link>
            <Link to="/library" className={styles.quickCard}>
              <span className={styles.quickIcon}>🎬</span>
              <span className={styles.quickLabel}>만든 영상</span>
            </Link>
          </div>
        </div>

        {/* Recent notifications */}
        {(notifications?.data.length ?? 0) > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionRow}>
              <h2 className={styles.sectionTitle}>최근 알림</h2>
              <Link to="/notifications" className={styles.seeAll}>전체 보기</Link>
            </div>
            {notifications?.data.map((n) => (
              <div key={n.id} className={styles.notifItem}>
                <p className={styles.notifTitle}>{n.title}</p>
                <p className={styles.notifBody}>{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
    </svg>
  )
}
