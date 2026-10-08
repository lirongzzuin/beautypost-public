import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api } from '~/api/client'
import { SERVICE_CATALOG, TONE_LABELS, getServiceDef } from '@beautypost/shared'
import type { UserProfile } from '@beautypost/shared'
import styles from './ProfilePage.module.css'

interface StyleExample { id: string; text: string; createdAt: string }

export default function ProfilePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ data: UserProfile }>('/auth/profile').then((r) => r.data),
  })

  const { data: styleExamples } = useQuery({
    queryKey: ['style-examples'],
    queryFn: () => api.get<{ data: StyleExample[] }>('/style-examples').then((r) => r.data),
  })

  const [form, setForm] = useState<Partial<UserProfile>>({})
  const [customInput, setCustomInput] = useState('')
  const current = { ...profile, ...form }
  const services = current.services ?? []
  const customServices = current.customServices ?? []

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleService(key: string) {
    set('services', services.includes(key) ? services.filter((s) => s !== key) : [...services, key])
  }

  function addCustom() {
    const v = customInput.trim()
    if (!v || customServices.includes(v)) return setCustomInput('')
    set('customServices', [...customServices, v])
    setCustomInput('')
  }

  const saveMut = useMutation({
    mutationFn: () => api.post('/auth/onboarding', {
      shopName: current.shopName,
      region: current.region,
      category: services.length ? getServiceDef(services[0]!)?.category ?? 'other' : 'other',
      services,
      customServices,
      tone: current.tone,
      weeklyPostGoal: current.weeklyPostGoal,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['auth-me'] })
      toast.show('가게 정보가 저장됐어요 ✓')
      navigate({ to: '/settings' })
    },
    onError: () => toast.show('저장에 실패했어요. 다시 시도해주세요.', 'error'),
  })

  const deleteStyleMut = useMutation({
    mutationFn: (id: string) => api.delete(`/style-examples/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['style-examples'] })
      toast.show('삭제했어요.')
    },
    onError: () => toast.show('삭제에 실패했어요.', 'error'),
  })

  const hasService = services.length > 0 || customServices.length > 0

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
            <label className={styles.label}>제공 서비스 <span className={styles.hint}>(여러 개 선택 가능)</span></label>
            <div className={styles.chipGrid}>
              {SERVICE_CATALOG.map((svc) => (
                <button
                  key={svc.key}
                  className={`${styles.chip} ${services.includes(svc.key) ? styles.chipSelected : ''}`}
                  onClick={() => toggleService(svc.key)}
                  type="button"
                >
                  {svc.label}
                </button>
              ))}
            </div>
            {customServices.length > 0 && (
              <div className={styles.chipGrid} style={{ marginTop: 8 }}>
                {customServices.map((c) => (
                  <button
                    key={c}
                    className={`${styles.chip} ${styles.chipSelected}`}
                    onClick={() => set('customServices', customServices.filter((x) => x !== c))}
                    type="button"
                  >
                    {c} ✕
                  </button>
                ))}
              </div>
            )}
            <div className={styles.customRow}>
              <input
                className={styles.input}
                placeholder="직접 입력 (예: 두피케어)"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
              />
              <button className={styles.addCustomBtn} type="button" onClick={addCustom}>추가</button>
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
          disabled={saveMut.isPending || !hasService}
        >
          {saveMut.isPending ? '저장 중...' : '저장하기'}
        </button>

        {/* ── Preferred AI style samples ── */}
        <div className={styles.field} style={{ marginTop: 32 }}>
          <label className={styles.label}>
            AI 선호 스타일 <span className={styles.hint}>(저장한 글을 참고해 글투를 맞춰요)</span>
          </label>
          {styleExamples && styleExamples.length > 0 ? (
            <div className={styles.styleList}>
              {styleExamples.map((ex) => (
                <div key={ex.id} className={styles.styleCard}>
                  <p className={styles.styleText}>{ex.text}</p>
                  <button
                    className={styles.styleDelete}
                    onClick={() => deleteStyleMut.mutate(ex.id)}
                    disabled={deleteStyleMut.isPending}
                    aria-label="삭제"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>
              아직 없어요. 글 만들기에서 마음에 드는 캡션을 "♡ 이 스타일 저장"하면 여기에 쌓여요.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
