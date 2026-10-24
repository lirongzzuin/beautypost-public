import { contentApi, type Media } from '~/api/content'
import { compressImage } from '~/lib/image'
import { platform } from '~/lib/platform'

// 사진·영상 올리기: 직접 업로드 권한 → 저장소에 바로 PUT → 미디어 등록.
// 영상은 대표 화면(포스터)도 같이 올려서 서버가 영상 디코더 없이도 분석·미리보기를 할 수 있게 한다.

async function putFile(file: Blob, name: string, contentType: string, onProgress?: (p: number) => void) {
  const ticket = await contentApi.ticket(name, contentType, file.size)
  return platform.uploadTransport.put(ticket, file, contentType, onProgress)
}

export async function uploadMedia(file: File, role: string | null, onProgress: (percent: number) => void): Promise<Media> {
  if (file.type.startsWith('video/')) {
    const contentType = file.type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4'
    const info = await platform.media.videoInfo(file).catch(() => null)
    const poster = info ? await putFile(info.poster, 'poster.jpg', 'image/jpeg') : null
    const video = await putFile(file, file.name || 'video.mp4', contentType, onProgress)
    return contentApi.register({
      ...video, contentType, size: file.size, role,
      ...(info ? { width: info.width, height: info.height, durationSeconds: info.durationSeconds } : {}),
      ...(poster ? { thumbnail: poster } : {}),
    })
  }
  const image = await compressImage(file)
  const contentType = image.type || 'image/jpeg'
  const size = await platform.media.imageSize(image)
  const stored = await putFile(image, image.name || 'photo.jpg', contentType, onProgress)
  return contentApi.register({ ...stored, contentType, size: image.size, role, ...(size ?? {}) })
}
