import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api } from '~/api/client'
import { BEAUTY_CATEGORY_LABELS, TONE_LABELS } from '@beautypost/shared'
import type { UserProfile } from '@beautypost/shared'
import styles from './ProfilePage.module.css'

export default function ProfilePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ data: UserProfile }>('/auth/profile').then((r) => r.data),
  })

  const [form, setForm] = useState<Partial<UserProfile>>({})
  const current = { ...profile, ...form }

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const saveMut = useMutation({
    mutationFn: () => api.post('/auth/onboarding', {
      shopName: current.shopName,
      region: current.region,
      category: current.category,
      tone: current.tone,
      weeklyPostGoal: current.weeklyPostGoal,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['auth-me'] })
      toast.show('가게 정보가 저장됐어요 ✓')
      navigate({ to: '/settings' })
    },
    onError: () => {
      toast.show('저장에 실패했어요. 다시 시도해주세요.', 'error')
    },
  })

  return (
    <div className="page-scroll">
      <div className={styles.container}>
        <div className={styles.header}>
          <button onClick={() => navigate({ to: '/settings' })} className={styles.back}>← 더보기</button>
          <h1 className={styles.title}>가게 정보</h1>
        </div>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label}>가게 이름</label>
            <input
              className={styles.input}
              value={current.shopName ?? ''}
              onChange={(e) => set('shopName', e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>지역</label>
            <input
              className={styles.input}
              value={current.region ?? ''}
              onChange={(e) => set('region', e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>업종</label>
            <div className={styles.chipGrid}>
              {Object.entries(BEAUTY_CATEGORY_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.chip} ${current.category === key ? styles.chipSelected : ''}`}
                  onClick={() => set('category', key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>기본 말투</label>
            <div className={styles.chipGrid}>
              {Object.entries(TONE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.chip} ${current.tone === key ? styles.chipSelected : ''}`}
                  onClick={() => set('tone', key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>주간 게시 목표</label>
            <div className={styles.goalRow}>
              {[2, 3, 4, 5, 7].map((g) => (
                <button
                  key={g}
                  className={`${styles.goalBtn} ${current.weeklyPostGoal === g ? styles.goalSelected : ''}`}
                  onClick={() => set('weeklyPostGoal', g)}
                  type="button"
                >
                  {g}회
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          className={styles.saveBtn}
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
        >
          {saveMut.isPending ? '저장 중...' : '저장하기'}
        </button>
      </div>
    </div>
  )
}
