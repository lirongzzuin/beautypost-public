import { Link, useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '~/store/auth'
import { useQuery } from '@tanstack/react-query'
import { api } from '~/api/client'
import { useFeatureFlags } from '~/hooks/useFeatureFlags'
import styles from './SettingsPage.module.css'

export default function SettingsPage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const flags = useFeatureFlags()

  const { data: entData } = useQuery({
    queryKey: ['entitlement'],
    queryFn: () => api.get<{ data: { plan: string; trialDaysLeft: number; periodEnd: string } }>('/entitlements/me').then((r) => r.data),
  })

  const { data: rewardData } = useQuery({
    queryKey: ['rewards'],
    queryFn: () => api.get<{ data: Array<{ eventType: string; daysGranted: number; message: string; createdAt: string }> }>('/entitlements/rewards').then((r) => r.data),
  })

  function handleLogout() {
    logout()
    navigate({ to: '/auth/login' })
  }

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <h1 className={styles.title}>더보기</h1>

        {/* Profile */}
        <div className={styles.profileCard}>
          <div className={styles.avatar}>{user?.name?.[0] ?? '?'}</div>
          <div>
            <p className={styles.userName}>{user?.name}</p>
            <p className={styles.userEmail}>{user?.email}</p>
          </div>
          <Link to="/settings/profile" className={styles.editBtn}>수정</Link>
        </div>

        {/* Entitlement */}
        {entData && (
          <div className={styles.entCard}>
            <div className={styles.entTop}>
              <span className={styles.entPlan}>{entData.plan === 'trial' ? '무료 체험' : '구독 중'}</span>
              <span className={styles.entDays}>
                {entData.trialDaysLeft > 0 ? `${entData.trialDaysLeft}일 남음` : new Date(entData.periodEnd).toLocaleDateString('ko')}
              </span>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${Math.min(100, 100 - (entData.trialDaysLeft / 30) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Reward log */}
        {(rewardData?.length ?? 0) > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>🎁 리워드 내역</h2>
            {rewardData?.slice(-3).reverse().map((r, i) => (
              <div key={i} className={styles.rewardItem}>
                <span className={styles.rewardMsg}>{r.message}</span>
                <span className={styles.rewardDate}>+{r.daysGranted}일</span>
              </div>
            ))}
          </div>
        )}

        {/* Menu items */}
        <div className={styles.menuGroup}>
          <Link to="/settings/brand" className={styles.menuItem}>
            <span>🎨 브랜드 설정 (분위기·로고·말투)</span>
            <span className={styles.chevron}>›</span>
          </Link>
          <Link to="/library" className={styles.menuItem}>
            <span>🎬 만든 영상</span>
            <span className={styles.chevron}>›</span>
          </Link>
          {flags.instagram && (
            <Link to="/settings/channels" className={styles.menuItem}>
              <span>📸 채널 연결 관리</span>
              <span className={styles.chevron}>›</span>
            </Link>
          )}
          <Link to="/settings/profile" className={styles.menuItem}>
            <span>🏪 가게 정보 수정</span>
            <span className={styles.chevron}>›</span>
          </Link>
        </div>

        <div className={styles.menuGroup}>
          <a href="mailto:support@beautypost.kr" className={styles.menuItem}>
            <span>💬 고객센터 문의</span>
            <span className={styles.chevron}>›</span>
          </a>
        </div>

        <button className={styles.logoutBtn} onClick={handleLogout}>로그아웃</button>
        <p className={styles.version}>뷰티포스트 v1.0.0</p>
      </div>
    </div>
  )
}
