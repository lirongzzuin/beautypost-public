import type { StorageAdapter } from '../interface'

// Web: localStorage for non-sensitive data.
// Tokens are stored in memory + httpOnly cookies via API.
export const webStorage: StorageAdapter = {
  async get(key) {
    return localStorage.getItem(key)
  },
  async set(key, value) {
    localStorage.setItem(key, value)
  },
  async remove(key) {
    localStorage.removeItem(key)
  },
  async clear() {
    localStorage.clear()
  },
}
