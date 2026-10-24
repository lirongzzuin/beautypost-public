import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api, ApiRequestError } from '~/api/client'
import { contentApi, type Brand } from '~/api/content'
import { uploadMedia } from '~/lib/upload'
import { PageLoader } from '~/components/PageLoader'
import styles from './create/create.module.css'

// 브랜드 설정: 만들 때마다 기본으로 쓰는 업종·분위기·색·로고·예약 안내, 그리고 원장님 말투 샘플
export default function BrandSettingsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const presets = useQuery({ queryKey: ['presets'], queryFn: contentApi.presets, staleTime: 10 * 60_000 })
  const brand = useQuery({ queryKey: ['brand'], queryFn: contentApi.brand })
  const samples = useQuery({ queryKey: ['style-examples'], queryFn: () => api.get<{ data: { id: string; text: string }[] }>('/style-examples').then((r) => r.data) })
  const [form, setForm] = useState<Brand | null>(null)
  const [newSample, setNewSample] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (brand.data && !form) setForm(brand.data)
  }, [brand.data, form])

  if (!presets.data || !form) return <PageLoader />
  const set = (patch: Partial<Brand>) => setForm((f) => (f ? { ...f, ...patch } : f))

  async function save() {
    try {
      await contentApi.saveBrand({ ...form!, brandColor: form!.brandColor || null })
      await qc.invalidateQueries({ queryKey: ['brand'] })
      toast.show('브랜드 설정을 저장했어요.')
      navigate({ to: '/settings' })
    } catch (e) {
      toast.show(e instanceof ApiRequestError ? e.messageKo : '저장하지 못했어요.', 'error')
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return
    try {
      setLogoPreview(URL.createObjectURL(file))
      const media = await uploadMedia(file, null, () => undefined)
      set({ logoMediaId: media.id })
    } catch {
      toast.show('로고를 올리지 못했어요.', 'error')
    }
  }

  async function addSample() {
    const text = newSample.trim()
    if (!text) return
    await api.post('/style-examples', { text })
    setNewSample('')
    await samples.refetch()
  }

  async function removeSample(id: string) {
    await api.delete(`/style-examples/${id}`)
    await samples.refetch()
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate({ to: '/settings' })} aria-label="뒤로">
          ←
        </button>
        <strong>브랜드 설정</strong>
      </div>
      <div className={styles.body}>
        <p className={styles.sectionLabel}>업종</p>
        <div className={styles.chips}>
          {presets.data.industries.map((i) => (
            <button key={i.id} type="button" className={`${styles.chip} ${form.industry === i.id ? styles.chipOn : ''}`} onClick={() => set({ industry: i.id })}>
              {i.label}
            </button>
          ))}
        </div>

        <p className={styles.sectionLabel}>기본 분위기</p>
        <div className={styles.moodRow}>
          {presets.data.moods.map((m) => (
            <button key={m.id} type="button" className={`${styles.moodCard} ${form.mood === m.id ? styles.moodOn : ''}`} onClick={() => set({ mood: m.id })}>
              {m.thumb ? <img src={m.thumb} alt="" /> : <span className={styles.moodSwatch} style={{ background: m.palette.primary }} />}
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.formRow}>
          <label>브랜드 컬러 (영상 마지막 예약 카드·사진 테두리)</label>
          <div className={styles.colorRow}>
            <input type="color" value={form.brandColor ?? '#a23553'} onChange={(e) => set({ brandColor: e.target.value })} />
            <span className={styles.hint}>{form.brandColor ?? '선택 안 함'}</span>
            {form.brandColor && (
              <button type="button" className={styles.linkBtn} onClick={() => set({ brandColor: null })}>
                지우기
              </button>
            )}
          </div>
        </div>

        <div className={styles.formRow}>
          <label>로고 (사진 오른쪽 위·예약 카드)</label>
          <div className={styles.colorRow}>
            {logoPreview && <img src={logoPreview} alt="" width={48} height={48} style={{ objectFit: 'contain' }} />}
            <button type="button" className={styles.smallBtn} onClick={() => logoInput.current?.click()}>
              {form.logoMediaId ? '로고 바꾸기' : '로고 올리기'}
            </button>
            {form.logoMediaId && (
              <button type="button" className={styles.linkBtn} onClick={() => { set({ logoMediaId: null }); setLogoPreview(null) }}>
                지우기
              </button>
            )}
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
          </div>
        </div>

        <div className={styles.formRow}>
          <label>예약 안내 문구 (글·영상 마지막)</label>
          <input className={styles.input} value={form.bookingLabel} maxLength={40} placeholder="예: 예약은 프로필 링크 / 카톡 채널" onChange={(e) => set({ bookingLabel: e.target.value })} />
        </div>

        <p className={styles.sectionLabel}>내 말투 샘플</p>
        <p className={styles.hint}>
          직접 쓴 인스타 글을 2~5개 넣어 두면 말투·줄바꿈·이모지 습관을 닮게 써요. 결과 화면에서 복사한 글도 자동으로 반영돼요.
        </p>
        {samples.data?.map((s) => (
          <div key={s.id} className={styles.sampleItem}>
            <p>{s.text}</p>
            <button type="button" className={styles.linkBtn} onClick={() => removeSample(s.id)}>
              삭제
            </button>
          </div>
        ))}
        <textarea className={styles.textarea} rows={4} placeholder="내가 쓴 게시글을 붙여넣기" value={newSample} onChange={(e) => setNewSample(e.target.value)} />
        <button type="button" className={styles.secondaryBtn} onClick={addSample} disabled={!newSample.trim()}>
          샘플 추가
        </button>
      </div>
      <div className={styles.footer}>
        <button className={styles.nextBtn} onClick={save}>
          저장
        </button>
      </div>
    </div>
  )
}
