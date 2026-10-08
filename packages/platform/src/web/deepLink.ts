import type { DeepLinkAdapter } from '../interface'

// Web deep link: URL hash/path changes
export const webDeepLink: DeepLinkAdapter = {
  onLink(handler) {
    const listener = () => handler(window.location.href)
    window.addEventListener('popstate', listener)
    return () => window.removeEventListener('popstate', listener)
  },
  async getInitialLink() {
    return window.location.href
  },
}
