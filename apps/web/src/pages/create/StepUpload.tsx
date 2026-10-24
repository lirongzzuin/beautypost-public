import { useRef, type Dispatch, type SetStateAction } from 'react'
import { useToast } from '@beautypost/ui'
import { contentApi, ROLE_LABELS, type PresetCatalog } from '~/api/content'
import { ApiRequestError } from '~/api/client'
import { uploadMedia } from '~/lib/upload'
import { needsConsent, type Item } from './types'
import styles from './create.module.css'

interface Props {
  purpose: PresetCatalog['purposes'][number]
  industry: string
  items: Item[]
  setItems: Dispatch<SetStateAction<Item[]>>
}

let seq = 0

export default function StepUpload({ purpose, industry, items, setItems }: Props) {
  const toast = useToast()
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const update = (localId: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.localId === localId ? { ...i, ...patch } : i)))

  async function addFiles(role: string, files: FileList | null) {
    if (!files?.length) return
    const room = Math.max(0, 10 - items.length)
    for (const file of Array.from(files).slice(0, room)) {
      const item: Item = {
        localId: `f${++seq}`,
        role,
        kind: file.type.startsWith('video/') ? 'video' : 'image',
        preview: URL.createObjectURL(file),
        name: file.name,
        progress: 0,
      }
      setItems((list) => [...list, item])
      void (async () => {
        try {
          const media = await uploadMedia(file, role === 'any' ? null : role, (p) => update(item.localId, { progress: p }))
          update(item.localId, { media, progress: 100, analyzing: true })
          // 무엇이 보이는지 분석 (얼굴이 있으면 게시 동의를 물어본다)
          const analyzed = await contentApi.analyze(media.id, industry).catch(() => media)
          update(item.localId, { media: analyzed, analyzing: false })
        } catch (e) {
          const msg = e instanceof ApiRequestError ? e.messageKo : (e as Error).message
          update(item.localId, { error: msg, analyzing: false })
          toast.show(msg || '업로드에 실패했어요.', 'error')
        }
      })()
    }
  }

  async function setConsent(item: Item, consent: 'granted' | 'blurred' | 'not_needed') {
    if (!item.media) return
    try {
      const media = await contentApi.patchMedia(item.media.id, { consent })
      update(item.localId, { media })
    } catch {
      toast.show('저장하지 못했어요.', 'error')
    }
  }

  const remove = (localId: string) => setItems((list) => list.filter((i) => i.localId !== localId))

  // 목적이 요구하는 역할별 칸 + (요구 역할에 없는 사진이 이미 있으면) 기타 칸
  const roles = purpose.requiredMedia.map((r) => r)
  const known = new Set(roles.map((r) => r.role))
  const others = items.filter((i) => !known.has(i.role))

  return (
    <>
      <p className={styles.stepDesc}>칸마다 맞는 사진을 올려 주세요. 사진 내용을 보고 글과 영상을 만들어요.</p>
      {[...roles, ...(others.length ? [{ role: others[0]!.role, min: 0, max: 10 }] : [])].map((r) => {
        const list = items.filter((i) => i.role === r.role)
        return (
          <section key={r.role} className={styles.roleZone}>
            <div className={styles.roleHead}>
              <span className={styles.roleTitle}>{ROLE_LABELS[r.role] ?? r.role}</span>
              <span className={styles.roleCount}>
                {r.min === 0 ? '선택' : `${r.min}장 이상`} · {list.length}/{r.max}
              </span>
            </div>
            <div className={styles.thumbRow}>
              {list.map((i) => (
                <div key={i.localId} className={styles.thumb}>
                  {i.kind === 'video' ? <video src={i.preview} muted playsInline /> : <img src={i.preview} alt="" />}
                  {i.kind === 'video' && <span className={styles.badge}>영상</span>}
                  {!i.media && !i.error && <div className={styles.progress} style={{ width: `${i.progress}%` }} />}
                  {i.analyzing && <span className={styles.thumbNote}>분석 중…</span>}
                  {i.error && <span className={`${styles.thumbNote} ${styles.thumbError}`}>실패</span>}
                  {i.media?.consent === 'blurred' && <span className={styles.thumbNote}>얼굴 가림</span>}
                  {i.media?.consent === 'granted' && <span className={styles.thumbNote}>동의 확인</span>}
                  <button type="button" className={styles.removeBtn} onClick={() => remove(i.localId)} aria-label="빼기">
                    ×
                  </button>
                </div>
              ))}
              {list.length < r.max && (
                <button type="button" className={styles.addTile} onClick={() => inputs.current[r.role]?.click()}>
                  +
                </button>
              )}
              <input
                ref={(el) => {
                  inputs.current[r.role] = el
                }}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  void addFiles(r.role, e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
            {list.filter(needsConsent).map((i) => (
              <div key={i.localId} className={styles.consentBox}>
                <p>
                  {(i.media?.faces?.length ?? 0) > 0 ? (
                    <><strong>고객 얼굴이 보여요.</strong> 게시해도 되는지 확인해 주세요.</>
                  ) : (
                    <><strong>이 영상에 고객 얼굴이 나오나요?</strong> 영상 내용을 미리 읽지 못했어요.</>
                  )}
                </p>
                <div className={styles.consentBtns}>
                  {!(i.media?.faces?.length) && <button type="button" onClick={() => setConsent(i, 'not_needed')}>얼굴 안 나와요</button>}
                  <button type="button" onClick={() => setConsent(i, 'granted')}>게시 동의 받았어요</button>
                  {i.kind === 'image' && (
                    <button type="button" onClick={() => setConsent(i, 'blurred')}>얼굴 가리고 쓸게요</button>
                  )}
                  <button type="button" onClick={() => remove(i.localId)}>이 사진 빼기</button>
                </div>
              </div>
            ))}
          </section>
        )
      })}
      <p className={styles.notice}>
        보정은 밝기·색감까지만 해요. 시술 부위의 모양을 바꾸거나 실제보다 좋아 보이게 만들지 않아요 (비포·애프터는 같은 보정값).
      </p>
    </>
  )
}
