import { hostname } from 'node:os'
import { resolve } from 'node:path'

// 렌더 작업자 설정. 실행 환경(맥·VPS·컨테이너)에 따라 바뀌는 값은 모두 환경변수로만 받는다.

export interface WorkerConfig {
  /** 뷰티포스트 API 주소 (예: https://beautypost.shop, 로컬 http://localhost:3000) */
  apiUrl: string
  /** API 의 RENDER_WORKER_TOKEN 과 같은 값 */
  token: string
  workerId: string
  /** filmcraft 저장소 (./br 이 있는 폴더) */
  filmcraftDir: string
  workDir: string
  /** presets/fonts/files (FilmCraft 가 쓸 폰트를 설치할 원본) */
  fontsDir: string
  pollMs: number
  leaseSec: number
  /** 작업 폴더를 남길지 (디버깅) */
  keepWork: boolean
  /** 렌더 엔진: native(기본, ffmpeg 직접 합성) | filmcraft(예전 방식) */
  engine: 'native' | 'filmcraft'
}

export function loadConfig(env = process.env): WorkerConfig {
  const need = (k: string) => {
    const v = env[k]
    if (!v) throw new Error(`환경변수 ${k} 가 필요해요 (apps/worker/README 참고)`)
    return v
  }
  return {
    apiUrl: need('RENDER_API_URL').replace(/\/$/, ''),
    token: need('RENDER_WORKER_TOKEN'),
    workerId: env.WORKER_ID ?? `${hostname()}-${process.pid}`,
    filmcraftDir: resolve(env.FILMCRAFT_DIR ?? '../../../filmcraft'),
    workDir: resolve(env.WORK_DIR ?? '.data/renders'),
    fontsDir: resolve(env.FONTS_DIR ?? '../../presets/fonts/files'),
    pollMs: Number(env.POLL_INTERVAL_MS ?? 3000),
    leaseSec: Number(env.LEASE_SEC ?? 180),
    keepWork: env.KEEP_WORK === '1',
    engine: env.RENDER_ENGINE === 'filmcraft' ? 'filmcraft' : 'native',
  }
}
