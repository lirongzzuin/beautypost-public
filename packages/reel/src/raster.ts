import sharp from 'sharp'

// 원시 프레임(RGB, W×H×3) 위에 글자·띠 같은 레이어(RGBA)를 얹고, 두 프레임을 섞는 저수준 연산.
// 프레임마다 sharp 파이프라인을 다시 만들지 않고 메모리에서 바로 섞는다 (프레임당 수 ms).

export interface Layer {
  /** RGBA 원시 데이터 */
  data: Buffer
  width: number
  height: number
  left: number
  top: number
}

export async function svgLayer(svg: string, left: number, top: number): Promise<Layer> {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, left: Math.round(left), top: Math.round(top) }
}

export function rectSvg(width: number, height: number, color: string, opacity: number, radius = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}"><rect width="100%" height="100%" rx="${radius}" fill="${color}" fill-opacity="${opacity}"/></svg>`
}

/** frame 에 layer 를 opacity(0~1)로 얹는다 (제자리). dy 만큼 아래로 밀어서 (나타날 때 살짝 올라오는 효과) */
export function blend(frame: Buffer, W: number, H: number, layer: Layer, opacity = 1, dy = 0): void {
  if (opacity <= 0.003) return
  const top = layer.top + Math.round(dy)
  const x0 = Math.max(0, layer.left)
  const y0 = Math.max(0, top)
  const x1 = Math.min(W, layer.left + layer.width)
  const y1 = Math.min(H, top + layer.height)
  const k = opacity / 255
  const src = layer.data
  for (let y = y0; y < y1; y++) {
    let si = ((y - top) * layer.width + (x0 - layer.left)) * 4
    let di = (y * W + x0) * 3
    for (let x = x0; x < x1; x++, si += 4, di += 3) {
      const a = src[si + 3]! * k
      if (a <= 0) continue
      const ia = 1 - a
      frame[di] = src[si]! * a + frame[di]! * ia
      frame[di + 1] = src[si + 1]! * a + frame[di + 1]! * ia
      frame[di + 2] = src[si + 2]! * a + frame[di + 2]! * ia
    }
  }
}

/** a → b 를 t(0~1)만큼 섞은 새 프레임 */
export function mix(a: Buffer, b: Buffer, t: number): Buffer {
  const out = Buffer.allocUnsafe(b.length)
  const it = 1 - t
  for (let i = 0; i < b.length; i++) out[i] = a[i]! * it + b[i]! * t
  return out
}

/** 프레임을 흰색 쪽으로 t 만큼 (플래시 전환) */
export function flash(frame: Buffer, t: number): void {
  for (let i = 0; i < frame.length; i++) frame[i] = frame[i]! + (255 - frame[i]!) * t
}

export function hexLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

export function contrast(a: string, b: string): number {
  const [x, y] = [hexLuminance(a), hexLuminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
