import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { getRegistry, type TextStyle } from '@beautypost/preset'

// 글자 그리기: 프리셋 폰트 파일(presets/fonts/files)의 글리프를 SVG 경로로 바꿔 래스터화한다.
// 시스템에 설치된 폰트·Pango 백엔드(맥 CoreText / 리눅스 fontconfig)에 상관없이 어디서나 같은 결과가 나온다.

const here = dirname(fileURLToPath(import.meta.url))

function fontDirs(): string[] {
  return [
    process.env.FONTS_DIR,
    resolve(here, '../../../presets/fonts/files'), // packages/photocraft/{src,dist} 기준
    resolve(process.cwd(), 'presets/fonts/files'), // Vercel 함수 (vercel.json includeFiles)
    resolve(process.cwd(), '../../presets/fonts/files'), // apps/* 에서 실행할 때
  ].filter((d): d is string => !!d)
}

export function fontPath(fontId: string, weight: TextStyle['weight']): string {
  const def = getRegistry().font(fontId)
  const name = def.files[weight] ?? def.files.Regular ?? Object.values(def.files)[0]
  if (!name) throw new Error(`폰트 ${fontId} 에 파일이 없어요`)
  for (const dir of fontDirs()) {
    const file = join(dir, name)
    if (existsSync(file)) return file
  }
  throw new Error(`폰트 파일을 찾을 수 없어요: ${name} (FONTS_DIR 로 지정 가능)`)
}

const cache = new Map<string, opentype.Font>()

export function loadFont(fontId: string, weight: TextStyle['weight']): opentype.Font {
  const file = fontPath(fontId, weight)
  let font = cache.get(file)
  if (!font) {
    const buf = readFileSync(file)
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    cache.set(file, font)
  }
  return font
}

// 폰트에 없는 글자(예: 주아체·블랙한산스의 '·')는 Pretendard 로 대신 그린다 (□ 방지)
type Run = { font: opentype.Font; text: string }

function fallbackFont(weight: TextStyle['weight']): opentype.Font {
  return loadFont('pretendard', weight)
}

export function toRuns(font: opentype.Font, text: string, weight: TextStyle['weight']): Run[] {
  const runs: Run[] = []
  for (const ch of [...text]) {
    const f = ch === ' ' || font.charToGlyphIndex(ch) > 0 ? font : fallbackFont(weight)
    const last = runs.at(-1)
    if (last && last.font === f) last.text += ch
    else runs.push({ font: f, text: ch })
  }
  return runs
}

function runsWidth(runs: Run[], size: number): number {
  return runs.reduce((t, r) => t + r.font.getAdvanceWidth(r.text, size), 0)
}

/** 폭에 맞춰 줄바꿈 (공백 단위, 한 단어가 너무 길면 글자 단위). 사용자가 넣은 줄바꿈은 유지 */
export function wrapLines(font: opentype.Font, text: string, size: number, maxWidth: number, weight: TextStyle['weight'] = 'Regular'): string[] {
  const width = (s: string) => runsWidth(toRuns(font, s, weight), size)
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word
      if (width(cand) <= maxWidth) {
        line = cand
        continue
      }
      if (line) out.push(line)
      line = ''
      if (width(word) <= maxWidth) {
        line = word
        continue
      }
      for (const ch of [...word]) {
        if (width(line + ch) > maxWidth && line) {
          out.push(line)
          line = ch
        } else line += ch
      }
    }
    out.push(line)
  }
  return out
}

export interface TextBlock {
  svg: string
  width: number
  height: number
}

function escapeAttr(s: string): string {
  return s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!)
}

/**
 * 글자 블록을 SVG 로 만든다 (투명 배경). 외곽선은 SVG stroke (글자 뒤에 깔림).
 * width 는 실제 줄 폭에 맞춘 값이라, 호출하는 쪽이 원하는 위치에 배치한다.
 */
export function textBlock(
  text: string,
  style: Pick<TextStyle, 'font' | 'weight' | 'color' | 'stroke'>,
  size: number,
  maxWidth: number,
  align: 'left' | 'center' | 'right' = 'center',
): TextBlock {
  const font = loadFont(style.font, style.weight)
  const lines = wrapLines(font, text, size, maxWidth, style.weight)
  const lineRuns = lines.map((l) => toRuns(font, l, style.weight))
  const lineHeight = size * 1.3
  const stroke = style.stroke ? Math.max(2, Math.round(size * 0.1)) : 0
  const pad = stroke + 2
  const widths = lineRuns.map((r) => runsWidth(r, size))
  const W = Math.ceil(Math.max(1, ...widths) + pad * 2)
  const H = Math.ceil(lines.length * lineHeight + pad * 2)
  const ascent = (font.ascender / font.unitsPerEm) * size
  const descent = (-font.descender / font.unitsPerEm) * size
  const baselineOffset = (lineHeight - (ascent + descent)) / 2 + ascent
  const paths = lineRuns
    .map((runs, i) => {
      let x = align === 'left' ? pad : align === 'right' ? W - pad - widths[i]! : (W - widths[i]!) / 2
      const y = pad + i * lineHeight + baselineOffset
      return runs
        .map((r) => {
          const d = r.font.getPath(r.text, x, y, size).toPathData(2)
          x += r.font.getAdvanceWidth(r.text, size)
          return d
        })
        .join(' ')
    })
    .filter(Boolean)
    .join(' ')
  const strokeAttr = stroke
    ? ` stroke="${escapeAttr(style.stroke!)}" stroke-width="${stroke * 2}" stroke-linejoin="round" paint-order="stroke"`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="${paths}" fill="${escapeAttr(style.color)}"${strokeAttr}/></svg>`
  return { svg, width: W, height: H }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** 둥근 사각형 배경 */
export function roundedRect(width: number, height: number, color: string, radius: number, opacity = 0.92): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="${escapeAttr(color)}" fill-opacity="${opacity}"/></svg>`
}
