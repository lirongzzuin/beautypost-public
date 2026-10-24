import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useToast } from '@beautypost/ui'
import { contentApi, GENRE_LABELS, STAGE_LABELS, type Drafts, type Finding, type PresetCatalog } from '~/api/content'
import { api, ApiRequestError } from '~/api/client'
import { platform } from '~/lib/platform'
import { useAuthStore } from '~/store/auth'
import type { Choices, Item } from './types'
import styles from './create.module.css'

interface Props {
  presets: PresetCatalog
  choices: Choices
  items: Item[]
  onRestart: () => void
}

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.messageKo : '만들지 못했어요. 잠시 후 다시 시도해 주세요.'
}

export default function StepResults({ presets, choices, items, onRestart }: Props) {
  const navigate = useNavigate()
  const toast = useToast()
  const shopName = useAuthStore((s) => s.user?.shopName) ?? undefined
  const mediaIds = items.map((i) => i.media!.id)
  const common = { mediaIds, purpose: choices.purpose, industry: choices.industry, mood: choices.mood }
  const key = JSON.stringify(common)
  const once = { retry: false, staleTime: Infinity, gcTime: 30 * 60_000, refetchOnWindowFocus: false } as const

  const drafts = useQuery({
    queryKey: ['create', 'drafts', key, choices.keywords, choices.customerId],
    queryFn: () => contentApi.drafts({ ...common, keywords: choices.keywords || undefined, customerId: choices.customerId || undefined }),
    enabled: choices.wantDrafts,
    ...once,
  })
  const hasPhotos = items.some((i) => i.kind === 'image')
  const photos = useQuery({
    queryKey: ['create', 'photos', key, choices.photoFormats, choices.overlayShopName],
    queryFn: () => contentApi.photos({ ...common, formats: choices.photoFormats, overlayText: choices.overlayShopName ? shopName : undefined }),
    enabled: choices.wantPhotos && hasPhotos && choices.photoFormats.length > 0,
    ...once,
  })
  const video = useQuery({
    queryKey: ['create', 'video', key, choices.videoFormat, choices.keywords],
    queryFn: () => contentApi.video({ ...common, format: choices.videoFormat, keywords: choices.keywords || undefined }),
    enabled: choices.wantVideo,
    ...once,
  })

  const [chosenIg, setChosenIg] = useState<string | null>(null)
  const [chosenBlog, setChosenBlog] = useState<string | null>(null)

  async function savePost() {
    try {
      const d = drafts.data
      const ig = chosenIg ?? d?.instagram[0]?.text ?? ''
      const [caption, ...tagLines] = ig.split(/\n\n(?=#)/)
      const blog = chosenBlog ?? d?.blog[0]?.text ?? ''
      const [blogTitle, ...blogBody] = blog.split('\n')
      await api.post('/posts', {
        caption: caption || ' ',
        hashtags: (tagLines.join(' ').match(/#\S+/g) ?? []) as string[],
        mediaIds: photos.data?.outputs.map((o) => o.mediaId) ?? mediaIds,
        channels: [],
        theme: choices.purpose,
        keywords: choices.keywords || undefined,
        blogTitle: blogTitle || undefined,
        blogBody: blogBody.join('\n').trim() || undefined,
      })
      toast.show('게시물 목록에 저장했어요 📋')
      navigate({ to: '/posts' })
    } catch (e) {
      toast.show(errMsg(e), 'error')
    }
  }

  return (
    <>
      {choices.wantDrafts && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>📝 게시글</h3>
          {drafts.isLoading && <Skeleton text="사진을 보고 글을 쓰는 중이에요…" />}
          {drafts.isError && <Retry msg={errMsg(drafts.error)} onRetry={() => drafts.refetch()} />}
          {drafts.data && <DraftsPanel drafts={drafts.data} onPickIg={setChosenIg} onPickBlog={setChosenBlog} />}
        </section>
      )}

      {choices.wantPhotos && hasPhotos && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>🖼 보정 사진</h3>
          {photos.isLoading && <Skeleton text="사진 보정 중…" />}
          {photos.isError && <Retry msg={errMsg(photos.error)} onRetry={() => photos.refetch()} />}
          {photos.data && <PhotosPanel outputs={photos.data.outputs} clamped={photos.data.clamped} presets={presets} />}
        </section>
      )}

      {choices.wantVideo && (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>🎬 영상</h3>
          {video.isLoading && <Skeleton text="영상 작업을 등록하는 중…" />}
          {video.isError && <Retry msg={errMsg(video.error)} onRetry={() => video.refetch()} />}
          {video.data && (
            <VideoPanel jobId={video.data.jobId} warnings={video.data.warnings} music={presets.moods.find((m) => m.id === choices.mood)?.video.music} />
          )}
        </section>
      )}

      <div className={styles.resultActions}>
        <a className={styles.secondaryBtn} href="https://www.instagram.com/" target="_blank" rel="noreferrer">
          인스타그램 열기
        </a>
        <button type="button" className={styles.secondaryBtn} onClick={savePost} disabled={drafts.isLoading || photos.isLoading}>
          게시물로 저장
        </button>
        <button type="button" className={styles.linkBtn} onClick={onRestart}>
          새로 만들기
        </button>
      </div>
    </>
  )
}

function Skeleton({ text }: { text: string }) {
  return (
    <div className={styles.skeleton}>
      <span className={styles.spinner} /> {text}
    </div>
  )
}

function Retry({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className={styles.errorBox}>
      {msg}{' '}
      <button type="button" className={styles.linkBtn} onClick={onRetry}>
        다시 시도
      </button>
    </div>
  )
}

function FindingList({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null
  return (
    <ul className={styles.findings}>
      {findings.map((f, i) => (
        <li key={i} className={f.severity === 'block' ? styles.findingBlock : styles.findingWarn}>
          “{f.match}” — {f.reason}
          {f.suggest ? ` (예: ${f.suggest})` : ''}
        </li>
      ))}
    </ul>
  )
}

// ─── 게시글: 채널 탭 · 후보 · 바로 복사 ─────────────────────────────────────────

type Channel = 'instagram' | 'blog' | 'kakao'

function DraftsPanel({ drafts, onPickIg, onPickBlog }: { drafts: Drafts; onPickIg: (t: string) => void; onPickBlog: (t: string) => void }) {
  const toast = useToast()
  const [channel, setChannel] = useState<Channel>('instagram')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const list =
    channel === 'blog'
      ? drafts.blog.map((b, i) => ({ id: `blog-${i}`, label: `후보 ${i + 1}`, text: b.text, findings: b.findings, rewritten: b.rewritten }))
      : drafts.instagram.map((c, i) => ({
          id: `${channel}-${i}`,
          label: `후보 ${i + 1} · ${c.angle}`,
          text: channel === 'kakao' ? c.kakao : c.text,
          findings: c.findings,
          rewritten: c.rewritten,
        }))

  async function copy(id: string, index: number, text: string) {
    try {
      await platform.clipboard.copy(text)
      setCopied(id)
      toast.show(channel === 'blog' ? '복사했어요. 네이버 블로그 글쓰기에 붙여넣고 [사진 N] 자리에 사진을 넣어 주세요.' : '복사했어요. 붙여넣기만 하면 돼요!')
      if (channel === 'instagram') onPickIg(text)
      if (channel === 'blog') onPickBlog(text)
      // 고른 글(고친 글)은 다음 생성 때 원장님 말투로 반영된다
      if (channel !== 'kakao') void contentApi.feedback(drafts.id, { channel, index, text }).catch(() => undefined)
    } catch {
      toast.show('복사하지 못했어요. 글을 길게 눌러 복사해 주세요.', 'error')
    }
  }

  return (
    <>
      <div className={styles.tabs}>
        {(['instagram', 'blog', 'kakao'] as Channel[]).map((c) => (
          <button key={c} type="button" className={`${styles.tab} ${channel === c ? styles.tabOn : ''}`} onClick={() => setChannel(c)}>
            {c === 'instagram' ? '인스타그램' : c === 'blog' ? '네이버 블로그' : '카카오톡'}
          </button>
        ))}
      </div>
      {channel === 'blog' && drafts.keyword && <p className={styles.hint}>검색 키워드 “{drafts.keyword}”를 제목·소제목에 넣었어요.</p>}
      {list.map((c, i) => {
        const value = texts[c.id] ?? c.text
        return (
          <div key={c.id} className={styles.candidate}>
            <div className={styles.candidateHead}>
              <span>{c.label}</span>
              {c.rewritten && <span className={styles.tag}>표현 자동 수정됨</span>}
            </div>
            <textarea
              className={styles.candidateText}
              value={value}
              rows={Math.min(22, Math.max(6, value.split('\n').length + 1))}
              onChange={(e) => setTexts((t) => ({ ...t, [c.id]: e.target.value }))}
            />
            <FindingList findings={c.findings} />
            <button type="button" className={styles.copyBtn} onClick={() => copy(c.id, i, value)}>
              {copied === c.id ? '✓ 복사됨' : '📋 복사하기'}
            </button>
          </div>
        )
      })}
    </>
  )
}

// ─── 보정 사진: 저장 ────────────────────────────────────────────────────────────

function PhotosPanel({ outputs, clamped, presets }: { outputs: { mediaId: string; url: string; formatId: string; kind: string }[]; clamped: string[]; presets: PresetCatalog }) {
  const toast = useToast()
  const label = (id: string) => presets.formats.find((f) => f.id === id)?.label ?? id
  async function save(list: typeof outputs) {
    try {
      const r = await platform.share.saveFiles(list.map((o, i) => ({ url: o.url, filename: `beautypost-${o.formatId}-${i + 1}.jpg`, mimeType: 'image/jpeg' })))
      if (r === 'downloaded') toast.show('사진을 저장했어요.')
    } catch {
      toast.show('저장하지 못했어요. 사진을 길게 눌러 저장해 주세요.', 'error')
    }
  }
  return (
    <>
      {clamped.length > 0 && <p className={styles.hint}>업종 기준에 맞게 색감을 조금 줄였어요 (실제와 다르게 보이지 않도록).</p>}
      <div className={styles.photoGrid}>
        {outputs.map((o) => (
          <figure key={o.mediaId} className={styles.photoCard}>
            <img src={o.url} alt="" loading="lazy" />
            <figcaption>
              {o.kind === 'collage' ? '비포·애프터' : '사진'} · {label(o.formatId)}
            </figcaption>
            <button type="button" className={styles.smallBtn} onClick={() => save([o])}>
              저장
            </button>
          </figure>
        ))}
      </div>
      {outputs.length > 1 && (
        <button type="button" className={styles.copyBtn} onClick={() => save(outputs)}>
          ⬇ 모두 저장 ({outputs.length}장)
        </button>
      )}
    </>
  )
}

// ─── 영상: 진행률 → 완성되면 저장 ───────────────────────────────────────────────

export function VideoPanel({ jobId, warnings, music }: { jobId: string; warnings: string[]; music?: { genres: string[]; bpm: [number, number] } }) {
  const toast = useToast()
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => contentApi.job(jobId),
    refetchInterval: (q) => (q.state.data && ['completed', 'failed'].includes(q.state.data.status) ? false : 3000),
  })
  const j = job.data
  async function save(kind: 'video' | 'cover') {
    if (!j?.result) return
    try {
      const r = kind === 'video'
        ? await platform.share.saveFiles([{ url: j.result.video.url, filename: 'beautypost-reel.mp4', mimeType: 'video/mp4' }])
        : await platform.share.saveFiles([{ url: j.result.cover.url, filename: 'beautypost-cover.jpg', mimeType: 'image/jpeg' }])
      if (r === 'downloaded') toast.show('저장했어요.')
    } catch {
      toast.show('저장하지 못했어요.', 'error')
    }
  }
  return (
    <>
      {warnings.map((w) => (
        <p key={w} className={styles.hint}>
          {w}
        </p>
      ))}
      {!j || j.status === 'pending' || j.status === 'processing' ? (
        <div className={styles.jobBox}>
          <div className={styles.jobBar}>
            <div style={{ width: `${Math.max(3, j?.progress ?? 0)}%` }} />
          </div>
          <p className={styles.hint}>
            {j?.status === 'pending' ? '순서를 기다리는 중이에요. 이 화면을 닫아도 완성되면 알림으로 알려 드려요.' : STAGE_LABELS[j?.stage ?? 'start'] ?? '영상 만드는 중'}
          </p>
        </div>
      ) : j.status === 'failed' ? (
        <div className={styles.errorBox}>영상을 만들지 못했어요: {j.error}</div>
      ) : (
        <>
          <video className={styles.video} src={j.result!.video.url} poster={j.result!.cover.url} controls playsInline />
          <div className={styles.rowBtns}>
            <button type="button" className={styles.copyBtn} onClick={() => save('video')}>
              ⬇ 영상 저장
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => save('cover')}>
              커버 저장
            </button>
          </div>
          {music && (
            <p className={styles.hint}>
              🎵 인스타그램 앱에서 음악을 넣어 주세요. 이 분위기엔 {music.genres.map((g) => GENRE_LABELS[g] ?? g).join('·')} ({music.bpm[0]}~{music.bpm[1]} BPM)이 잘 어울려요.
            </p>
          )}
        </>
      )}
    </>
  )
}
