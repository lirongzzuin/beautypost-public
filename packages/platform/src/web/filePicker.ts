import type { FilePickerAdapter, PickedFile } from '../interface'

let nextId = 0
const toId = () => `file_${Date.now()}_${++nextId}`

async function fileToPickedFile(file: File): Promise<PickedFile> {
  const isVideo = file.type.startsWith('video/')
  const previewUrl = URL.createObjectURL(file)
  let durationSeconds: number | undefined
  if (isVideo) {
    durationSeconds = await getVideoDuration(previewUrl)
  }
  return {
    id: toId(),
    name: file.name,
    type: isVideo ? 'video' : 'image',
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl,
    file,
    durationSeconds,
  }
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve(video.duration)
      URL.revokeObjectURL(url)
    }
    video.onerror = () => resolve(0)
    video.src = url
  })
}

function openFilePicker(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => {
      resolve(input.files ? Array.from(input.files) : [])
    }
    input.oncancel = () => resolve([])
    input.click()
  })
}

export const webFilePicker: FilePickerAdapter = {
  async pickMultiple(options = {}) {
    const accept = (options.accept ?? ['image/*', 'video/*']).join(',')
    const files = await openFilePicker(accept, true)
    const limited = options.maxCount ? files.slice(0, options.maxCount) : files
    return Promise.all(limited.map(fileToPickedFile))
  },

  async pickFromCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return null
    const files = await openFilePicker('image/*,video/*', false)
    if (files.length === 0) return null
    return fileToPickedFile(files[0])
  },
}
