import type { PickedFile, UploadProgress, UploadTransportAdapter } from '../interface'

const controllers = new Map<string, AbortController>()

export const webUploadTransport: UploadTransportAdapter = {
  async upload(files, sessionId, onProgress) {
    // First, get presigned upload URLs from our API
    const response = await fetch(`/api/v1/upload/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        files: files.map((f) => ({ fileId: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
      }),
    })
    if (!response.ok) throw new Error('Failed to get upload URLs')
    const { presignedFiles } = await response.json()

    const results: { fileId: string; mediaId: string }[] = []

    for (const picked of files) {
      const presigned = presignedFiles.find((p: { fileId: string }) => p.fileId === picked.id)
      if (!presigned) continue

      const controller = new AbortController()
      controllers.set(picked.id, controller)

      onProgress({ fileId: picked.id, loaded: 0, total: picked.sizeBytes, percentage: 0, status: 'uploading' })

      try {
        await uploadWithProgress(picked.file, presigned.uploadUrl, picked.id, picked.sizeBytes, onProgress, controller.signal)
        onProgress({ fileId: picked.id, loaded: picked.sizeBytes, total: picked.sizeBytes, percentage: 100, status: 'done' })
        results.push({ fileId: picked.id, mediaId: presigned.mediaId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        onProgress({ fileId: picked.id, loaded: 0, total: picked.sizeBytes, percentage: 0, status: 'error', error: msg })
        throw err
      } finally {
        controllers.delete(picked.id)
      }
    }

    return results
  },

  cancel(fileId) {
    controllers.get(fileId)?.abort()
    controllers.delete(fileId)
  },
}

function uploadWithProgress(
  file: File,
  url: string,
  fileId: string,
  total: number,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress({ fileId, loaded: e.loaded, total: e.total, percentage: Math.round((e.loaded / e.total) * 100), status: 'uploading' })
      }
    }
    xhr.onload = () => (xhr.status < 400 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Network error during upload'))
    signal.addEventListener('abort', () => { xhr.abort(); reject(new Error('Upload cancelled')) })
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.send(file)
  })
}
