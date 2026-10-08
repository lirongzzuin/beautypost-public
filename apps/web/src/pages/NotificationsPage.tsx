import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '~/api/client'
import type { Notification } from '@beautypost/shared'
import styles from './NotificationsPage.module.css'

export default function NotificationsPage() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ data: Notification[]; meta: { unreadCount: number } }>('/notifications?limit=50').then((r) => r),
  })

  const readAllMut = useMutation({
    mutationFn: () => api.post('/notifications/read-all', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const readMut = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const notifications = data?.data ?? []
  const unreadCount = data?.meta.unreadCount ?? 0

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>알림</h1>
          {unreadCount > 0 && (
            <button className={styles.readAllBtn} onClick={() => readAllMut.mutate()}>
              모두 읽음
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className={styles.empty}>
            <p>🔔</p>
            <p className={styles.emptyText}>알림이 없어요</p>
          </div>
        ) : (
          <div className={styles.list}>
            {notifications.map((n) => (
              <button
                key={n.id}
                className={`${styles.item} ${!n.readAt ? styles.unread : ''}`}
                onClick={() => { if (!n.readAt) readMut.mutate(n.id) }}
              >
                <div className={styles.itemContent}>
                  <p className={styles.itemTitle}>{n.title}</p>
                  <p className={styles.itemBody}>{n.body}</p>
                  <p className={styles.itemTime}>
                    {new Date(n.createdAt).toLocaleString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {!n.readAt && <span className={styles.dot} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
