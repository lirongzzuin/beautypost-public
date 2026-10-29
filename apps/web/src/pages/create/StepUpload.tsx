import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useToast } from '@beautypost/ui'
import { contentApi, ROLE_LABELS, type PresetCatalog } from '~/api/content'
import { ApiRequestError } from '~/api/client'
import { uploadMedia } from '~/lib/upload'
import { faceUnknown, needsConsent, type Item } from './types'
import FramingSheet from './FramingSheet'
import styles from './create.module.css'

interface Props {
  purpose: PresetCatalog['purposes'][number]
  industry: string
  industryLabel: string
  items: Item[]
  setItems: Dispatch<SetStateAction<Item[]>>
}

let seq = 0

/** 시술 부위를 모르는 사진 (분석 실패 + 원장님이 구도를 안 맞춤) */
const unframed = (i: Item) => i.kind === 'image' && !!i.media && !i.analyzing && !i.media.areaBox && !(i.media.analysis as { areaBox?: unknown } | null)?.areaBox && !!i.analysisFailed

export default function StepUpload({ purpose, industry, industryLabel, items, setItems }: Props) {
  const toast = useToast()
  const [framing, setFraming] = useState<Item | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  // 얼굴 가림은 브랜드 설정에서 켠 경우만 보여 준다 (기본 끔)
  const brand = useQuery({ queryKey: ['brand'], queryFn: contentApi.brand, staleTime: 60_000 })
  const allowBlur = brand.data?.settings?.allowFaceBlur ?? false

  const update = (localId: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.localId === localId ? { ...i, ...patch } : i)))

  // 분석은 올린 사진을 모아 AI 요청 한 번으로 (사진마다 부르면 AI 분당 요청 한도에 걸린다).
  // 올리는 중인 파일이 있으면 조금 더 기다렸다가 함께 보낸다
  const queue = useRef<{ localId: string; mediaId: string }[]>([])
  const uploading = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scheduleAnalysis = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushAnalysis(), uploading.current > 0 ? 4000 : 300)
  }
  async function flushAnalysis() {
    const batch = queue.current.splice(0, 10)
    if (!batch.length) return
    try {
      const list = await contentApi.analyzeMany(batch.map((b) => b.mediaId), industry)
      for (const b of batch) {
        const media = list.find((m) => m.id === b.mediaId)
        update(b.localId, { ...(media ? { media } : {}), analyzing: false, analysisFailed: !media?.analysis })
      }
    } catch (e) {
      for (const b of batch) update(b.localId, { analyzing: false, analysisFailed: true })
      const busy = e instanceof ApiRequestError && (e.code === 'AI_BUSY' || e.code === 'AI_UNAVAILABLE')
      toast.show(busy ? '사진 분석이 잠시 밀려 있어요. 얼굴이 나오는지만 직접 알려 주세요.' : '사진을 분석하지 못했어요. 얼굴이 나오는지만 직접 알려 주세요.', 'error')
    }
    if (queue.current.length) void flushAnalysis()
  }

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
      uploading.current++
      void (async () => {
        try {
          const media = await uploadMedia(file, role === 'any' ? null : role, (p) => update(item.localId, { progress: p }))
          // 무엇이 보이는지 분석 (얼굴이 있으면 게시 동의를 물어본다) — 이미 분석된 사진이면 바로
          if (media.analysis) update(item.localId, { media, progress: 100 })
          else {
            update(item.localId, { media, progress: 100, analyzing: true })
            queue.current.push({ localId: item.localId, mediaId: media.id })
          }
        } catch (e) {
          const msg = e instanceof ApiRequestError ? e.messageKo : (e as Error).message
          update(item.localId, { error: msg, analyzing: false })
          toast.show(msg || '업로드에 실패했어요.', 'error')
        } finally {
          uploading.current--
          scheduleAnalysis()
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
  const pending = items.filter(needsConsent)

  // 목적이 요구하는 역할별 칸 + (요구 역할에 없는 사진이 이미 있으면) 기타 칸
  const roles = purpose.requiredMedia.map((r) => r)
  const known = new Set(roles.map((r) => r.role))
  const others = items.filter((i) => !known.has(i.role))

  return (
    <>
      <p className={styles.stepDesc}>칸마다 맞는 사진을 올려 주세요. 사진 내용을 보고 글과 영상을 만들어요.</p>
      {pending.length > 1 && (
        <button type="button" className={styles.secondaryBtn} onClick={() => pending.forEach((i) => void setConsent(i, 'granted'))}>
          얼굴 나온 사진·영상 {pending.length}개 모두 게시 동의 받았어요
        </button>
      )}
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
                  {i.kind === 'image' && i.media && !i.analyzing && (
                    <button type="button" className={`${styles.framingBtn} ${i.media.areaBox ? styles.framingSet : ''}`} onClick={() => setFraming(i)}>
                      구도
                    </button>
                  )}
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
            {list.some(unframed) && (
              <p className={styles.framingNote}>
                사진 분석이 안 돼서 시술 부위를 아직 몰라요. 사진의 <strong>구도</strong>를 눌러 시술 부위를 감싸 주시면 그 부분이 잘 보이게 잘라요.
              </p>
            )}
            {list.filter(needsConsent).map((i) => (
              <div key={i.localId} className={styles.consentBox}>
                <p>
                  {i.kind === 'video' ? (
                    <><strong>이 영상에 고객 얼굴이 나오나요?</strong> 나온다면 게시 동의를 받은 영상만 쓸 수 있어요.</>
                  ) : faceUnknown(i) ? (
                    <><strong>이 사진에 고객 얼굴이 나오나요?</strong> 사진 분석이 잠시 안 돼서 직접 여쭤봐요. 나온다면 게시 동의를 받은 사진만 쓸 수 있어요.</>
                  ) : (
                    <><strong>고객 얼굴이 보여요.</strong> 게시 동의를 받은 사진만 쓸 수 있어요.</>
                  )}
                </p>
                <div className={styles.consentBtns}>
                  {faceUnknown(i) && <button type="button" onClick={() => setConsent(i, 'not_needed')}>얼굴 안 나와요</button>}
                  <button type="button" onClick={() => setConsent(i, 'granted')}>게시 동의 받았어요</button>
                  {i.kind === 'image' && allowBlur && (
                    <button type="button" onClick={() => setConsent(i, 'blurred')}>얼굴 가리고 쓸게요</button>
                  )}
                  <button type="button" onClick={() => remove(i.localId)}>이 사진 빼기</button>
                </div>
              </div>
            ))}
          </section>
        )
      })}
      <FramingSheet
        item={framing}
        industryLabel={industryLabel}
        onClose={() => setFraming(null)}
        onSaved={(item, media) => update(item.localId, { media })}
      />
      <p className={styles.notice}>
        사진은 밝기·색감만 맞추고 테두리 같은 장식은 넣지 않아요. 시술 부위의 모양을 바꾸거나 실제보다 좋아 보이게 만들지 않아요 (비포·애프터는 똑같이 맞춰요).
        시술 부위가 잘 보이게 자르며, 구도는 사진의 <strong>구도</strong>에서 직접 맞출 수 있어요.
      </p>
    </>
  )
}
