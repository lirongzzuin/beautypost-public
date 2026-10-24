import type { ApiError } from '@beautypost/shared'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}

  // Don't set Content-Type for FormData — browser sets it with multipart boundary
  if (!(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  Object.assign(headers, init?.headers as Record<string, string>)

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (res.status === 401) {
    // Try to refresh
    const refreshed = await tryRefresh()
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`
      const retry = await fetch(`${API_BASE}${path}`, { ...init, headers })
      if (!retry.ok) {
        const err = await retry.json() as ApiError
        throw new ApiRequestError(err.code, err.message_ko, retry.status)
      }
      return retry.json() as Promise<T>
    } else {
      setAccessToken(null)
      window.location.href = '/auth/login'
      throw new ApiRequestError('AUTH_UNAUTHORIZED', '로그인이 필요해요.', 401)
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ code: 'INTERNAL_ERROR', message_ko: '오류가 발생했어요.' })) as ApiError
    throw new ApiRequestError(err.code, err.message_ko, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return false

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      localStorage.removeItem('refreshToken')
      return false
    }
    const { data } = await res.json() as { data: { accessToken: string; refreshToken: string } }
    setAccessToken(data.accessToken)
    localStorage.setItem('refreshToken', data.refreshToken)
    return true
  } catch {
    return false
  }
}

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageKo: string,
    public readonly status: number,
  ) {
    super(messageKo)
    this.name = 'ApiRequestError'
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
}
