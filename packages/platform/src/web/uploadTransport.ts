import type { UploadTransportAdapter } from '../interface'

// 저장소 직접 업로드. Vercel Blob(운영)은 클라이언트 토큰으로, 로컬 저장소(개발)는 서명된 URL 로 PUT.
export const webUploadTransport: UploadTransportAdapter = {
  async put(ticket, body, contentType, onProgress) {
    if (ticket.mode === 'blob') {
      const { put } = await import('@vercel/blob/client')
      const res = await put(ticket.key, body, {
        access: 'public',
        token: ticket.token,
        contentType,
        multipart: body.size > 20 * 1024 * 1024,
        onUploadProgress: (e) => onProgress?.(Math.round(e.percentage)),
      })
      return { key: ticket.key, url: res.url }
    }
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`업로드 실패 (${xhr.status})`)))
      xhr.onerror = () => reject(new Error('네트워크 오류로 업로드하지 못했어요'))
      xhr.open('PUT', ticket.uploadUrl)
      xhr.setRequestHeader('Content-Type', contentType)
      xhr.send(body)
    })
    return { key: ticket.key, url: ticket.url }
  },
}
