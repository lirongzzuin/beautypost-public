import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api, ApiRequestError } from '~/api/client'
import { contentApi, type Brand, type ContentSettings } from '~/api/content'
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
  const [tagsText, setTagsText] = useState<string | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (brand.data && !form) {
      setForm(brand.data)
      setTagsText(brand.data.settings.brandHashtags.join(' '))
    }
  }, [brand.data, form])

  if (!presets.data || !form || tagsText === null) return <PageLoader />
  const set = (patch: Partial<Brand>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const setS = (patch: Partial<ContentSettings>) => setForm((f) => (f ? { ...f, settings: { ...f.settings, ...patch } } : f))

  async function save() {
    try {
      await contentApi.saveBrand({ ...form!, brandColor: form!.brandColor || null, settings: { ...form!.settings, brandHashtags: (tagsText ?? "").split(/[\s,]+/).filter(Boolean) } })
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
          <label>브랜드 컬러 (영상 안내 카드·사진 테두리)</label>
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
          <label>예약 안내 한 줄 (영상 마지막 화면 · 카카오톡 글)</label>
          <input className={styles.input} value={form.bookingLabel} maxLength={40} placeholder="예: 예약은 프로필 링크 / 카톡 채널" onChange={(e) => set({ bookingLabel: e.target.value })} />
        </div>

        <p className={styles.sectionLabel}>게시글 설정</p>
        <div className={styles.formRow}>
          <label>글 끝에 항상 붙일 안내 (예약 방법·위치 등)</label>
          <textarea
            className={styles.textarea}
            rows={4}
            maxLength={600}
            placeholder={'예:\n𝗿𝗲𝘀𝗲𝗿𝘃𝗮𝘁𝗶𝗼𝗻\n* 카카오채널 #샵이름\n* 프로필 링크 클릭 시 바로 연결'}
            value={form.settings.signature}
            onChange={(e) => setS({ signature: e.target.value })}
          />
          <span className={styles.hint}>잘 되는 샵 계정들은 매 글 끝에 같은 예약 안내를 붙여요. 비워 두면 AI가 마지막 줄에 예약 안내를 써요.</span>
        </div>
        <div className={styles.formRow}>
          <label>해시태그 개수</label>
          <div className={styles.chips}>
            {[3, 5, 10, 15].map((n) => (
              <button key={n} type="button" className={`${styles.chip} ${form.settings.hashtagCount === n ? styles.chipOn : ''}`} onClick={() => setS({ hashtagCount: n })}>
                {n}개
              </button>
            ))}
          </div>
          <span className={styles.hint}>요즘은 지역+시술 태그 3~5개가 효과적이에요.</span>
        </div>
        <div className={styles.formRow}>
          <label>매번 넣을 해시태그</label>
          <input className={styles.input} value={tagsText} placeholder="예: #샵이름 #지역눈썹문신" onChange={(e) => setTagsText(e.target.value)} />
        </div>
        <div className={styles.formRow}>
          <label>인스타그램 아이디 (영상 아래 작은 워터마크)</label>
          <input className={styles.input} value={form.settings.instagramHandle} maxLength={40} placeholder="예: @my_beauty_shop (비우면 샵 이름)" onChange={(e) => setS({ instagramHandle: e.target.value })} />
        </div>

        <p className={styles.sectionLabel}>고객 얼굴</p>
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={form.settings.allowFaceBlur} onChange={(e) => setS({ allowFaceBlur: e.target.checked })} />
          <span>
            <strong>얼굴 가림(흐리게) 쓰기</strong> 게시 동의를 못 받은 사진을 얼굴을 흐려서 쓸 수 있게 해요. 얼굴 전체가 흐려져 눈썹·속눈썹 같은 시술 부위도 가려질 수 있어 기본은 꺼 두었어요.
          </span>
        </label>

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
