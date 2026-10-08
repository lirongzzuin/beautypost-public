import type { LifecycleAdapter } from '../interface'

export const webLifecycle: LifecycleAdapter = {
  onForeground(handler) {
    const listener = () => { if (!document.hidden) handler() }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
  onBackground(handler) {
    const listener = () => { if (document.hidden) handler() }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
  onNetworkChange(handler) {
    const online = () => handler(true)
    const offline = () => handler(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline) }
  },
  isOnline() { return navigator.onLine },
}
