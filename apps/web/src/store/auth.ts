import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser, Entitlement } from '@beautypost/shared'
import { api, setAccessToken, ApiRequestError } from '~/api/client'

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  // Actions
  initialize: () => Promise<void>
  login: (accessToken: string, refreshToken: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,

      initialize: async () => {
        const refreshToken = localStorage.getItem('refreshToken')
        if (!refreshToken) {
          set({ isLoading: false })
          return
        }

        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          })
          if (!res.ok) throw new Error('refresh failed')
          const { data } = await res.json() as { data: { accessToken: string; refreshToken: string } }
          setAccessToken(data.accessToken)
          localStorage.setItem('refreshToken', data.refreshToken)
          await get().refreshUser()
        } catch {
          setAccessToken(null)
          localStorage.removeItem('refreshToken')
          set({ user: null, isLoading: false })
        }
      },

      login: async (accessToken: string, refreshToken: string) => {
        setAccessToken(accessToken)
        localStorage.setItem('refreshToken', refreshToken)
        await get().refreshUser()
      },

      logout: () => {
        const refreshToken = localStorage.getItem('refreshToken')
        if (refreshToken) {
          api.post('/auth/logout', { refreshToken }).catch(() => {})
        }
        setAccessToken(null)
        localStorage.removeItem('refreshToken')
        set({ user: null })
      },

      refreshUser: async () => {
        try {
          const { data } = await api.get<{ data: AuthUser }>('/auth/me')
          set({ user: data, isLoading: false })
        } catch (err) {
          if (err instanceof ApiRequestError && err.status === 401) {
            set({ user: null, isLoading: false })
          } else {
            set({ isLoading: false })
          }
        }
      },
    }),
    {
      name: 'beautypost-auth',
      partialize: () => ({}), // Don't persist — refresh token in localStorage is source of truth
    },
  ),
)
