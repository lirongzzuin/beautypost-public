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

  async saveFiles(files) {
    const blobs = await Promise.all(
      files.map(async (f) => {
        const res = await fetch(f.url)
        if (!res.ok) throw new Error('파일을 불러오지 못했어요')
        return new File([await res.blob()], f.filename, { type: f.mimeType })
      }),
    )
    // 휴대폰: 공유 시트 → "이미지 저장 / 동영상 저장" 또는 인스타그램으로 바로 보내기
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    if (isMobile && navigator.canShare?.({ files: blobs })) {
      try {
        await navigator.share({ files: blobs })
        return 'shared'
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'cancelled'
      }
    }
    for (const file of blobs) {
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
    return 'downloaded'
  },
}
