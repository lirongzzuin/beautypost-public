import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

// 파일 저장소 어댑터. 다른 모듈은 이 인터페이스로만 저장소를 쓴다.
//   blob  : Vercel Blob (운영). 브라우저·렌더 작업자가 클라이언트 토큰으로 직접 업로드 → 함수 본문 4.5MB 제한을 피함
//   local : .data/storage 디스크 (로컬 개발·테스트). /api/files/* 로 읽고 서명된 URL 로 업로드

export interface StoredObject {
  key: string
  url: string
}

export type UploadTicket =
  | { mode: 'blob'; key: string; token: string }
  | { mode: 'local'; key: string; uploadUrl: string; url: string }

export interface Storage {
  readonly mode: 'blob' | 'local'
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>
  /** 저장된 파일 내용 (서버에서 사진 보정·분석할 때) */
  read(url: string): Promise<Buffer>
  /** 클라이언트가 직접 올릴 수 있는 1회용 업로드 권한 */
  createUploadTicket(key: string, opts: { contentType: string; maxBytes: number }): Promise<UploadTicket>
  /** URL 이 이 저장소의 어떤 key 인지 (소유권 확인용). 이 저장소 URL 이 아니면 null */
  keyFromUrl(url: string): string | null
}

/** 사용자·용도별 경로. 파일명은 무작위라 URL 을 추측할 수 없다. */
export function makeKey(prefix: string, userId: string, filename: string): string {
  const ext = (filename.match(/\.[a-zA-Z0-9]{1,5}$/)?.[0] ?? '').toLowerCase()
  return `${prefix}/${userId}/${Date.now()}_${randomBytes(8).toString('hex')}${ext}`
}

// ─── Vercel Blob ─────────────────────────────────────────────────────────────

class BlobStorage implements Storage {
  readonly mode = 'blob' as const

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const { put } = await import('@vercel/blob')
    const blob = await put(key, body, { access: 'public', contentType, addRandomSuffix: false })
    return { key, url: blob.url }
  }

  async read(url: string): Promise<Buffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`파일을 읽지 못했어요 (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }

  async createUploadTicket(key: string, opts: { contentType: string; maxBytes: number }): Promise<UploadTicket> {
    const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client')
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      pathname: key,
      allowedContentTypes: [opts.contentType],
      maximumSizeInBytes: opts.maxBytes,
      addRandomSuffix: false,
      validUntil: Date.now() + 30 * 60 * 1000,
    })
    return { mode: 'blob', key, token }
  }

  keyFromUrl(url: string): string | null {
    try {
      const u = new URL(url)
      if (!u.hostname.endsWith('.blob.vercel-storage.com')) return null
      return decodeURIComponent(u.pathname.replace(/^\//, ''))
    } catch {
      return null
    }
  }
}

// ─── 로컬 디스크 ──────────────────────────────────────────────────────────────

export const LOCAL_FILES_PREFIX = '/api/files/'

class LocalStorage implements Storage {
  readonly mode = 'local' as const
  constructor(
    readonly root: string,
    private readonly secret: string,
  ) {}

  private path(key: string): string {
    const p = resolve(this.root, key)
    if (!p.startsWith(resolve(this.root) + sep)) throw new Error('잘못된 파일 경로')
    return p
  }

  url(key: string): string {
    return LOCAL_FILES_PREFIX + key
  }

  async put(key: string, body: Buffer): Promise<StoredObject> {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, body)
    return { key, url: this.url(key) }
  }

  async read(url: string): Promise<Buffer> {
    const key = this.keyFromUrl(url)
    if (!key) throw new Error(`로컬 저장소 URL 이 아니에요: ${url}`)
    return readFile(this.path(key))
  }

  sign(key: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${key}:${exp}`).digest('hex')
  }

  verify(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now()) return false
    const want = Buffer.from(this.sign(key, exp))
    const got = Buffer.from(sig)
    return want.length === got.length && timingSafeEqual(want, got)
  }

  async createUploadTicket(key: string): Promise<UploadTicket> {
    const exp = Date.now() + 30 * 60 * 1000
    const uploadUrl = `${LOCAL_FILES_PREFIX}${key}?exp=${exp}&sig=${this.sign(key, exp)}`
    return { mode: 'local', key, uploadUrl, url: this.url(key) }
  }

  keyFromUrl(url: string): string | null {
    let path = url
    try {
      path = new URL(url, 'http://local').pathname
    } catch {
      return null
    }
    return path.startsWith(LOCAL_FILES_PREFIX) ? decodeURIComponent(path.slice(LOCAL_FILES_PREFIX.length)) : null
  }

  readKey(key: string): Promise<Buffer> {
    return readFile(this.path(key))
  }
}

let _storage: Storage | null = null

/** BLOB_READ_WRITE_TOKEN 이 있으면 Vercel Blob, 없으면 로컬 디스크. STORAGE=local 로 강제할 수 있다. */
export function getStorage(): Storage {
  if (!_storage) {
    const useBlob = process.env.STORAGE !== 'local' && !!process.env.BLOB_READ_WRITE_TOKEN
    if (useBlob) {
      _storage = new BlobStorage()
    } else {
      if (process.env.VERCEL && process.env.NODE_ENV === 'production') {
        throw new Error('운영 환경에는 BLOB_READ_WRITE_TOKEN 이 필요해요')
      }
      const root = resolve(process.env.LOCAL_STORAGE_DIR ?? '.data/storage')
      _storage = new LocalStorage(root, process.env.JWT_SECRET || 'local-dev-secret')
    }
  }
  return _storage
}

export function setStorage(s: Storage | null): void {
  _storage = s
}

export function localStorage(): LocalStorage | null {
  const s = getStorage()
  return s instanceof LocalStorage ? s : null
}

export { LocalStorage, BlobStorage }
