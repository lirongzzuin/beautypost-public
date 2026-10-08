import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from '@tanstack/react-router'
import { api } from '~/api/client'
import type { Customer } from '@beautypost/shared'
import styles from './CustomerDetailPage.module.css'

export default function CustomerDetailPage() {
  const { customerId } = useParams({ strict: false }) as { customerId: string }
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api.get<{ data: Customer & { media: unknown[] } }>(`/customers/${customerId}`).then((r) => r.data),
  })

  if (isLoading) return <div className={styles.loading}>불러오는 중...</div>
  if (!data) return <div className={styles.loading}>고객을 찾을 수 없어요.</div>

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <button className={styles.back} onClick={() => navigate({ to: '/customers' })}>← 고객 목록</button>

        <div className={styles.profile}>
          <div className={styles.avatar}>{data.name[0]}</div>
          <h1 className={styles.name}>{data.name}</h1>
          {data.phone && <p className={styles.phone}>{data.phone}</p>}
        </div>

        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statNum}>{data.visitCount}</span>
            <span className={styles.statLabel}>총 방문</span>
          </div>
          {data.lastVisitAt && (
            <div className={styles.stat}>
              <span className={styles.statNum}>
                {new Date(data.lastVisitAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' })}
              </span>
              <span className={styles.statLabel}>마지막 방문</span>
            </div>
          )}
        </div>

        {data.memo && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>메모</h3>
            <p className={styles.memo}>{data.memo}</p>
          </div>
        )}

        {data.tags.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>태그</h3>
            <div className={styles.tags}>
              {data.tags.map((t, i) => <span key={i} className={styles.tag}>{t}</span>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
