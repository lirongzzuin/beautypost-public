import { useQuery } from '@tanstack/react-query'
import { contentApi, type PresetCatalog } from '~/api/content'
import { api } from '~/api/client'
import type { Choices, Item } from './types'
import styles from './create.module.css'

interface Props {
  presets: PresetCatalog
  purpose: PresetCatalog['purposes'][number]
  choices: Choices
  set: (patch: Partial<Choices>) => void
  items: Item[]
}

const PHOTO_FORMATS = ['feed-portrait', 'feed-square', 'story']
const VIDEO_FORMATS = ['reel', 'story', 'feed-portrait', 'feed-square']

export default function StepStyle({ presets, purpose, choices, set, items }: Props) {
  // 원장님이 올린 첫 사진에 무드 5개를 입혀 본다 (글 설명 대신 눈으로 고르기)
  const firstPhoto = items.find((i) => i.kind === 'image' && i.media)?.media
  const previews = useQuery({
    queryKey: ['mood-previews', firstPhoto?.id, choices.industry],
    queryFn: () => contentApi.previews(firstPhoto!.id, choices.industry),
    enabled: !!firstPhoto,
    staleTime: Infinity,
  })
  const customers = useQuery({
    queryKey: ['customers', 'lite'],
    queryFn: () => api.get<{ data: { id: string; name: string }[] }>('/customers').then((r) => r.data),
    enabled: purpose.id === 'review',
  })
  const hasPhotos = items.some((i) => i.kind === 'image')
  const label = (id: string) => presets.formats.find((f) => f.id === id)?.label ?? id
  const toggleFormat = (id: string) =>
    set({ photoFormats: choices.photoFormats.includes(id) ? choices.photoFormats.filter((f) => f !== id) : [...choices.photoFormats, id] })

  return (
    <>
      <p className={styles.sectionLabel}>분위기 {firstPhoto ? '(내 사진으로 미리보기)' : ''}</p>
      <div className={styles.moodRow}>
        {presets.moods.map((m) => {
          const img = previews.data?.find((p) => p.moodId === m.id)?.dataUrl ?? m.thumb
          return (
            <button
              key={m.id}
              type="button"
              className={`${styles.moodCard} ${choices.mood === m.id ? styles.moodOn : ''}`}
              onClick={() => set({ mood: m.id })}
            >
              {img ? <img src={img} alt="" /> : <span className={styles.moodSwatch} style={{ background: m.palette.primary }} />}
              <span>{m.label}</span>
            </button>
          )
        })}
      </div>
      {previews.isFetching && <p className={styles.hint}>내 사진에 스타일을 입혀 보는 중…</p>}

      <p className={styles.sectionLabel}>만들 것</p>
      <label className={styles.toggleRow}>
        <input type="checkbox" checked={choices.wantDrafts} onChange={(e) => set({ wantDrafts: e.target.checked })} />
        <span>
          <strong>게시글 초안</strong> 인스타그램 · 네이버 블로그 · 카카오톡 (후보 여러 개, 바로 복사)
        </span>
      </label>

      <label className={`${styles.toggleRow} ${!hasPhotos ? styles.disabled : ''}`}>
        <input type="checkbox" disabled={!hasPhotos} checked={choices.wantPhotos && hasPhotos} onChange={(e) => set({ wantPhotos: e.target.checked })} />
        <span>
          <strong>보정 사진</strong> {purpose.photoLayout === 'before-after-split' ? '비포·애프터 한 장 + 각 사진' : '사진마다'}
        </span>
      </label>
      {choices.wantPhotos && hasPhotos && (
        <div className={styles.subOptions}>
          <div className={styles.chips}>
            {PHOTO_FORMATS.map((f) => (
              <button key={f} type="button" className={`${styles.chip} ${choices.photoFormats.includes(f) ? styles.chipOn : ''}`} onClick={() => toggleFormat(f)}>
                {label(f)}
              </button>
            ))}
          </div>
          <label className={styles.inlineCheck}>
            <input type="checkbox" checked={choices.overlayShopName} onChange={(e) => set({ overlayShopName: e.target.checked })} /> 사진에 샵 이름 넣기
          </label>
        </div>
      )}

      <label className={styles.toggleRow}>
        <input type="checkbox" checked={choices.wantVideo} onChange={(e) => set({ wantVideo: e.target.checked })} />
        <span>
          <strong>영상</strong> 릴스·스토리 (완성되면 알려 드려요, 보통 1~2분)
        </span>
      </label>
      {choices.wantVideo && (
        <div className={styles.subOptions}>
          <div className={styles.chips}>
            {VIDEO_FORMATS.map((f) => (
              <button key={f} type="button" className={`${styles.chip} ${choices.videoFormat === f ? styles.chipOn : ''}`} onClick={() => set({ videoFormat: f })}>
                {label(f)}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className={styles.sectionLabel}>꼭 넣을 내용 (선택)</p>
      <textarea
        className={styles.textarea}
        rows={2}
        placeholder="예: 리터치 이벤트 20% 할인 (~10/31), 1:1 예약제"
        value={choices.keywords}
        onChange={(e) => set({ keywords: e.target.value })}
      />

      {purpose.id === 'review' && (customers.data?.length ?? 0) > 0 && (
        <>
          <p className={styles.sectionLabel}>어느 고객님 후기인가요? (선택)</p>
          <select className={styles.select} value={choices.customerId} onChange={(e) => set({ customerId: e.target.value })}>
            <option value="">선택 안 함</option>
            {customers.data!.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  )
}
