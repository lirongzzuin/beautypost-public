import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { useAuthStore } from '~/store/auth'
import { api } from '~/api/client'
import { SERVICE_CATALOG, TONE_LABELS } from '@beautypost/shared'
import styles from './OnboardingPage.module.css'

type Step = 1 | 2 | 3

const WEEKLY_GOALS = [2, 3, 4, 5, 7]

export default function OnboardingPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const refreshUser = useAuthStore((s) => s.refreshUser)
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [form, setForm] = useState({
    shopName: '',
    region: '',
    services: [] as string[],
    customServices: [] as string[],
    tone: 'friendly',
    weeklyPostGoal: 3,
  })

  function set(key: string, value: string | number | string[]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleService(key: string) {
    setForm((f) => ({
      ...f,
      services: f.services.includes(key)
        ? f.services.filter((s) => s !== key)
        : [...f.services, key],
    }))
  }

  function addCustom() {
    const v = customInput.trim()
    if (!v || form.customServices.includes(v)) return setCustomInput('')
    set('customServices', [...form.customServices, v])
    setCustomInput('')
  }

  const hasService = form.services.length > 0 || form.customServices.length > 0

  async function handleFinish() {
    setLoading(true)
    try {
      await api.post('/auth/onboarding', form)
      await refreshUser()
      navigate({ to: '/' })
    } catch {
      toast.show('저장에 실패했어요. 다시 시도해주세요.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.progress}>
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className={`${styles.dot} ${s <= step ? styles.dotActive : ''}`} />
          ))}
        </div>
        <h2 className={styles.title}>
          {step === 1 ? '어떤 가게를 운영하세요?' : step === 2 ? '어떤 톤으로 쓸까요?' : '주간 게시 목표는?'}
        </h2>
        <p className={styles.subtitle}>
          {step === 1 ? '정보를 바탕으로 딱 맞는 문구를 만들어드려요' :
           step === 2 ? '원장님 스타일에 맞게 캡션 톤을 설정해요' :
           '목표를 채우면 사용 기간이 늘어나요 🎁'}
        </p>
      </div>

      <div className={styles.body}>
        {step === 1 && (
          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.label}>가게 이름</label>
              <input
                className={styles.input}
                placeholder="예) 아름다운 뷰티샵"
                value={form.shopName}
                onChange={(e) => set('shopName', e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>지역</label>
              <input
                className={styles.input}
                placeholder="예) 서울 강남구"
                value={form.region}
                onChange={(e) => set('region', e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>제공 서비스 <span className={styles.labelHint}>(여러 개 선택 가능)</span></label>
              <div className={styles.chipGrid}>
                {SERVICE_CATALOG.map((svc) => (
                  <button
                    key={svc.key}
                    className={`${styles.chip} ${form.services.includes(svc.key) ? styles.chipSelected : ''}`}
                    onClick={() => toggleService(svc.key)}
                    type="button"
                  >
                    {svc.label}
                  </button>
                ))}
              </div>

              {/* custom services */}
              {form.customServices.length > 0 && (
                <div className={styles.chipGrid} style={{ marginTop: 8 }}>
                  {form.customServices.map((c) => (
                    <button
                      key={c}
                      className={`${styles.chip} ${styles.chipSelected}`}
                      onClick={() => set('customServices', form.customServices.filter((x) => x !== c))}
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
          </div>
        )}

        {step === 2 && (
          <div className={styles.toneGrid}>
            {Object.entries(TONE_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`${styles.toneCard} ${form.tone === key ? styles.toneSelected : ''}`}
                onClick={() => set('tone', key)}
                type="button"
              >
                <span className={styles.toneEmoji}>{key === 'friendly' ? '🤗' : key === 'professional' ? '💼' : '✨'}</span>
                <span className={styles.toneName}>{label}</span>
                <span className={styles.toneDesc}>
                  {key === 'friendly' ? '인스타 감성, 이모지 풍부' :
                   key === 'professional' ? '전문성 강조, 신뢰감' : 'MZ 감성, 짧고 임팩트'}
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className={styles.goalGrid}>
            {WEEKLY_GOALS.map((g) => (
              <button
                key={g}
                className={`${styles.goalBtn} ${form.weeklyPostGoal === g ? styles.goalSelected : ''}`}
                onClick={() => set('weeklyPostGoal', g)}
                type="button"
              >
                <span className={styles.goalNum}>{g}회</span>
                <span className={styles.goalLabel}>주당</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        {step > 1 && (
          <button className={styles.backBtn} onClick={() => setStep((s) => (s - 1) as Step)}>
            이전
          </button>
        )}
        {step < 3 ? (
          <button
            className={styles.nextBtn}
            onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={step === 1 && (!form.shopName.trim() || !form.region.trim() || !hasService)}
          >
            다음
          </button>
        ) : (
          <button className={styles.nextBtn} onClick={handleFinish} disabled={loading}>
            {loading ? '저장 중...' : '시작하기 🚀'}
          </button>
        )}
      </div>
    </div>
  )
}
