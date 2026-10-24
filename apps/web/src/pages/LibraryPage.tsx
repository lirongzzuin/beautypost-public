import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { contentApi } from '~/api/content'
import { PageLoader } from '~/components/PageLoader'
import { VideoPanel } from './create/StepResults'
import styles from './create/create.module.css'

// 만든 영상 모음 (알림에서 들어오는 곳). 진행 중인 작업은 진행률, 끝난 작업은 저장 버튼
export default function LibraryPage() {
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: contentApi.jobs, refetchInterval: 10_000 })
  const presets = useQuery({ queryKey: ['presets'], queryFn: contentApi.presets, staleTime: 10 * 60_000 })
  if (jobs.isLoading) return <PageLoader />
  return (
    <div className={`${styles.container} ${styles.withNav}`}>
      <div className={styles.body}>
        <h2 className={styles.stepTitle}>만든 영상</h2>
        {!jobs.data?.length && (
          <p className={styles.hint}>
            아직 만든 영상이 없어요. <Link to="/posts/create">만들기</Link>에서 “영상”을 골라 보세요.
          </p>
        )}
        <div className={styles.list}>
          {jobs.data?.map((j) => (
            <section key={j.id} className={styles.jobCard}>
              <p className={styles.jobTitle}>{j.title || '영상'}</p>
              <p className={styles.jobMeta}>{new Date(j.createdAt).toLocaleString('ko-KR')}</p>
              <VideoPanel jobId={j.id} warnings={[]} music={presets.data?.moods.find((m) => j.title.includes(m.label))?.video.music} />
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
