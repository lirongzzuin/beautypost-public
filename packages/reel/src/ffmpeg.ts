import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

// ffmpeg 실행: 영상 길이·크기 읽기, 영상 구간을 원시 프레임으로 풀기, 원시 프레임을 mp4 로 굽기.
// 바이너리는 ffmpeg-static (npm) 이 받아 둔 것을 쓴다 → 맥·리눅스·컨테이너 어디서나 같은 방식. FFMPEG_PATH 로 바꿀 수 있다.

const require = createRequire(import.meta.url)

export function ffmpegPath(): string {
  const p = process.env.FFMPEG_PATH || (require('ffmpeg-static') as string | null)
  if (!p || !existsSync(p)) throw new Error('ffmpeg 를 찾을 수 없어요 (pnpm install 로 ffmpeg-static 설치 또는 FFMPEG_PATH 지정)')
  try {
    chmodSync(p, 0o755)
  } catch {
    // 읽기 전용 위치면 이미 실행 권한이 있다고 본다
  }
  return p
}

export interface MediaInfo {
  width: number
  height: number
  duration: number
}

/** `ffmpeg -i` 출력에서 크기(회전 반영)·길이를 읽는다 (ffprobe 없이) */
export async function probe(file: string): Promise<MediaInfo> {
  const text = await new Promise<string>((done, fail) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file])
    let err = ''
    p.stderr.on('data', (b: Buffer) => (err += b.toString()))
    p.on('error', fail)
    p.on('close', () => done(err))
  })
  const dur = text.match(/Duration: (\d+):(\d+):([\d.]+)/)
  const size = text.match(/Stream #\S+.*Video:.*?(\d{2,5})x(\d{2,5})/)
  if (!size) throw new Error(`영상 정보를 읽지 못했어요: ${file}`)
  let width = Number(size[1])
  let height = Number(size[2])
  // 휴대폰 세로 영상은 가로로 저장하고 회전 값만 붙인다 (ffmpeg 는 풀 때 자동으로 돌린다)
  const rot = text.match(/rotation of (-?[\d.]+) degrees/) ?? text.match(/rotate\s*:\s*(-?\d+)/)
  if (rot && Math.abs(Number(rot[1])) % 180 === 90) [width, height] = [height, width]
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0
  return { width, height, duration }
}

/**
 * 영상 구간 → W×H RGB 프레임들 (화면을 꽉 채우게 키운 뒤 focus 기준으로 자른다).
 * 프레임 수는 정확히 count 개 (원본이 짧으면 마지막 프레임을 반복).
 */
export async function* decodeFrames(
  file: string,
  o: { start: number; duration: number; width: number; height: number; fps: number; focus: { x: number; y: number }; count: number; signal?: AbortSignal },
): AsyncGenerator<Buffer> {
  const W = o.width
  const H = o.height
  const fx = Math.min(1, Math.max(0, o.focus.x)).toFixed(3)
  const fy = Math.min(1, Math.max(0, o.focus.y)).toFixed(3)
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:(iw-ow)*${fx}:(ih-oh)*${fy},fps=${o.fps},format=rgb24`
  const args = ['-hide_banner', '-loglevel', 'error', '-ss', o.start.toFixed(3), '-t', (o.duration + 0.5).toFixed(3), '-i', file, '-an', '-vf', vf, '-f', 'rawvideo', 'pipe:1']
  const p = spawn(ffmpegPath(), args)
  const onAbort = () => p.kill('SIGKILL')
  o.signal?.addEventListener('abort', onAbort, { once: true })
  let err = ''
  p.on('error', (e) => (err += String(e)))
  p.stderr.on('data', (b: Buffer) => (err += b.toString()))
  const frameSize = W * H * 3
  let pending: Buffer[] = []
  let pendingLen = 0
  let produced = 0
  let last: Buffer | null = null
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      pending.push(chunk)
      pendingLen += chunk.length
      while (pendingLen >= frameSize && produced < o.count) {
        const all = Buffer.concat(pending)
        last = all.subarray(0, frameSize)
        const rest = all.subarray(frameSize)
        pending = rest.length ? [rest] : []
        pendingLen = rest.length
        produced++
        yield Buffer.from(last)
      }
      if (produced >= o.count) break
    }
  } finally {
    o.signal?.removeEventListener('abort', onAbort)
    p.kill('SIGKILL')
  }
  if (!last) throw new Error(`영상 프레임을 풀지 못했어요: ${err.trim().split('\n').slice(-2).join(' / ')}`)
  while (produced < o.count) {
    produced++
    yield Buffer.from(last)
  }
}

/** 원시 RGB 프레임을 받아 H.264 mp4 로 굽는다 (소리는 무음 트랙 — 음악은 인스타그램 앱에서 넣는 것을 권장) */
export class Encoder {
  private readonly p: ChildProcessWithoutNullStreams
  private err = ''
  private readonly done: Promise<number>
  private exited = false

  constructor(
    readonly out: string,
    o: { width: number; height: number; fps: number; videoKbps?: number; signal?: AbortSignal },
  ) {
    const maxrate = `${Math.round((o.videoKbps ?? 12000) * 1.2)}k`
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-c:v', 'libx264', '-preset', process.env.REEL_X264_PRESET ?? 'veryfast', '-crf', '18', '-maxrate', maxrate, '-bufsize', maxrate,
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      out,
    ]
    this.p = spawn(ffmpegPath(), args)
    this.p.stderr.on('data', (b: Buffer) => (this.err += b.toString()))
    this.p.on('error', (e) => (this.err += String(e)))
    o.signal?.addEventListener('abort', () => this.kill(), { once: true })
    this.done = new Promise((r) => this.p.on('close', (code) => ((this.exited = true), r(code ?? 1))))
    this.p.stdin.on('error', () => undefined) // 인코더가 먼저 죽으면 write/finish 에서 오류를 알린다
  }

  async write(frame: Buffer): Promise<void> {
    if (this.exited) throw new Error(`영상 인코더가 멈췄어요: ${this.tail()}`)
    if (this.p.stdin.write(frame)) return
    // 버퍼가 비기를 기다리는 동안 인코더가 죽으면 drain 이 오지 않는다 → 종료도 같이 기다린다
    const exited = await Promise.race([
      new Promise<false>((r) => this.p.stdin.once('drain', () => r(false))),
      this.done.then(() => true as const),
    ])
    if (exited) throw new Error(`영상 인코더가 멈췄어요: ${this.tail()}`)
  }

  kill(): void {
    if (!this.exited) this.p.kill('SIGKILL')
  }

  private tail(): string {
    return this.err.trim().split('\n').slice(-3).join(' / ')
  }

  async finish(): Promise<void> {
    this.p.stdin.end()
    const code = await this.done
    if (code !== 0) throw new Error(`영상 인코딩 실패: ${this.tail()}`)
  }
}
