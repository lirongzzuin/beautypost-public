import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { applyGrade, autoPatch, combineGrade, compareCells, imageStats, pickCompareLayout, textBlock, type CompareLayout } from '@beautypost/photocraft'
import type { Grade } from '@beautypost/preset'
import type { PlannedClip, RenderMedia, RenderSpec, VideoPlan } from '@beautypost/render'
import { Encoder, decodeFrames, probe } from './ffmpeg.js'
import { brandLayers, hookLayer, labelLayer, subLayers, watermarkLayer, type Frame } from './overlays.js'
import { blend, contrast, flash, hexLuminance, mix, rectSvg, svgLayer, type Layer } from './raster.js'
import { Stage, cropFor, decodeImage, placeImage, windowFor, type Placement } from './stage.js'

// 기본 렌더 엔진: 장면 목록(VideoPlan) → 프레임을 메모리에서 직접 합성 → ffmpeg(H.264)로 굽기.
// FilmCraft(편집기 MCP 를 명령 수백 개로 조작, 15초 영상에 2~3분)보다 10배 가까이 빠르고, 화면 문법을 레퍼런스에 맞춰 세밀하게 다룬다.
//
// 장면 구성: 사진은 시술 부위 클로즈업 + 천천히 밀어 들어가기, 영상은 가운데 구간, 비교 장면은 비포(위)·애프터(아래).
// 전환은 장면 사이에 겹치지 않게 다음 장면 첫 몇 프레임에서 섞는다 (전체 길이 = 장면 길이의 합).

export interface ReelInput {
  spec: RenderSpec
  plan: VideoPlan
  /** 미디어 id → 작업자 디스크의 파일 */
  files: Record<string, string>
  out: { video: string; cover: string }
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export interface ReelResult {
  video: string
  cover: string
  width: number
  height: number
  duration: number
  frames: number
  grade: Grade
}

type Motion = { from: number; to: number; ease: 'linear' | 'punch' }

interface Scene {
  clip: PlannedClip
  frames: number
  /** 이 장면이 시작할 때의 전환 */
  transition: { kind: 'cut' | 'crossfade' | 'flash'; frames: number }
  motion: Motion
  /** 프레임 n(0부터) → 합성된 화면 */
  render: (n: number) => Promise<Buffer>
  /** 장면이 끝나면(또는 실패하면) 영상 디코더 프로세스를 닫는다 */
  close: () => Promise<void>
  /** 다음 장면과 같은 자막을 이어서 보여 주는지 (같은 슬롯의 여러 장) */
  continued: boolean
}

const LOOKAHEAD = 6 // 동시에 미리 만드는 프레임 수 (sharp 는 libuv 스레드에서 병렬)

/** 배경 위에서 읽히는 글자색 (대비가 모자라면 검정·흰색) */
function readableOn(color: string, bg: string): string {
  return contrast(color, bg) >= 3 ? color : hexLuminance(bg) > 0.4 ? '#111111' : '#ffffff'
}

function easeOut(t: number) {
  return 1 - (1 - t) ** 3
}

function zoomAt(m: Motion, t: number): number {
  if (m.ease === 'punch') {
    // 앞 0.25 구간에 빠르게 들어가고 나머지는 아주 천천히
    const k = t < 0.25 ? easeOut(t / 0.25) * 0.8 : 0.8 + 0.2 * ((t - 0.25) / 0.75)
    return m.from + (m.to - m.from) * k
  }
  return m.from + (m.to - m.from) * t
}

/** 사진들로 자동 밝기·화이트밸런스 → 무드 색감과 합친 하나의 보정값 (모든 장면에 같은 값 = 비포·애프터 공정성) */
async function gradeFor(spec: RenderSpec, files: string[]): Promise<Grade> {
  const stats = await Promise.all(files.map((f) => imageStats(readFileSync(f)).catch(() => null)))
  const ok = stats.filter((s): s is NonNullable<typeof s> => !!s)
  return combineGrade(spec.mood.grade, ok.length ? autoPatch(ok) : null, spec.gradeLimits ?? {})
}

export async function renderReel(input: ReelInput): Promise<ReelResult> {
  const { spec, plan, files } = input
  const W = spec.format.width
  const H = spec.format.height
  const fps = spec.format.fps
  const f: Frame = { W, H, safe: spec.format.safeArea }
  const mood = spec.mood
  const caps = mood.video.captions

  const imageFiles = [...new Set(plan.clips.flatMap((c) => [c.media, c.compare?.before, c.compare?.after]).filter((m): m is RenderMedia => !!m && m.kind === 'image').map((m) => files[m.id]!))]
  const grade = await gradeFor(spec, imageFiles)
  const decoded = new Map<string, Promise<{ data: Buffer; width: number; height: number }>>()
  const decode = (file: string) => {
    let p = decoded.get(file)
    if (!p) decoded.set(file, (p = decodeImage(file, grade)))
    return p
  }

  // 아래쪽 글자 쌓기: 세이프존 바로 위부터 워터마크 → 샵 띠 → 설명 자막
  const base = H - f.safe.bottom
  const handle = spec.shop.handle?.trim() || spec.shop.name
  const watermark = mood.video.watermark ? await watermarkLayer(handle, mood.video.watermarkColor, f, base) : null
  const aboveWatermark = watermark ? watermark.top - Math.round(W * 0.018) : base
  const brandLine = spec.shop.booking?.trim() || spec.shop.region || null
  const brand = await brandLayers(spec.shop.name, brandLine, caps.main, f, aboveWatermark)

  // 사진 칸 바깥 바탕: 무드 배경색 한 장 (프레임마다 복사해 쓴다)
  const bg = mood.palette.background
  const background = await sharp({ create: { width: W, height: H, channels: 3, background: bg } }).raw().toBuffer()
  // 비교 화면(사진 두 칸)에서는 샵 이름을 사진 위 여백에 띠 없이 (사진 위에 띠를 얹지 않는다)
  const plainBrand = { ...caps.main, background: null, color: readableOn(caps.main.color, bg) }
  const brandH = await brandLayers(spec.shop.name, brandLine, plainBrand, f, H).then((b) => H - b.top)
  const brandTop = await brandLayers(spec.shop.name, brandLine, plainBrand, f, f.safe.top + brandH)
  const subRoom = Math.round(W * 0.13) // 사진 칸 아래 자막 한 줄 자리

  const transitionKind = mood.video.transition === 'cut' ? 'cut' : mood.video.transition === 'flash' ? 'flash' : 'crossfade'
  const transitionFrames = Math.max(0, Math.round(mood.video.transitionSec * fps))
  const scenes: Scene[] = []

  for (const [i, clip] of plan.clips.entries()) {
    const frames = Math.max(1, Math.round((clip.end - clip.start) * fps))
    const prev = plan.clips[i - 1]
    const next = plan.clips[i + 1]
    const sameSlotAsPrev = !!prev && prev.slotIndex === clip.slotIndex && prev.caption?.text === clip.caption?.text
    const motion: Motion =
      mood.video.motion === 'static' || clip.card
        ? { from: 1, to: 1, ease: 'linear' }
        : clip.punch
          ? { from: 1, to: 1.14, ease: 'punch' }
          : clip.compare
            ? { from: 1, to: 1.025, ease: 'linear' }
            : { from: 1, to: 1.06, ease: 'linear' }

    // 장면 바탕 (사진·비교·카드는 무대, 영상은 풀어 둔 프레임)
    let stage: Stage | null = null
    let areaY = 0.5
    let openVideo: (() => AsyncGenerator<Buffer>) | null = null
    let compareRegions: { top: number; height: number }[] = []
    let seam: number | undefined
    let placed: Placement | null = null
    let block: { top: number; bottom: number } | null = null
    if (clip.card) {
      stage = await Stage.fromFrame(await cardFrame(clip, spec, f, handle), W, H)
    } else if (clip.compare) {
      const room = { top: clip.brand ? f.safe.top + brandH + Math.round(W * 0.03) : f.safe.top, bottom: aboveWatermark - (clip.caption ? subRoom : 0) }
      const built = await compareFrame(clip, files, decode, f, bg, room)
      compareRegions = built.regions
      seam = built.seam
      block = built.block
      stage = await Stage.fromFrame(built.frame, W, H)
    } else if (clip.media!.kind === 'image') {
      const src = await decode(files[clip.media!.id]!)
      placed = placeImage(src.width, src.height, W, H, { area: clip.media!.area, focus: clip.focus, fill: clip.role === 'hook' ? 0.58 : 0.62 })
      const win = placed.win
      areaY = win ? (win.top + placed.anchor.y * win.height) / H : placed.anchor.y
      stage = await Stage.fromRaw(src, placed.crop, W, win ? win.height : H, placed.anchor)
    } else {
      const info = await probe(files[clip.media!.id]!)
      const len = Math.min(clip.end - clip.start, Math.max(0.2, info.duration - clip.start))
      areaY = clip.focus.y
      // 디코더는 이 장면을 구울 때 연다 (미리 열면 ffmpeg 가 장면 수만큼 동시에 떠 있다)
      const file = files[clip.media!.id]!
      openVideo = () => decodeFrames(file, { start: clip.start, duration: len, width: W, height: H, fps, focus: clip.focus, count: frames, signal: input.signal })
    }
    const win = placed?.win ?? null

    // 장면 글자 — 사진 칸이 화면 일부면 위·아래 여백에, 화면 전체면 시술 부위를 피해서
    const layers: { layer: Layer; animate: boolean }[] = []
    if (clip.caption?.style === 'big') {
      const style = { ...caps.emphasis, color: win ? readableOn(caps.emphasis.color, bg) : caps.emphasis.color }
      const at = win ? (f.safe.top + win.top) / 2 : undefined
      layers.push({ layer: await hookLayer(clip.caption.text, style, f, areaY, at), animate: true })
    }
    let subBottom = aboveWatermark
    if (clip.brand && block) {
      for (const l of brandTop.layers) layers.push({ layer: l, animate: true })
    } else if (clip.brand) {
      for (const l of brand.layers) layers.push({ layer: l, animate: true })
      subBottom = brand.top - Math.round(W * 0.02)
    }
    if (clip.caption?.style === 'sub' && clip.caption.text) {
      // 비교 화면은 위아래 사진 경계에, 사진 칸 아래 여백이 있으면 그 가운데에 (사진 속 시술 부위를 가리지 않게)
      let center = block ? Math.round((block.bottom + aboveWatermark) / 2) : seam
      if (win && center === undefined) {
        const below = win.top + win.height
        center = Math.min(below + Math.round(W * 0.09), (below + subBottom) / 2)
      }
      let sub = await subLayers(clip.caption.text, caps.main, f, subBottom, center)
      const span = placed?.areaSpan
      if (!win && span && sub.top < span.bottom && sub.top + sub.height > span.top) {
        // 띠가 시술 부위에 걸리면 부위 위쪽(자리가 없으면 아래쪽)으로
        const h = sub.height
        const above = span.top - Math.round(W * 0.03) - h / 2
        sub = await subLayers(clip.caption.text, caps.main, f, subBottom, above - h / 2 >= f.safe.top ? above : span.bottom + Math.round(W * 0.03) + h / 2)
      }
      for (const l of sub.layers) layers.push({ layer: l, animate: !sameSlotAsPrev })
    }
    if (clip.chip && !clip.compare && !clip.card) layers.push({ layer: await labelLayer(clip.chip, caps.label, f, win ?? undefined, win ? 0.085 : 0.1), animate: !(prev?.chip === clip.chip) })
    if (clip.compare) {
      const t = mood.video.labelText
      layers.push({ layer: await labelLayer(t.before, caps.label, f, compareRegions[0], 0.085), animate: false })
      layers.push({ layer: await labelLayer(t.after, caps.label, f, compareRegions[1], 0.085), animate: false })
    }
    if (watermark && !clip.card) layers.push({ layer: win || block ? await watermarkLayer(handle, readableOn(mood.video.watermarkColor, bg), f, base) : watermark, animate: false })

    const animFrames = Math.max(1, Math.round(0.28 * fps))
    const popAnimation = caps.main.animation === 'pop' || caps.emphasis.animation === 'pop'
    const compose = (frame: Buffer, n: number) => {
      for (const { layer, animate } of layers) {
        if (!animate || n >= animFrames) blend(frame, W, H, layer, 1)
        else {
          const t = easeOut((n + 1) / animFrames)
          blend(frame, W, H, layer, t, (1 - t) * (popAnimation ? W * 0.03 : W * 0.012))
        }
      }
      return frame
    }

    const st = stage
    const open = openVideo
    let vf: AsyncGenerator<Buffer> | null = null
    scenes.push({
      clip,
      frames,
      transition: i === 0 ? { kind: 'cut', frames: 0 } : { kind: clip.card || prev?.card ? 'crossfade' : transitionKind, frames: Math.min(transitionFrames, Math.floor(frames / 3)) },
      motion,
      continued: !!next && next.slotIndex === clip.slotIndex,
      render: async (n) => {
        if (st && win) {
          // 사진 칸만 움직이고 바탕(무드 배경색)은 그대로
          const frame = Buffer.from(background)
          ;(await st.frame(zoomAt(motion, frames > 1 ? n / (frames - 1) : 0))).copy(frame, win.top * W * 3)
          return compose(frame, n)
        }
        if (st) return compose(await st.frame(zoomAt(motion, frames > 1 ? n / (frames - 1) : 0)), n)
        vf ??= open!()
        const r = await vf.next()
        if (r.done || !r.value) throw new Error('영상 프레임이 모자라요')
        applyGrade(r.value, 3, grade) // 영상 프레임도 사진과 같은 LUT
        return compose(r.value, n)
      },
      close: async () => {
        await vf?.return(undefined).catch(() => undefined)
        vf = null
      },
    })
  }

  // ─── 굽기 ────────────────────────────────────────────────────────────────
  // 커버: 비교 장면(있으면) 또는 첫 장면에서 글자까지 다 나온 프레임 (굽는 중에 복사해 둔다 — 영상 장면은 다시 풀 수 없어서)
  const coverScene = scenes.find((s) => s.clip.compare) ?? scenes[0]!
  const coverAt = Math.min(coverScene.frames - 1, Math.round(fps * 0.6))
  let cover: Buffer | null = null
  const total = scenes.reduce((t, s) => t + s.frames, 0)
  const enc = new Encoder(input.out.video, { width: W, height: H, fps, videoKbps: spec.format.encode?.videoKbps, signal: input.signal })
  let written = 0
  let lastFrame: Buffer | null = null
  try {
    for (const scene of scenes) {
      const queue: Promise<Buffer>[] = []
      // 영상 장면은 프레임을 순서대로만 받을 수 있어 하나씩, 사진 장면은 앞질러 여러 장
      const ahead = scene.clip.media?.kind === 'video' && !scene.clip.compare ? 1 : LOOKAHEAD
      let next = 0
      const fill = () => {
        while (queue.length < ahead && next < scene.frames) {
          const p = scene.render(next++)
          p.catch(() => undefined) // 중간에 멈추면 남은 미리 만든 프레임의 실패는 버린다 (처리 안 된 거부로 작업자가 죽지 않게)
          queue.push(p)
        }
      }
      try {
        fill()
        const tailFrame = lastFrame
        for (let n = 0; n < scene.frames; n++) {
          if (input.signal?.aborted) throw new Error('작업이 중단됐어요')
          let frame = await queue.shift()!
          fill()
          const tr = scene.transition
          if (tailFrame && tr.frames > 0 && n < tr.frames) {
            const t = (n + 1) / (tr.frames + 1)
            if (tr.kind === 'crossfade') frame = mix(tailFrame, frame, easeOut(t))
            else if (tr.kind === 'flash') flash(frame, 1 - t)
          }
          if (scene === coverScene && n === coverAt) cover = Buffer.from(frame)
          await enc.write(frame)
          lastFrame = frame
          written++
          if (written % 15 === 0) input.onProgress?.(written / total)
        }
      } finally {
        await scene.close()
      }
    }
    await enc.finish()
  } catch (e) {
    enc.kill() // 반쯤 만든 파일을 마무리하지 않는다
    throw e
  }

  writeFileSync(input.out.cover, await sharp(cover ?? lastFrame!, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92, mozjpeg: true }).toBuffer())

  return { video: input.out.video, cover: input.out.cover, width: W, height: H, duration: Math.round((total / fps) * 100) / 100, frames: total, grade }
}

// ─── 비교 화면: 비포(위)·애프터(아래) ─────────────────────────────────────────

async function compareFrame(
  clip: PlannedClip,
  files: Record<string, string>,
  decode: (file: string) => Promise<{ data: Buffer; width: number; height: number }>,
  f: Frame,
  bg: string,
  /** 사진 두 칸을 둘 세로 범위 (위: 샵 이름 아래, 아래: 자막·워터마크 위) */
  room: { top: number; bottom: number },
): Promise<{ frame: Buffer; regions: { top: number; height: number }[]; seam?: number; block: { top: number; bottom: number } | null }> {
  const { W, H } = f
  const gap = Math.max(6, Math.round(W * 0.008))
  const pair = [clip.compare!.before, clip.compare!.after]
  const srcs = await Promise.all(pair.map((m) => decode(files[m.id]!)))
  const sources = pair.map((m, i) => ({ width: srcs[i]!.width, height: srcs[i]!.height, area: m.area, focus: m.focus }))
  // 위아래 / 좌우 중 시술 부위가 잘리지 않고 크게 보이는 쪽 (사진과 같은 규칙)
  const layout: CompareLayout = pickCompareLayout(W, H, gap, sources, 0.55)
  const cut = (i: number, w: number, h: number) => {
    const src = srcs[i]!
    // 비포·애프터를 같은 배율로 (같은 fill) → 공정한 비교
    const crop = cropFor(src.width, src.height, w, h, { area: sources[i]!.area, focus: sources[i]!.focus, fill: 0.55 })
    return sharp(src.data, { raw: { width: src.width, height: src.height, channels: 3 } }).extract(crop).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer()
  }
  if (layout === 'side') {
    const cells = compareCells(W, H, gap, 'side')
    const [b, a] = await Promise.all([cut(0, cells.w, cells.h), cut(1, cells.w, cells.h)])
    const frame = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
      .composite([{ input: b, left: 0, top: 0 }, { input: a, left: cells.w + gap, top: 0 }])
      .removeAlpha()
      .raw()
      .toBuffer()
    return { frame, regions: [{ top: f.safe.top, height: H }, { top: f.safe.top, height: H }], block: null }
  }
  // 위아래: 가로 꽉 찬 사진 칸 두 개를 같은 높이로, 화면 가운데 (칸 높이는 시술 부위에 맞춘 납작한 비율 — 눈썹이면 눈까지)
  const maxCell = Math.floor((room.bottom - room.top - gap) / 2)
  const h = Math.max(...sources.map((s) => windowFor(s.width, s.height, W, maxCell, { area: s.area, focus: s.focus, fill: 0.55 }).height))
  const top = Math.round((room.top + room.bottom - (h * 2 + gap)) / 2)
  const [b, a] = await Promise.all([cut(0, W, h), cut(1, W, h)])
  const frame = await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: b, left: 0, top }, { input: a, left: 0, top: top + h + gap }])
    .removeAlpha()
    .raw()
    .toBuffer()
  return { frame, regions: [{ top, height: h }, { top: top + h + gap, height: h }], seam: top + h + gap / 2, block: { top, bottom: top + h * 2 + gap } }
}

// ─── 글자 카드 (이벤트 제목·관리 팁 등): 여백 많은 공지 카드 ──────────────────────

async function cardFrame(clip: PlannedClip, spec: RenderSpec, f: Frame, handle: string): Promise<Buffer> {
  const { W, H } = f
  const bg = spec.mood.palette.background
  const readable = (c: string) => (contrast(c, bg) >= 3 ? c : spec.mood.palette.text)
  const blocks = clip.card!.lines
    .filter((l) => l.text.trim())
    .map((l, i) => {
      const size = Math.round(W * (i === 0 ? Math.min(0.085, l.scale) : Math.min(0.05, l.scale)))
      return textBlock(l.text.trim(), { font: l.style.font, weight: l.style.weight, color: readable(l.style.color), stroke: null, shadow: false }, size, W - f.safe.side * 2)
    })
  const dividerH = Math.max(2, Math.round(W * 0.002))
  const gap = Math.round(W * 0.045)
  const totalH = blocks.reduce((t, b) => t + b.height, 0) + (blocks.length > 1 ? gap * 2 + dividerH : 0) + Math.max(0, blocks.length - 2) * Math.round(gap * 0.5)
  let y = Math.round(f.safe.top + (H - f.safe.top - f.safe.bottom - totalH) / 2)
  const layers: Layer[] = []
  for (const [i, b] of blocks.entries()) {
    layers.push(await svgLayer(b.svg, (W - b.width) / 2, y))
    y += b.height
    if (i === 0 && blocks.length > 1) {
      y += gap
      const dw = Math.round(W * 0.07)
      layers.push(await svgLayer(rectSvg(dw, dividerH, readable(spec.brandColor ?? spec.mood.palette.accent), 1), (W - dw) / 2, y))
      y += dividerH + gap
    } else y += Math.round(gap * 0.5)
  }
  const hb = textBlock(handle, { font: 'pretendard', weight: 'Regular', color: readable(spec.mood.palette.accent), stroke: null, shadow: false }, Math.round(W * 0.03), W * 0.8)
  layers.push(await svgLayer(hb.svg, (W - hb.width) / 2, H - f.safe.bottom + Math.round(W * 0.02)))
  const frame = await sharp({ create: { width: W, height: H, channels: 3, background: bg } }).removeAlpha().raw().toBuffer()
  for (const l of layers) blend(frame, W, H, l, 1)
  return frame
}
