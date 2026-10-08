import { useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { api } from '~/api/client'
import { POST_THEMES, CHANNEL_LABELS } from '@beautypost/shared'
import styles from './CreatePostPage.module.css'

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
}

const INITIAL: DraftState = {
  mediaIds: [], mediaPreviews: [], theme: '', keywords: '',
  channels: [], caption: '', hashtags: [],
  blogTitle: '', blogBody: '', blogTags: [], scheduledAt: '',
}

export default function CreatePostPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<DraftState>(INITIAL)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  // ─── Step 1: Media upload ────────────────────────────────────────────────────

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const newIds: string[] = []
    const newPreviews: string[] = []

    for (const file of Array.from(files).slice(0, 10)) {
      try {
        const preview = URL.createObjectURL(file)
        const formData = new FormData()
        formData.append('file', file)

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
      })
      set('caption', data.caption)
      set('hashtags', data.hashtags)
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

  // ─── Step 4: Publish ─────────────────────────────────────────────────────────

  async function handlePublish(schedule: boolean) {
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

      if (!schedule) {
        await api.post(`/posts/${post.id}/publish`, {})
        toast.show('게시됐어요! 🎉')
      } else {
        toast.show('예약 게시가 설정됐어요 📅')
      }

      navigate({ to: '/' })
    } catch {
      toast.show('게시에 실패했어요. 다시 시도해주세요.', 'error')
    } finally {
      setPublishing(false)
    }
  }

  const canNext1 = draft.mediaIds.length > 0 || step > 1
  const canNext2 = draft.theme !== ''
  const canNext3 = draft.caption.trim().length > 0
  const canPublish = draft.channels.length > 0

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
            <p className={styles.stepDesc}>최대 10개, 100MB 이하</p>

            <div className={styles.mediaGrid}>
              {draft.mediaPreviews.map((url, i) => (
                <div key={i} className={styles.mediaThumb}>
                  <img src={url} alt="" className={styles.thumbImg} />
                  <button
                    className={styles.removeBtn}
                    onClick={() => {
                      set('mediaIds', draft.mediaIds.filter((_, j) => j !== i))
                      set('mediaPreviews', draft.mediaPreviews.filter((_, j) => j !== i))
                    }}
                  >×</button>
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
                  <span className={styles.themeIcon}>{t.icon === 'favorite' ? '❤️' : t.icon === 'compare' ? '🔄' : t.icon === 'loyalty' ? '🏷️' : t.icon === 'spa' ? '🌿' : t.icon === 'storefront' ? '🏪' : '📅'}</span>
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
                <button className={styles.regenBtn} onClick={generateCaption} disabled={generating}>
                  {generating ? '재생성 중...' : '↺ 다시 생성'}
                </button>
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
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Channels & publish */}
        {step === 4 && (
          <div className={styles.step}>
            <h2 className={styles.stepTitle}>어디에 올릴까요?</h2>
            <p className={styles.stepDesc}>채널을 선택하고 게시해주세요</p>

            <div className={styles.channelList}>
              {(Object.entries(CHANNEL_LABELS) as [string, string][]).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.channelBtn} ${draft.channels.includes(key) ? styles.channelSelected : ''}`}
                  onClick={() => {
                    const next = draft.channels.includes(key)
                      ? draft.channels.filter((c) => c !== key)
                      : [...draft.channels, key]
                    set('channels', next)
                  }}
                  type="button"
                >
                  <span>{key === 'instagram' ? '📸' : '📝'}</span>
                  <span>{label}</span>
                  {draft.channels.includes(key) && <span className={styles.checkMark}>✓</span>}
                </button>
              ))}
            </div>

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
                📷 사진 {draft.mediaIds.length}장 · {draft.theme} · {draft.channels.length}개 채널
              </p>
              <p className={styles.captionPreview}>{draft.caption.slice(0, 80)}...</p>
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
                {publishing ? '게시 중...' : '지금 게시'}
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
