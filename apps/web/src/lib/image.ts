// Browser-side image resize before upload — quality-first for beauty photos.
// Phone photos are often 3000–4000px / 3–10MB. Instagram itself re-encodes every
// upload down to ~1080px wide, so capping at 2048px with high JPEG quality is
// visually lossless for social while still cutting upload payloads ~5–10×.
// Falls back to the original file on any failure or if no size gain.

const MAX_DIMENSION = 2048 // px — 2× Instagram's display width + retina headroom
const QUALITY = 0.92       // near-lossless for photos

export async function compressImage(file: File): Promise<File> {
  // Skip tiny files and formats the canvas can't reliably decode (e.g. HEIC).
  // HEIC(아이폰)은 서버가 풀 수 없어서 크기와 상관없이 JPEG 로 바꿔 본다 (사파리는 가능, 안 되면 원본 → 서버가 안내)
  const isHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
  if (file.size < 300 * 1024 && !isHeic) return file
  if (!/image\/(jpe?g|png|webp|heic|heif)/i.test(file.type) && !isHeic) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    // no gain → keep original (단, HEIC 는 서버가 못 읽으니 커져도 JPEG 로)
    if (!blob || (!isHeic && blob.size >= file.size)) return file

    const name = file.name.replace(/\.(png|webp|heic|heif)$/i, '.jpg')
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}
