import { textBlock } from '@beautypost/photocraft'
import type { OutputFormat, TextStyle } from '@beautypost/preset'
import { rectSvg, svgLayer, type Layer } from './raster.js'

// 화면 글자 레이어. 레퍼런스(잘 되는 시술샵 릴스)의 공통 문법:
//  - 첫 장면 한마디: 크고 굵게, 박스 없이 그림자로 (시술 부위를 가리지 않는 쪽에)
//  - 설명 자막: 화면 아래쪽 반투명 띠 위 작은 글씨
//  - 장면 이름표: 모서리의 세리프 이탤릭 "Before" / "After"
//  - 샵 이름 워터마크: 아래 가운데 작은 글씨, 넓은 자간
// 크기는 모두 화면 폭(W) 비율이라 1:1·4:5·9:16 어디서나 같은 느낌.

export interface Frame {
  W: number
  H: number
  safe: OutputFormat['safeArea']
}

function textStyle(s: TextStyle, over: Partial<TextStyle> & { letterSpacing?: number } = {}) {
  return { font: s.font, weight: s.weight, color: s.color, stroke: s.stroke, shadow: s.shadow, ...over }
}

/** 첫 장면 한마디. 시술 부위가 화면 위쪽이면 아래에, 아래쪽이면 위에 */
export async function hookLayer(text: string, style: TextStyle, f: Frame, areaY: number): Promise<Layer> {
  const size = Math.round(f.W * 0.088)
  const b = textBlock(text, textStyle(style, { shadow: style.stroke ? false : true }), size, f.W - f.safe.side * 2)
  const centerY = areaY < 0.5 ? f.H * 0.66 : f.H * 0.3
  const top = Math.min(f.H - f.safe.bottom - b.height, Math.max(f.safe.top, centerY - b.height / 2))
  return svgLayer(b.svg, (f.W - b.width) / 2, top)
}

/** 설명 자막: 반투명 띠(무드에 배경색이 있으면) 또는 그림자 글씨. bottom = 띠 아래 끝 y */
export async function subLayers(text: string, style: TextStyle, f: Frame, bottom: number, center?: number): Promise<{ layers: Layer[]; top: number }> {
  const size = Math.round(f.W * 0.043)
  const b = textBlock(text, textStyle(style, { shadow: style.background ? false : true }), size, f.W - f.safe.side * 2)
  if (!style.background) {
    const top = center !== undefined ? center - b.height / 2 : bottom - b.height
    return { layers: [await svgLayer(b.svg, (f.W - b.width) / 2, top)], top }
  }
  const padY = Math.round(size * 0.55)
  const h = b.height + padY * 2
  const top = center !== undefined ? Math.round(center - h / 2) : bottom - h
  return {
    layers: [await svgLayer(rectSvg(f.W, h, style.background, style.backgroundOpacity), 0, top), await svgLayer(b.svg, (f.W - b.width) / 2, top + padY)],
    top,
  }
}

/** 샵 이름(굵게) + 예약 안내(작게) 띠. bottom = 띠 아래 끝 y */
export async function brandLayers(name: string, line: string | null, main: TextStyle, f: Frame, bottom: number): Promise<{ layers: Layer[]; top: number }> {
  const nameSize = Math.round(f.W * 0.05)
  const lineSize = Math.round(f.W * 0.034)
  const onBand = !!main.background
  const color = main.color
  const nb = textBlock(name, { font: main.font, weight: 'Bold', color, stroke: null, shadow: !onBand }, nameSize, f.W - f.safe.side * 2)
  const lb = line ? textBlock(line, { font: main.font, weight: 'Regular', color, stroke: null, shadow: !onBand }, lineSize, f.W - f.safe.side * 2) : null
  const gap = Math.round(lineSize * 0.25)
  const padY = Math.round(nameSize * 0.5)
  const h = nb.height + (lb ? gap + lb.height : 0) + padY * 2
  const top = bottom - h
  const layers: Layer[] = []
  if (onBand) layers.push(await svgLayer(rectSvg(f.W, h, main.background!, Math.min(0.85, main.backgroundOpacity + 0.08)), 0, top))
  layers.push(await svgLayer(nb.svg, (f.W - nb.width) / 2, top + padY))
  if (lb) layers.push(await svgLayer(lb.svg, (f.W - lb.width) / 2, top + padY + nb.height + gap))
  return { layers, top }
}

/** 장면 이름표 (오른쪽 위). region 을 주면 그 영역(예: 비교 화면의 위·아래 칸) 안에서 */
export async function labelLayer(text: string, style: TextStyle, f: Frame, region?: { top: number; height: number }, scale = 0.1): Promise<Layer> {
  const size = Math.round(f.W * scale)
  const b = textBlock(text, textStyle(style, { stroke: null, shadow: true }), size, f.W * 0.6)
  const top = region ? region.top + Math.round(size * 0.25) : f.safe.top
  return svgLayer(b.svg, f.W - Math.round(f.safe.side * 0.55) - b.width, top)
}

/** 샵 이름 워터마크 (아래 가운데). bottom = 아래 끝 y */
export async function watermarkLayer(text: string, color: string, f: Frame, bottom: number): Promise<Layer> {
  const size = Math.round(f.W * 0.026)
  // 영문 샵 이름은 대문자 + 넓은 자간 ("U G L Y M U S E"), @아이디는 그대로
  const latin = /^[\x20-\x7e]+$/.test(text) && !text.startsWith('@')
  const b = textBlock(latin ? text.toUpperCase() : text, { font: 'pretendard', weight: 'Medium', color, stroke: null, shadow: true, letterSpacing: latin ? 0.32 : 0.08 }, size, f.W * 0.8)
  return svgLayer(b.svg, (f.W - b.width) / 2, bottom - b.height)
}
