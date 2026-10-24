import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, createWriteStream } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { MoodPreset, getRegistry } from '@beautypost/preset'
import { processPhoto, renderCard } from '@beautypost/photocraft'
import { RenderSpec, planVideo, toFilmcraftPlan, toProfile } from '@beautypost/render'

// 렌더 작업 하나: 입력 검증 → 내려받기 → (사진 얼굴 가림) → 카드 그리기 → plan/profile → filmcraft → 결과 파일.
// 큐·업로드는 모른다 (main.ts 가 담당). 로컬에서 바로 돌려 볼 수 있다 (cli.ts).

/** 다시 해도 같은 결과인 실패 (입력 오류). 재시도하지 않는다 */
export class PermanentError extends Error {}

export interface PipelineOptions {
  workDir: string
  filmcraftDir: string
  /** 상대 URL(/api/files/…)을 받을 API 주소 */
  apiUrl?: string
  signal?: AbortSignal
  stage?: (name: string, progress: number) => Promise<void> | void
  /** file:// 미디어 허용 (render-local CLI 만). 큐 작업은 http(s)·API 상대 경로만 */
  allowFileUrls?: boolean
  /** 육아 채널 자동화 잠금을 기다리는 최대 시간 (기본 30분) */
  lockWaitMs?: number
}

export interface PipelineResult {
  video: string
  cover: string
  width: number
  height: number
  duration: number
  qa: string[]
  warnings: string[]
}

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'video/mp4': '.mp4', 'video/quicktime': '.mov' }

async function download(url: string, dest: string, apiUrl?: string, signal?: AbortSignal, allowFile = false): Promise<string> {
  if (url.startsWith('file://')) {
    if (!allowFile) throw new PermanentError(`허용되지 않는 미디어 주소예요: ${url.slice(0, 40)}`)
    const src = fileURLToPath(url)
    const file = dest + extname(src).toLowerCase()
    copyFileSync(src, file)
    return file
  }
  const full = url.startsWith('/') ? `${apiUrl ?? ''}${url}` : url
  if (!/^https?:\/\//.test(full)) throw new PermanentError(`허용되지 않는 미디어 주소예요: ${url.slice(0, 40)}`)
  const res = await fetch(full, { signal })
  if (!res.ok || !res.body) throw new Error(`내려받기 실패 ${res.status}: ${full}`)
  const ext = extname(new URL(full).pathname) || EXT[res.headers.get('content-type') ?? ''] || ''
  const file = dest + ext.toLowerCase()
  const out = createWriteStream(file)
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
  }
  await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
  return file
}

async function waitForBabyreelLock(filmcraftDir: string, signal?: AbortSignal, maxWaitMs = 30 * 60_000): Promise<void> {
  // 같은 맥에서 육아 채널 자동화(scripts/auto.sh)가 FilmCraft 를 쓰는 중이면 끝날 때까지 기다린다.
  // 잠금이 3시간보다 오래됐으면 남은 찌꺼기로 보고 무시, 최대 대기를 넘기면 재시도 가능한 실패로 (임대를 무한히 붙잡지 않게)
  const lock = join(filmcraftDir, 'data/auto.lock')
  const until = Date.now() + maxWaitMs
  while (existsSync(lock)) {
    if (Date.now() - statSync(lock).mtimeMs > 3 * 3600_000) return
    if (Date.now() > until) throw new Error('육아 채널 자동화가 FilmCraft 를 오래 쓰고 있어 나중에 다시 시도해요')
    if (signal?.aborted) throw new Error('중단됨')
    // 기다리는 중에도 종료 신호에는 바로 반응한다
    await new Promise<void>((r) => {
      const t = setTimeout(r, 10_000)
      signal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true })
    })
  }
  if (signal?.aborted) throw new Error('중단됨')
}

function runFilmcraft(filmcraftDir: string, jobDir: string, signal?: AbortSignal): Promise<{ code: number; log: string }> {
  return new Promise((done, fail) => {
    const child = spawn(join(filmcraftDir, 'br'), ['render', jobDir, '--profile', join(jobDir, 'profile.json')], {
      cwd: filmcraftDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    let log = ''
    const keep = (b: Buffer) => {
      log += b.toString()
      if (log.length > 200_000) log = log.slice(-100_000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const onAbort = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', fail)
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      writeFileSync(join(jobDir, 'filmcraft.log'), log)
      done({ code: code ?? 1, log })
    })
  })
}

export async function renderJob(raw: unknown, jobId: string, opts: PipelineOptions): Promise<PipelineResult> {
  const parsed = RenderSpec.safeParse(raw)
  if (!parsed.success) throw new PermanentError(`작업 입력이 올바르지 않아요: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`)
  const spec = parsed.data
  const plan = planVideo(spec)
  if (!plan.clips.length) throw new PermanentError('영상에 쓸 장면이 없어요 (사진·영상을 확인해 주세요)')

  const jobDir = resolve(opts.workDir, jobId)
  const mediaDir = join(jobDir, 'media')
  mkdirSync(mediaDir, { recursive: true })
  const reg = getRegistry()

  await opts.stage?.('download', 5)
  const paths: Record<string, string> = {}
  const used = [...new Map(plan.clips.filter((c) => c.media).map((c) => [c.media!.id, c.media!])).values()]
  let n = 0
  for (const m of used) {
    let file = await download(m.url, join(mediaDir, m.id), opts.apiUrl, opts.signal, opts.allowFileUrls)
    if (m.kind === 'image' && m.blurFaces.length) {
      // 고객이 게시 동의 대신 '얼굴 가림'을 고른 사진
      const meta = await sharp(file).rotate().metadata()
      const w = meta.autoOrient?.width ?? meta.width!
      const h = meta.autoOrient?.height ?? meta.height!
      const out = await processPhoto(readFileSync(file), { width: w, height: h, grade: MoodPreset.shape.grade.parse({}), blur: m.blurFaces, quality: 95 })
      file = join(mediaDir, `${m.id}-blurred.jpg`)
      writeFileSync(file, out.data)
    }
    paths[m.id] = file
    await opts.stage?.('download', 5 + Math.round((++n / used.length) * 15))
  }

  await opts.stage?.('prepare', 22)
  const logo = spec.logoUrl ? readFileSync(await download(spec.logoUrl, join(mediaDir, 'logo'), opts.apiUrl, opts.signal, opts.allowFileUrls)) : null
  for (const c of plan.clips) {
    if (!c.card || paths[c.card.key]) continue
    const png = await renderCard({
      width: spec.format.width,
      height: spec.format.height,
      background: c.card.background,
      lines: c.card.lines,
      logo: c.role === 'cta' ? logo : null,
      safeArea: spec.format.safeArea,
    })
    const file = join(mediaDir, `${c.card.key}.png`)
    writeFileSync(file, png)
    paths[c.card.key] = file
  }
  writeFileSync(join(jobDir, 'plan.json'), JSON.stringify(toFilmcraftPlan(spec, plan, paths, jobId), null, 2))
  writeFileSync(join(jobDir, 'profile.json'), JSON.stringify(toProfile(spec, (id) => reg.font(id).family), null, 2))

  await waitForBabyreelLock(opts.filmcraftDir, opts.signal, opts.lockWaitMs)
  await opts.stage?.('render', 30)
  const { code, log } = await runFilmcraft(opts.filmcraftDir, jobDir, opts.signal)
  if (opts.signal?.aborted) throw new Error('작업이 중단됐어요')
  if (code !== 0) {
    const tail = log.trim().split('\n').slice(-6).join(' / ')
    if (log.includes('plan 오류')) throw new PermanentError(`영상 구성 오류: ${tail}`)
    throw new Error(`filmcraft 실패 (코드 ${code}): ${tail}`)
  }
  const manifest = JSON.parse(readFileSync(join(jobDir, 'render.json'), 'utf8')) as {
    video: string; cover: string; width: number; height: number; duration: number; qa: string[]; warnings: string[]
    segments: { clip_index: number; start: number; end: number }[]
  }
  // 글자 카드(예약 안내 등)는 원래 정지 화면 → '화면 멈춤' 검사에서 뺀다
  const cardSpans = manifest.segments.filter((s) => plan.clips[s.clip_index]?.card).map((s) => [s.start, s.end] as const)
  const qa = manifest.qa.filter((q) => {
    const m = q.match(/^([\d.]+)~([\d.]+)s 화면이 멈춰/)
    if (!m) return true
    const a = Number(m[1])
    const b = Number(m[2])
    return !cardSpans.some(([s, e]) => a >= s - 0.3 && b <= e + 0.3)
  })
  const abs = (p: string) => resolve(opts.filmcraftDir, p) // filmcraft 는 자기 폴더 안이면 상대 경로로 적는다
  await opts.stage?.('render', 90)
  return {
    video: abs(manifest.video),
    cover: abs(manifest.cover),
    width: manifest.width,
    height: manifest.height,
    duration: manifest.duration,
    qa,
    warnings: [...plan.warnings],
  }
}
