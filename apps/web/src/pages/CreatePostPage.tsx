import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api, ApiRequestError } from '~/api/client'
import { compressImage } from '~/lib/image'
import { POST_THEMES, CHANNEL_LABELS } from '@beautypost/shared'
import styles from './CreatePostPage.module.css'

interface CustomerLite { id: string; name: string }

type Step = 1 | 2 | 3 | 4

interface DraftState {
  mediaIds: string[]
  mediaPreviews: string[]
  theme: string
  keywords: string
  channels: string[]
  caption: string
  hashtags: string[]
  blogTitle: string
  blogBody: string
  blogTags: string[]
  scheduledAt: string
  customerId: string
}

const INITIAL: DraftState = {
  mediaIds: [], mediaPreviews: [], theme: '', keywords: '',
  channels: [], caption: '', hashtags: [],
  blogTitle: '', blogBody: '', blogTags: [], scheduledAt: '', customerId: '',
}

export default function CreatePostPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<DraftState>(INITIAL)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [styleSaved, setStyleSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Pick up a theme handed off from the dashboard "오늘의 추천" one-tap.
  useEffect(() => {
    const t = sessionStorage.getItem('bp:create-theme')
    if (t) {
      sessionStorage.removeItem('bp:create-theme')
      setDraft((d) => ({ ...d, theme: t }))
    }
  }, [])

  // Customers are only needed for review posts (to weave in the name).
  const { data: customers } = useQuery({
    queryKey: ['customers', 'lite'],
    queryFn: () => api.get<{ data: CustomerLite[] }>('/customers').then((r) => r.data),
    enabled: draft.theme === 'review',
    staleTime: 60_000,
  })

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  // Reorder a media item by one position, keeping ids and previews in sync.
  function moveMedia(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= draft.mediaIds.length) return
    setDraft((d) => {
      const ids = [...d.mediaIds]
      const previews = [...d.mediaPreviews]
      ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
      ;[previews[index], previews[target]] = [previews[target]!, previews[index]!]
      return { ...d, mediaIds: ids, mediaPreviews: previews }
    })
  }

  // ─── Step 1: Media upload ────────────────────────────────────────────────────

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const newIds: string[] = []
    const newPreviews: string[] = []

    for (const file of Array.from(files).slice(0, 10)) {
      try {
        // Compress/resize in the browser first — phone photos are often 3–10MB;
        // this cuts upload time dramatically. Videos are sent as-is.
        const toUpload = file.type.startsWith('image/') ? await compressImage(file) : file
        const preview = URL.createObjectURL(toUpload)
        const formData = new FormData()
        formData.append('file', toUpload)

        const { data } = await api.upload<{ data: { mediaId: string; url: string } }>('/upload/file', formData)
        newIds.push(data.mediaId)
        newPreviews.push(preview)
      } catch {
        toast.show('파일 업로드에 실패했어요.', 'error')
      }
    }

    if (newIds.length > 0) {
      set('mediaIds', [...draft.mediaIds, ...newIds])
      set('mediaPreviews', [...draft.mediaPreviews, ...newPreviews])
    }
    setUploading(false)
  }

  // ─── Step 3: AI generation ───────────────────────────────────────────────────

  async function generateCaption() {
    setGenerating(true)
    try {
      const { data } = await api.post<{ data: { caption: string; hashtags: string[] } }>('/ai/caption', {
        theme: draft.theme,
        keywords: draft.keywords,
        mediaIds: draft.mediaIds,
        customerId: draft.theme === 'review' && draft.customerId ? draft.customerId : undefined,
      })
      set('caption', data.caption)
      set('hashtags', data.hashtags)
      setStyleSaved(false)
      toast.show('캡션이 생성됐어요 ✨')
    } catch {
      toast.show('문구 생성에 실패했어요. 다시 시도해주세요.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function generateBlog() {
    if (!draft.caption) return
    setGenerating(true)
    try {
      const { data } = await api.post<{ data: { title: string; body: string; tags: string[] } }>('/ai/blog', {
        caption: draft.caption,
        hashtags: draft.hashtags,
        theme: draft.theme,
      })
      set('blogTitle', data.title)
      set('blogBody', data.body)
      set('blogTags', data.tags)
      toast.show('블로그 초안이 생성됐어요 📝')
    } catch {
      toast.show('블로그 초안 생성에 실패했어요.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  // Naver Blog has no public self-serve publishing API, so we produce a
  // ready-to-paste draft (title + body + tags) and copy it to the clipboard.
  async function copyForNaver() {
    const tags = draft.blogTags.length ? '\n\n' + draft.blogTags.map((t) => `#${t}`).join(' ') : ''
    const text = `${draft.blogTitle}\n\n${draft.blogBody}${tags}`
    try {
      await navigator.clipboard.writeText(text)
      toast.show('네이버 블로그용 초안을 복사했어요. 블로그 글쓰기에 붙여넣으세요!')
    } catch {
      toast.show('복사에 실패했어요.', 'error')
    }
  }

  // Kakao Channel has no self-serve posting API, so we help by producing a
  // ready-to-paste channel message and copying it to the clipboard.
  async function copyForKakao() {
    const tags = draft.hashtags.slice(0, 5).join(' ')
    const text = `${draft.caption.trim()}\n\n${tags}\n\n📩 예약·문의는 채널 메시지로 편하게 남겨주세요!`
    try {
      await navigator.clipboard.writeText(text)
      toast.show('카카오 채널용 문구를 복사했어요. 채널에 붙여넣기 하세요!')
    } catch {
      toast.show('복사에 실패했어요.', 'error')
    }
  }

  // Save the current (edited) caption as a style sample for future generations.
  async function saveStyle() {
    const text = draft.caption.trim()
    if (!text) return
    try {
      await api.post('/style-examples', { text })
      setStyleSaved(true)
      toast.show('이 스타일을 기억할게요 ♥ 다음 생성부터 반영돼요')
    } catch {
      toast.show('저장에 실패했어요.', 'error')
    }
  }

  // ─── Step 4: Publish ─────────────────────────────────────────────────────────

  async function handlePublish(schedule: boolean) {
    const toInstagram = draft.channels.includes('instagram')
    setPublishing(true)
    try {
      const { data: post } = await api.post<{ data: { id: string } }>('/posts', {
        caption: draft.caption,
        hashtags: draft.hashtags,
        mediaIds: draft.mediaIds,
        channels: draft.channels,
        theme: draft.theme,
        keywords: draft.keywords,
        scheduledAt: schedule && draft.scheduledAt ? draft.scheduledAt : undefined,
        blogTitle: draft.blogTitle || undefined,
        blogBody: draft.blogBody || undefined,
        blogTags: draft.blogTags.length ? draft.blogTags : undefined,
      })

      if (schedule) {
        toast.show('예약 게시가 설정됐어요 📅')
      } else if (toInstagram) {
        await api.post(`/posts/${post.id}/publish`, {})
        toast.show('인스타그램에 게시됐어요! 🎉')
      } else {
        toast.show('게시물이 저장됐어요. 복사한 초안을 각 채널에 붙여넣어 주세요 📋')
      }

      navigate({ to: '/' })
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.messageKo : '게시에 실패했어요. 다시 시도해주세요.'
      toast.show(msg, 'error')
    } finally {
      setPublishing(false)
    }
  }

  const canNext1 = draft.mediaIds.length > 0 || step > 1
  const canNext2 = draft.theme !== ''
  const canNext3 = draft.caption.trim().length > 0
  // Always allowed in step 4: either publish to Instagram or just save the post.
  const canPublish = true

  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => step > 1 ? setStep((s) => (s - 1) as Step) : navigate({ to: '/' })}>
          <ChevronLeftIcon />
        </button>
        <div className={styles.stepIndicator}>
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className={`${styles.stepDot} ${s <= step ? styles.stepActive : ''}`} />
          ))}
        </div>
        <span className={styles.stepLabel}>{step}/4</span>
      </div>

      <div className={styles.body}>
        {/* Step 1: Upload */}
        {step === 1 && (
          <div className={styles.step}>
            <h2 className={styles.stepTitle}>사진/영상을 올려주세요</h2>
            <p className={styles.stepDesc}>
              최대 10개, 100MB 이하
              {draft.mediaPreviews.length > 1 && ' · 화살표로 순서를 바꿀 수 있어요'}
            </p>

            <div className={styles.mediaGrid}>
              {draft.mediaPreviews.map((url, i) => (
                <div key={i} className={styles.mediaThumb}>
                  <img src={url} alt="" className={styles.thumbImg} />
                  <span className={styles.orderBadge}>{i + 1}</span>
                  <button
                    className={styles.removeBtn}
                    aria-label="삭제"
                    onClick={() => {
                      set('mediaIds', draft.mediaIds.filter((_, j) => j !== i))
                      set('mediaPreviews', draft.mediaPreviews.filter((_, j) => j !== i))
                    }}
                  >×</button>
                  {draft.mediaPreviews.length > 1 && (
                    <div className={styles.reorderBar}>
                      <button
                        className={styles.reorderBtn}
                        aria-label="앞으로 이동"
                        disabled={i === 0}
                        onClick={() => moveMedia(i, -1)}
                      >‹</button>
                      <button
                        className={styles.reorderBtn}
                        aria-label="뒤로 이동"
                        disabled={i === draft.mediaPreviews.length - 1}
                        onClick={() => moveMedia(i, 1)}
                      >›</button>
                    </div>
                  )}
                </div>
              ))}
              {draft.mediaPreviews.length < 10 && (
                <button className={styles.addBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? '⏳' : '＋'}
                </button>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/mp4"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}

        {/* Step 2: Theme & keywords */}
        {step === 2 && (
          <div className={styles.step}>
            <h2 className={styles.stepTitle}>어떤 내용을 담을까요?</h2>
            <p className={styles.stepDesc}>AI가 최적의 캡션을 만들어드려요</p>

            <div className={styles.themeGrid}>
              {POST_THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`${styles.themeCard} ${draft.theme === t.id ? styles.themeSelected : ''}`}
                  onClick={() => set('theme', t.id)}
                  type="button"
                >
                  <span className={styles.themeIcon}><ThemeIcon id={t.id} /></span>
                  <span className={styles.themeLabel}>{t.label}</span>
                  <span className={styles.themeDesc}>{t.desc}</span>
                </button>
              ))}
            </div>

            <div className={styles.keywordField}>
              <label className={styles.label}>추가 키워드 (선택)</label>
              <input
                className={styles.input}
                placeholder="예) 봄 이벤트, 10주년, 신규 오픈"
                value={draft.keywords}
                onChange={(e) => set('keywords', e.target.value)}
              />
            </div>

            {/* Review posts: pick the customer so AI weaves in their name */}
            {draft.theme === 'review' && (
              <div className={styles.keywordField}>
                <label className={styles.label}>후기 고객 (선택)</label>
                {customers && customers.length > 0 ? (
                  <div className={styles.customerChips}>
                    {customers.map((cust) => (
                      <button
                        key={cust.id}
                        type="button"
                        className={`${styles.custChip} ${draft.customerId === cust.id ? styles.custChipSel : ''}`}
                        onClick={() => set('customerId', draft.customerId === cust.id ? '' : cust.id)}
                      >
                        {cust.name}님
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.stepDesc} style={{ marginBottom: 0 }}>
                    등록된 고객이 없어요. 고객 탭에서 추가하면 이름을 넣어 후기를 만들어드려요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Caption edit */}
        {step === 3 && (
          <div className={styles.step}>
            <h2 className={styles.stepTitle}>캡션을 확인해주세요</h2>
            <p className={styles.stepDesc}>수정하거나 그대로 사용하세요</p>

            {!draft.caption ? (
              <button className={styles.generateBtn} onClick={generateCaption} disabled={generating}>
                {generating ? '✨ 생성 중...' : '✨ AI 캡션 생성하기'}
              </button>
            ) : (
              <>
                <textarea
                  className={styles.captionArea}
                  value={draft.caption}
                  onChange={(e) => set('caption', e.target.value)}
                  rows={8}
                />
                <div className={styles.hashtagWrap}>
                  {draft.hashtags.map((h, i) => (
                    <span key={i} className={styles.hashtag}>{h}</span>
                  ))}
                </div>
                <div className={styles.captionActions}>
                  <button className={styles.regenBtn} onClick={generateCaption} disabled={generating}>
                    {generating ? '재생성 중...' : '↺ 다시 생성'}
                  </button>
                  <button
                    className={`${styles.saveStyleBtn} ${styleSaved ? styles.saveStyleDone : ''}`}
                    onClick={saveStyle}
                    disabled={styleSaved}
                    type="button"
                  >
                    {styleSaved ? '♥ 스타일 저장됨' : '♡ 이 스타일 저장'}
                  </button>
                </div>
              </>
            )}

            {/* Naver blog toggle */}
            {draft.caption && (
              <div className={styles.blogSection}>
                <div className={styles.blogHeader}>
                  <span className={styles.blogTitle}>네이버 블로그 초안</span>
                  <button
                    className={styles.blogGenBtn}
                    onClick={generateBlog}
                    disabled={generating}
                  >
                    {draft.blogTitle ? '↺ 재생성' : '+ 초안 만들기'}
                  </button>
                </div>
                {draft.blogTitle && (
                  <div className={styles.blogPreview}>
                    <input
                      className={styles.blogTitleInput}
                      value={draft.blogTitle}
                      onChange={(e) => set('blogTitle', e.target.value)}
                      placeholder="블로그 제목"
                    />
                    <textarea
                      className={styles.blogBodyArea}
                      value={draft.blogBody}
                      onChange={(e) => set('blogBody', e.target.value)}
                      rows={6}
                    />
                    <button className={styles.naverBtn} type="button" onClick={copyForNaver}>
                      📋 네이버 블로그에 복사해서 붙여넣기
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Kakao Channel helper — copy a ready-to-paste channel message */}
            {draft.caption && (
              <button className={styles.kakaoBtn} type="button" onClick={copyForKakao}>
                💬 카카오 채널용 문구 복사
              </button>
            )}
          </div>
        )}

        {/* Step 4: Publish to Instagram (auto) + schedule */}
        {step === 4 && (
          <div className={styles.step}>
            <h2 className={styles.stepTitle}>인스타그램에 올리기</h2>
            <p className={styles.stepDesc}>인스타그램은 자동 게시돼요. 네이버·카카오는 3단계에서 초안을 복사해 붙여넣으세요.</p>

            <button
              className={`${styles.channelBtn} ${draft.channels.includes('instagram') ? styles.channelSelected : ''}`}
              onClick={() => set('channels', draft.channels.includes('instagram') ? [] : ['instagram'])}
              type="button"
            >
              <span className={styles.channelGlyph} data-ch="instagram"><IgGlyph /></span>
              <span>{CHANNEL_LABELS.instagram}에 자동 게시</span>
              {draft.channels.includes('instagram') && <span className={styles.checkMark}>✓</span>}
            </button>

            <div className={styles.scheduleSection}>
              <label className={styles.label}>예약 발행 (선택)</label>
              <input
                type="datetime-local"
                className={styles.input}
                value={draft.scheduledAt}
                onChange={(e) => set('scheduledAt', e.target.value)}
              />
            </div>

            {/* Summary */}
            <div className={styles.summary}>
              <p className={styles.summaryItem}>
                사진 {draft.mediaIds.length}장 · {POST_THEMES.find((t) => t.id === draft.theme)?.label ?? draft.theme}
                {draft.channels.includes('instagram') ? ' · 인스타 게시' : ' · 저장만'}
              </p>
              <p className={styles.captionPreview}>{draft.caption.slice(0, 80)}{draft.caption.length > 80 ? '…' : ''}</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom action */}
      <div className={styles.footer}>
        {step < 4 ? (
          <button
            className={styles.nextBtn}
            onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={
              (step === 1 && !canNext1) ||
              (step === 2 && !canNext2) ||
              (step === 3 && !canNext3)
            }
          >
            다음
          </button>
        ) : (
          <div className={styles.publishRow}>
            {draft.scheduledAt ? (
              <button
                className={styles.scheduleBtn}
                onClick={() => handlePublish(true)}
                disabled={publishing || !canPublish}
              >
                {publishing ? '처리 중...' : '예약 게시'}
              </button>
            ) : (
              <button
                className={styles.publishBtn}
                onClick={() => handlePublish(false)}
                disabled={publishing || !canPublish}
              >
                {publishing ? '처리 중...' : draft.channels.includes('instagram') ? '지금 게시' : '저장하기'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  )
}

// ─── Theme icons ───────────────────────────────────────────────────────────────
// Stroke line icons matching the soft rose aesthetic (replaces emoji).

function ThemeIcon({ id }: { id: string }) {
  const p = {
    width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
  }
  switch (id) {
    case 'review': // heart / 후기
      return <svg {...p}><path d="M12 20s-7-4.3-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7-1.2C19 15.7 12 20 12 20Z" /></svg>
    case 'before_after': // split compare
      return <svg {...p}><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M12 5v14" /><path d="M6.5 15l2-3 2 2.2" /></svg>
    case 'event': // tag / 할인
      return <svg {...p}><path d="M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4h7l7 7a1.6 1.6 0 0 1 0 2.3l-5.2 5.2a1.6 1.6 0 0 1-2.3 0Z" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" /></svg>
    case 'care_guide': // leaf / 관리
      return <svg {...p}><path d="M5 19c0-8 6-13 14-13 0 8-6 13-14 13Z" /><path d="M5 19c2.5-4 5.5-6.5 9-8" /></svg>
    case 'shop_intro': // storefront
      return <svg {...p}><path d="M4 9.5 5.2 5h13.6L20 9.5" /><path d="M4 9.5h16v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" /><path d="M9.5 19.5V14h5v5.5" /></svg>
    case 'booking_notice': // calendar check
    default:
      return <svg {...p}><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /><path d="M9.5 14.5l1.8 1.8 3.2-3.4" /></svg>
  }
}

function IgGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5.2" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function NaverGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 4h4.6l4.9 7.1V4H19v16h-4.6L9.5 12.9V20H5V4Z" />
    </svg>
  )
}
