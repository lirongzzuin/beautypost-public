import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '~/api/client'
import type { Post } from '@beautypost/shared'
import styles from './PostsPage.module.css'

const STATUS_LABELS: Record<string, string> = {
  draft: '초안', scheduled: '예약', publishing: '게시 중', published: '게시됨', failed: '실패',
}

export default function PostsPage() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['posts'],
    queryFn: () => api.get<{ data: Post[] }>('/posts?limit=50').then((r) => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/posts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  })

  const posts = data ?? []

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>게시물 관리</h1>
          <Link to="/posts/create" className={styles.createBtn}>+ 만들기</Link>
        </div>

        {posts.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyIcon}>📝</p>
            <p className={styles.emptyText}>아직 게시물이 없어요</p>
            <Link to="/posts/create" className={styles.emptyLink}>첫 게시물 만들기</Link>
          </div>
        ) : (
          <div className={styles.list}>
            {posts.map((post) => (
              <div key={post.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={`${styles.status} ${styles[`status_${post.status}`]}`}>
                    {STATUS_LABELS[post.status] ?? post.status}
                  </span>
                  <span className={styles.date}>
                    {new Date(post.scheduledAt ?? post.createdAt).toLocaleDateString('ko', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className={styles.caption}>{post.caption.slice(0, 100)}{post.caption.length > 100 ? '...' : ''}</p>
                <div className={styles.tags}>
                  {post.channels.map((ch) => (
                    <span key={ch} className={styles.tag}>{ch === 'instagram' ? '📸 인스타' : '📝 블로그'}</span>
                  ))}
                </div>
                <div className={styles.actions}>
                  <Link to="/posts/$postId" params={{ postId: post.id }} className={styles.viewBtn}>
                    상세보기
                  </Link>
                  {post.status === 'draft' && (
                    <button
                      className={styles.deleteBtn}
                      onClick={() => {
                        if (confirm('삭제하시겠어요?')) deleteMut.mutate(post.id)
                      }}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
