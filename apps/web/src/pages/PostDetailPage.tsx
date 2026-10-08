import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from '@tanstack/react-router'
import { api } from '~/api/client'
import type { Post } from '@beautypost/shared'
import styles from './PostDetailPage.module.css'

export default function PostDetailPage() {
  const { postId } = useParams({ strict: false }) as { postId: string }
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: post, isLoading } = useQuery({
    queryKey: ['post', postId],
    queryFn: () => api.get<{ data: Post }>(`/posts/${postId}`).then((r) => r.data),
  })

  const publishMut = useMutation({
    mutationFn: () => api.post(`/posts/${postId}/publish`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post', postId] })
      qc.invalidateQueries({ queryKey: ['posts'] })
    },
  })

  if (isLoading) return <div className={styles.loading}>불러오는 중...</div>
  if (!post) return <div className={styles.loading}>게시물을 찾을 수 없어요.</div>

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.topBar}>
          <button onClick={() => navigate({ to: '/posts' })} className={styles.back}>← 목록</button>
          <span className={styles.statusBadge} data-status={post.status}>
            {post.status === 'published' ? '게시됨' : post.status === 'scheduled' ? '예약됨' : '초안'}
          </span>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionLabel}>캡션</h3>
          <p className={styles.caption}>{post.caption}</p>
        </div>

        <div className={styles.hashtags}>
          {post.hashtags.map((h, i) => <span key={i} className={styles.tag}>{h}</span>)}
        </div>

        {post.channels.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>채널</h3>
            <div className={styles.channels}>
              {post.channels.map((ch) => (
                <span key={ch} className={styles.channel}>
                  {ch === 'instagram' ? '📸 인스타그램' : '📝 네이버 블로그'}
                </span>
              ))}
            </div>
          </div>
        )}

        {post.scheduledAt && (
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>예약 시간</h3>
            <p>{new Date(post.scheduledAt).toLocaleString('ko')}</p>
          </div>
        )}

        {post.blogDraft?.title && (
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>블로그 초안</h3>
            <p className={styles.blogTitle}>{post.blogDraft.title}</p>
            <p className={styles.blogBody}>{post.blogDraft.body?.slice(0, 200)}...</p>
          </div>
        )}

        {post.status === 'draft' && (
          <button
            className={styles.publishBtn}
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending}
          >
            {publishMut.isPending ? '게시 중...' : '지금 게시하기'}
          </button>
        )}

        {post.instagramMediaId && (
          <p className={styles.igId}>인스타 미디어 ID: {post.instagramMediaId}</p>
        )}
      </div>
    </div>
  )
}
