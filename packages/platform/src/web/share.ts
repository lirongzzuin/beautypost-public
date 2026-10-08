import type { ShareAdapter } from '../interface'

export const webShare: ShareAdapter = {
  async share(options) {
    if (navigator.share) {
      await navigator.share({ title: options.title, text: options.text, url: options.url })
    } else if (options.url) {
      // Fallback: copy URL to clipboard
      await navigator.clipboard.writeText(options.url)
    }
  },
}
