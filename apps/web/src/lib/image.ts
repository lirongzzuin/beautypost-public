// Browser-side image compression before upload.
// Phone photos are often 3–10MB; resizing to a sane max dimension and
// re-encoding as JPEG cuts upload payloads by 5–10× with no visible quality
// loss for social posts. Falls back to the original file on any failure.

const MAX_DIMENSION = 1600 // px — plenty for Instagram feed (1080) + retina
const QUALITY = 0.82

export async function compressImage(file: File): Promise<File> {
  // Skip tiny files and formats the canvas can't reliably decode (e.g. HEIC).
  if (file.size < 300 * 1024) return file
  if (!/image\/(jpe?g|png|webp)/i.test(file.type)) return file

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
    if (!blob || blob.size >= file.size) return file // no gain → keep original

    const name = file.name.replace(/\.(png|webp|heic|heif)$/i, '.jpg')
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}
