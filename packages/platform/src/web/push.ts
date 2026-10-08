import type { PushAdapter } from '../interface'

export const webPush: PushAdapter = {
  async requestPermission() {
    if (!('Notification' in window) || !('PushManager' in window)) return 'unsupported'
    const result = await Notification.requestPermission()
    return result === 'granted' ? 'granted' : 'denied'
  },

  async getToken() {
    // Web push token via service worker — requires VAPID setup
    // Returns null when service worker is not registered
    if (!('serviceWorker' in navigator)) return null
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      return sub ? JSON.stringify(sub.toJSON()) : null
    } catch {
      return null
    }
  },

  onMessage(handler) {
    const bc = new BroadcastChannel('push-messages')
    const listener = (e: MessageEvent) => handler(e.data)
    bc.addEventListener('message', listener)
    return () => { bc.removeEventListener('message', listener); bc.close() }
  },
}
