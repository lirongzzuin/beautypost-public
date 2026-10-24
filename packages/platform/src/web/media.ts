import type { MediaProbeAdapter } from '../interface'

// 업로드 전에 브라우저에서 영상 대표 화면·길이를 읽는다 (서버에 영상 디코더가 없어도 분석·미리보기 가능)
export const webMedia: MediaProbeAdapter = {
  videoInfo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.src = url
      const fail = () => {
        URL.revokeObjectURL(url)
        reject(new Error('영상을 읽지 못했어요'))
      }
      video.onerror = fail
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, (video.duration || 1) / 2)
      }
      video.onseeked = () => {
        const w = video.videoWidth
        const h = video.videoHeight
        const scale = Math.min(1, 1280 / Math.max(w, h))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url)
            if (!blob) return fail()
            resolve({ poster: blob, durationSeconds: video.duration, width: w, height: h })
          },
          'image/jpeg',
          0.85,
        )
      }
    })
  },

  async imageSize(file) {
    try {
      const bmp = await createImageBitmap(file)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close?.()
      return size
    } catch {
      return null
    }
  },
}
