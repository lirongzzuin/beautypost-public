import type { ClipboardAdapter } from '../interface'

export const webClipboard: ClipboardAdapter = {
  async copy(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      // Legacy fallback
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
  },
  async read() {
    if (navigator.clipboard?.readText) {
      return navigator.clipboard.readText()
    }
    return null
  },
}
