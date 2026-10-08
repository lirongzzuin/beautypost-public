import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '~/api/client'
import type { Post } from '@beautypost/shared'
import styles from './CalendarPage.module.css'

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const from = new Date(year, month, 1).toISOString()
  const to = new Date(year, month + 1, 0).toISOString()

  const { data } = useQuery({
    queryKey: ['posts-calendar', year, month],
    queryFn: () =>
      api.get<{ data: Post[] }>(`/posts?from=${from}&to=${to}&limit=100`).then((r) => r.data),
  })

  const posts = data ?? []
  const postsByDay: Record<number, Post[]> = {}
  for (const post of posts) {
    const d = new Date(post.scheduledAt ?? post.publishedAt ?? post.createdAt)
    const day = d.getDate()
    if (!postsByDay[day]) postsByDay[day] = []
    postsByDay[day].push(post)
  }

  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array(firstDow).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1))

  const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const dayNames = ['일','월','화','수','목','금','토']

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => { if (month === 0) { setYear(y => y-1); setMonth(11) } else setMonth(m => m-1) }}>‹</button>
          <h2 className={styles.monthTitle}>{year}년 {monthNames[month]}</h2>
          <button onClick={() => { if (month === 11) { setYear(y => y+1); setMonth(0) } else setMonth(m => m+1) }}>›</button>
        </div>

        <div className={styles.dayNames}>
          {dayNames.map((d) => <span key={d} className={styles.dayName}>{d}</span>)}
        </div>

        <div className={styles.grid}>
          {cells.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} />
            const dayPosts = postsByDay[day] ?? []
            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
            return (
              <div key={day} className={`${styles.cell} ${isToday ? styles.today : ''}`}>
                <span className={styles.dayNum}>{day}</span>
                <div className={styles.dots}>
                  {dayPosts.slice(0, 3).map((p) => (
                    <span
                      key={p.id}
                      className={`${styles.dot} ${p.status === 'published' ? styles.dotPublished : styles.dotScheduled}`}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.list}>
          <h3 className={styles.listTitle}>이번 달 게시물 ({posts.length}개)</h3>
          {posts.map((post) => (
            <Link key={post.id} to="/posts/$postId" params={{ postId: post.id }} className={styles.postItem}>
              <div className={`${styles.statusDot} ${post.status === 'published' ? styles.statusPublished : post.status === 'scheduled' ? styles.statusScheduled : styles.statusDraft}`} />
              <div className={styles.postInfo}>
                <p className={styles.postCaption}>{post.caption.slice(0, 50)}...</p>
                <p className={styles.postMeta}>
                  {post.status === 'published' ? '게시됨' : post.status === 'scheduled' ? '예약됨' : '초안'} ·
                  {new Date(post.scheduledAt ?? post.createdAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </Link>
          ))}
          {posts.length === 0 && (
            <div className={styles.empty}>
              <p>이번 달 게시물이 없어요</p>
              <Link to="/posts/create" className={styles.createLink}>게시물 만들기 →</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
