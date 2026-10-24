// 렌더 작업자: 대기 작업을 가져와(pull) 영상을 만들고, 저장소에 올리고, 완료를 보고한다.
//   pnpm --filter @beautypost/worker start      (환경변수: README "로컬 작업자 실행")
//
// 유실 방지: 작업 중에는 하트비트로 임대를 연장한다. 이 프로세스가 죽으면 임대가 만료돼 다른 작업자(또는 재시작한
// 이 작업자)가 이어받는다. Ctrl+C·SIGTERM 이면 진행 중인 작업의 임대를 반납하고 끝낸다 (바로 다시 대기열로).

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { ensureFonts } from './fonts.js'
import { LeaseLostError, WorkerApi, type ClaimedJob } from './api.js'
import { PermanentError, renderJob } from './pipeline.js'

const cfg = loadConfig()
const api = new WorkerApi(cfg)
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

let stopping = false
let current: { job: ClaimedJob; abort: AbortController } | null = null

async function shutdown(sig: string) {
  if (stopping) process.exit(1)
  stopping = true
  log(`${sig} — 종료합니다`)
  if (current) {
    current.abort.abort()
    await api.release(current.job).catch((e) => log('임대 반납 실패 (만료되면 자동으로 다시 대기열로):', e.message))
  }
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

async function runOne(job: ClaimedJob): Promise<void> {
  const abort = new AbortController()
  current = { job, abort }
  let progress = 1
  let stage = 'start'
  let lost = false
  const beat = setInterval(() => {
    api.heartbeat(job, progress, stage).catch((e) => {
      if (e instanceof LeaseLostError) {
        lost = true
        abort.abort()
      }
      log('하트비트 실패:', e.message)
    })
  }, Math.min(10, Math.max(5, Math.floor(cfg.leaseSec / 3))) * 1000) // 진행률도 이 간격으로 갱신
  try {
    await api.heartbeat(job, progress, stage)
    const r = await renderJob(job.payload, job.id, {
      workDir: cfg.workDir,
      filmcraftDir: cfg.filmcraftDir,
      apiUrl: cfg.apiUrl,
      signal: abort.signal,
      stage: (s, p) => {
        const changed = s !== stage
        stage = s
        progress = p
        // 단계가 바뀌면 바로 알린다 (원장님 화면의 진행률). 단계는 몇 개뿐이라 매번 보내도 된다
        if (changed) api.heartbeat(job, progress, stage).catch(() => undefined)
      },
    })
    stage = 'upload'
    progress = 92
    await api.heartbeat(job, progress, stage)
    const video = await api.upload(job, 'video.mp4', r.video, 'video/mp4')
    const cover = await api.upload(job, r.cover.endsWith('.png') ? 'cover.png' : 'cover.jpg', r.cover, r.cover.endsWith('.png') ? 'image/png' : 'image/jpeg')
    await api.complete(job, { video, cover, width: r.width, height: r.height, duration: r.duration, qa: r.qa, warnings: r.warnings })
    log(`✓ ${job.id} 완료 (${r.duration}s)`)
    if (!cfg.keepWork) rmSync(join(cfg.workDir, job.id), { recursive: true, force: true })
  } catch (e) {
    const err = e as Error
    if (lost || stopping) {
      log(`작업 ${job.id} 중단 (${lost ? '임대를 잃음' : '종료'})`)
      return
    }
    const permanent = err instanceof PermanentError
    log(`✗ ${job.id} 실패 (${permanent ? '재시도 안 함' : '재시도'}): ${err.message}`)
    await api.fail(job, err.message, !permanent).catch((x) => log('실패 보고 실패:', x.message))
  } finally {
    clearInterval(beat)
    current = null
  }
}

async function main() {
  const installed = ensureFonts(cfg.fontsDir)
  if (installed.length) log(`폰트 설치: ${installed.join(', ')}`)
  log(`작업자 ${cfg.workerId} 시작 → ${cfg.apiUrl} (filmcraft: ${cfg.filmcraftDir})`)
  while (!stopping) {
    try {
      const job = await api.claim()
      if (job) {
        log(`▶ ${job.id} (${job.type}, ${job.attempts}/${job.maxAttempts}번째 시도)`)
        await runOne(job)
        continue
      }
    } catch (e) {
      log('대기열 확인 실패:', (e as Error).message)
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs))
  }
}

void main()
