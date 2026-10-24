import { readFileSync, statSync } from 'node:fs'
import type { WorkerConfig } from './config.js'

// 뷰티포스트 API 의 작업자 전용 엔드포인트 (/api/worker/*) 클라이언트.
// 작업자는 DB 에 직접 붙지 않는다 → 어디서 돌든 필요한 건 API 주소와 토큰뿐.

export interface ClaimedJob {
  id: string
  type: string
  attempts: number
  maxAttempts: number
  payload: unknown
  leaseToken: string
}

export class LeaseLostError extends Error {}

export class WorkerApi {
  constructor(private readonly cfg: WorkerConfig) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    const res = await fetch(`${this.cfg.apiUrl}/api/worker${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return { status: 204, data: null }
    const json = (await res.json().catch(() => ({}))) as { data?: T; message_ko?: string; code?: string }
    if (res.status === 409) throw new LeaseLostError(json.message_ko ?? '임대를 잃었어요')
    if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status} ${json.code ?? ''} ${json.message_ko ?? ''}`)
    return { status: res.status, data: json.data ?? null }
  }

  async claim(): Promise<ClaimedJob | null> {
    const { data } = await this.call<ClaimedJob>('POST', '/claim', { workerId: this.cfg.workerId, leaseSec: this.cfg.leaseSec })
    return data
  }

  async heartbeat(job: ClaimedJob, progress: number, stage: string): Promise<void> {
    await this.call('POST', `/jobs/${job.id}/heartbeat`, { leaseToken: job.leaseToken, progress, stage, leaseSec: this.cfg.leaseSec })
  }

  /** 결과 파일 올리기: API 가 정한 저장소(Vercel Blob 또는 로컬)에 직접 */
  async upload(job: ClaimedJob, name: string, file: string, contentType: string): Promise<{ key: string; url: string }> {
    const size = statSync(file).size
    const { data } = await this.call<
      { mode: 'blob'; key: string; token: string } | { mode: 'local'; key: string; uploadUrl: string; url: string }
    >('POST', `/jobs/${job.id}/upload-ticket`, { leaseToken: job.leaseToken, name, contentType, size })
    const t = data!
    const body = readFileSync(file)
    if (t.mode === 'blob') {
      const { put } = await import('@vercel/blob/client')
      const blob = await put(t.key, body, { access: 'public', token: t.token, contentType, multipart: size > 20 * 1024 * 1024 })
      return { key: t.key, url: blob.url }
    }
    const res = await fetch(`${this.cfg.apiUrl}${t.uploadUrl}`, { method: 'PUT', headers: { 'Content-Type': contentType }, body })
    if (!res.ok) throw new Error(`업로드 실패 ${res.status}`)
    return { key: t.key, url: t.url }
  }

  async complete(job: ClaimedJob, result: Record<string, unknown>): Promise<void> {
    await this.call('POST', `/jobs/${job.id}/complete`, { leaseToken: job.leaseToken, result })
  }

  async fail(job: ClaimedJob, error: string, retryable: boolean): Promise<void> {
    await this.call('POST', `/jobs/${job.id}/fail`, { leaseToken: job.leaseToken, error: error.slice(0, 2000), retryable })
  }

  async release(job: ClaimedJob): Promise<void> {
    await this.call('POST', `/jobs/${job.id}/release`, { leaseToken: job.leaseToken })
  }
}
