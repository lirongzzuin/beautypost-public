import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { contentApi } from '~/api/content'
import { PageLoader } from '~/components/PageLoader'
import StepPurpose from './StepPurpose'
import StepUpload from './StepUpload'
import StepStyle from './StepStyle'
import StepResults from './StepResults'
import { needsConsent, type Choices, type Item, type Step } from './types'
import styles from './create.module.css'

// 콘텐츠 만들기: ① 무엇을(업종·목적) → ② 사진·영상(역할별) → ③ 스타일·만들 것 → ④ 결과(복사·저장)
// 인스타그램 계정 연동 없이: 글은 복사, 사진·영상은 저장해서 원장님이 직접 올린다.

const STEP_TITLES: Record<Step, string> = { 1: '무엇을 만들까요?', 2: '사진·영상 올리기', 3: '스타일 고르기', 4: '완성!' }

export default function CreateContentPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [items, setItems] = useState<Item[]>([])
  const [choices, setChoices] = useState<Choices | null>(null)

  const presets = useQuery({ queryKey: ['presets'], queryFn: contentApi.presets, staleTime: 10 * 60_000 })
  const brand = useQuery({ queryKey: ['brand'], queryFn: contentApi.brand, staleTime: 60_000 })

  // 브랜드 기본값으로 시작 (업종·무드). 대시보드 "오늘의 추천"에서 넘어온 주제가 있으면 그 목적으로
  useEffect(() => {
    if (choices || !presets.data || !brand.data) return
    const handoff = sessionStorage.getItem('bp:create-theme')
    sessionStorage.removeItem('bp:create-theme')
    const fromTheme = handoff ? presets.data.purposes.find((p) => p.legacyThemes.includes(handoff))?.id : undefined
    setChoices({
      purpose: fromTheme ?? presets.data.purposes[0]!.id,
      industry: brand.data.industry,
      mood: brand.data.mood,
      wantDrafts: true,
      wantPhotos: true,
      photoFormats: ['feed-portrait'],
      overlayShopName: false,
      wantVideo: false,
      videoFormat: 'reel',
      keywords: '',
      customerId: '',
    })
  }, [presets.data, brand.data, choices])

  const purpose = useMemo(() => presets.data?.purposes.find((p) => p.id === choices?.purpose), [presets.data, choices?.purpose])

  if (presets.isError || brand.isError) {
    return (
      <div className={styles.container}>
        <p className={styles.errorBox}>
          {(brand.error as Error | null)?.message ?? '불러오지 못했어요.'} 프로필 설정을 먼저 완료해 주세요.
        </p>
      </div>
    )
  }
  if (!presets.data || !brand.data || !choices || !purpose) return <PageLoader />

  const set = (patch: Partial<Choices>) => setChoices((c) => (c ? { ...c, ...patch } : c))
  const uploaded = items.filter((i) => i.media && !i.error)
  const busy = items.some((i) => !i.media && !i.error) || items.some((i) => i.analyzing)
  const roleCount = (role: string) => uploaded.filter((i) => role === 'any' || i.role === role).length
  const missing = purpose.requiredMedia.filter((r) => roleCount(r.role) < r.min)
  const canNext2 = !busy && uploaded.length > 0 && missing.length === 0 && !uploaded.some(needsConsent)
  const canNext3 = choices.wantDrafts || (choices.wantPhotos && choices.photoFormats.length > 0) || choices.wantVideo

  const back = () => (step > 1 ? setStep((s) => (s - 1) as Step) : navigate({ to: '/' }))

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={back} aria-label="뒤로">
          ←
        </button>
        <div className={styles.stepIndicator}>
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className={`${styles.stepDot} ${s <= step ? styles.stepActive : ''}`} />
          ))}
        </div>
        <span className={styles.stepLabel}>{step}/4</span>
      </div>

      <div className={styles.body}>
        <h2 className={styles.stepTitle}>{STEP_TITLES[step]}</h2>
        {step === 1 && <StepPurpose presets={presets.data} choices={choices} set={set} />}
        {step === 2 && <StepUpload purpose={purpose} industry={choices.industry} industryLabel={presets.data?.industries.find((i) => i.id === choices.industry)?.label ?? ''} items={items} setItems={setItems} />}
        {step === 3 && <StepStyle presets={presets.data} purpose={purpose} choices={choices} set={set} items={uploaded} />}
        {step === 4 && <StepResults presets={presets.data} choices={choices} items={uploaded} onRestart={() => { setItems([]); setStep(1) }} />}
      </div>

      {step < 4 && (
        <div className={styles.footer}>
          {step === 2 && missing.length > 0 && (
            <p className={styles.footerHint}>
              {missing.map((r) => `${labelOf(r.role)} ${r.min}장 이상`).join(', ')} 필요해요
            </p>
          )}
          {step === 2 && uploaded.some(needsConsent) && <p className={styles.footerHint}>얼굴이 보이는 사진의 게시 동의를 확인해 주세요</p>}
          <button
            className={styles.nextBtn}
            disabled={(step === 2 && !canNext2) || (step === 3 && !canNext3)}
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            {step === 3 ? '✨ 만들기' : '다음'}
          </button>
        </div>
      )}
    </div>
  )
}

function labelOf(role: string) {
  return { before: '비포', after: '애프터', process: '시술 과정', shop: '매장 사진', any: '사진·영상' }[role] ?? role
}
