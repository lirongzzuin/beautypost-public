import type { ExternalBrowserAdapter } from '../interface'

export const webExternalBrowser: ExternalBrowserAdapter = {
  open(url) {
    window.location.href = url
  },

  // OAuth flow: redirect to provider, return to callback URL
  // Web: simple redirect. Native: system browser session + deep link.
  async startAuthSession(url, _callbackScheme) {
    window.location.href = url
    return null
  },
}
