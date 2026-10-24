import { z } from 'zod'
import { MoodPreset, OutputFormat, PurposePreset, type TextStyle } from '@beautypost/preset'

// filmcraft 어댑터: 프리셋(무드 × 목적 템플릿 × 포맷) + 올린 사진·영상 → filmcraft 의 plan.json · profile.json.
// 입출력이 없는 순수 함수만 둔다. 파일 내려받기·카드 그리기·filmcraft 실행은 렌더 작업자(apps/worker)가 한다.
// filmcraft 쪽 진입점: /Users/…/filmcraft `./br render <dir> --profile profile.json` (babyreel/render.py)

// ─── 작업 입력 (API 가 만들어 작업 큐에 넣는다) ─────────────────────────────────

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })

export const RenderMedia = z.object({
  id: z.string(),
  url: z.string(),
  kind: z.enum(['image', 'video']),
  role: z.string().nullable(),
  durationSec: z.number().nullable().optional(),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
  /** 사진에서 흐리게 할 얼굴 (동의 대신 가림을 고른 경우). 영상은 가림을 지원하지 않아 API 가 막는다 */
  blurFaces: z.array(Box).default([]),
})
export type RenderMedia = z.infer<typeof RenderMedia>

export const RenderSpec = z.object({
  specVersion: z.literal(1),
  mood: MoodPreset,
  purpose: PurposePreset,
  format: OutputFormat,
  videoDurationSec: z.tuple([z.number(), z.number()]),
  industryLabel: z.string(),
  shop: z.object({ name: z.string(), region: z.string(), booking: z.string().nullable().optional() }),
  brandColor: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  media: z.array(RenderMedia),
  /** 슬롯 번호(문자열) → 화면 자막 한 줄 (API 가 AI·정책 검사로 만든 값) */
  lines: z.record(z.string(), z.string()),
})
export type RenderSpec = z.infer<typeof RenderSpec>

// ─── 슬롯 계획 ────────────────────────────────────────────────────────────────

export interface CardPlan {
  key: string
  background: string
  lines: { text: string; style: TextStyle; scale: number }[]
}

export interface PlannedClip {
  slotIndex: number
  role: string
  media?: RenderMedia
  card?: CardPlan
  /** 원본 기준 구간 (사진·카드는 0 ~ 보여줄 초) */
  start: number
  end: number
  caption?: { text: string; style: 'sub' | 'big' }
  chip?: string
  punch?: boolean
  focus: { x: number; y: number }
}

export interface VideoPlan {
  clips: PlannedClip[]
  total: number
  warnings: string[]
  /** 실제로 쓰인 슬롯 (자막 생성 요청용) */
  activeSlots: number[]
}

const CHIP_LABEL: Record<string, string> = { before: '시술 전', after: '시술 후', process: '시술 과정' }

/** 슬롯마다 쓸 미디어. 같은 역할을 여러 슬롯이 쓰면 hook 은 첫 장, 본 슬롯은 전부 */
export function assignMedia(purpose: PurposePreset, media: RenderMedia[]): Map<number, RenderMedia[]> {
  const out = new Map<number, RenderMedia[]>()
  const used = new Set<string>()
  purpose.video.slots.forEach((slot, i) => {
    if (slot.source !== 'media' || !slot.mediaRole) return
    let list = slot.mediaRole === 'any' ? media.filter((m) => !used.has(m.id)) : media.filter((m) => m.role === slot.mediaRole)
    if (slot.mediaRole === 'any' && !list.length) list = media
    if (slot.role === 'hook') list = list.slice(0, 1)
    else list.forEach((m) => used.add(m.id))
    if (list.length) out.set(i, list)
  })
  return out
}

/** 슬롯 길이: 최소값에서 시작해 목표 길이까지 (각 슬롯의 여유 폭에 비례해) 늘린다 */
export function slotDurations(ranges: [number, number][], target: number): number[] {
  const d = ranges.map((r) => r[0])
  let rest = target - d.reduce((a, b) => a + b, 0)
  for (let guard = 0; rest > 0.01 && guard < 10; guard++) {
    const open = ranges.map((r, i) => r[1] - d[i]!).map((x) => Math.max(0, x))
    const room = open.reduce((a, b) => a + b, 0)
    if (room <= 0.01) break
    const step = Math.min(rest, room)
    open.forEach((o, i) => (d[i]! += (o / room) * step))
    rest = target - d.reduce((a, b) => a + b, 0)
  }
  return d.map((x) => Math.round(x * 100) / 100)
}

function cardFor(spec: RenderSpec, role: string, line: string): CardPlan {
  const c = spec.mood.video.captions
  const bg = spec.mood.palette.background
  const lines: CardPlan['lines'] = []
  if (role === 'cta') {
    lines.push({ text: spec.shop.name, style: { ...c.emphasis, color: spec.brandColor ?? c.emphasis.color }, scale: 0.12 })
    if (line && line !== spec.shop.name) lines.push({ text: line, style: { ...c.main, background: null }, scale: 0.062 })
    if (spec.shop.region) lines.push({ text: spec.shop.region, style: { ...c.label, background: null }, scale: 0.048 })
  } else {
    lines.push({ text: line || spec.industryLabel, style: { ...c.emphasis, background: null }, scale: role === 'hook' ? 0.11 : 0.075 })
  }
  // 글자색이 배경과 같아 안 보이는 경우 (예: 흰 배경 + 흰 글자) 팔레트 글자색으로
  for (const l of lines) if (l.style.color.toLowerCase() === bg.toLowerCase()) l.style = { ...l.style, color: spec.mood.palette.text }
  return { key: `card-${role}`, background: bg, lines }
}

export function planVideo(spec: RenderSpec): VideoPlan {
  const warnings: string[] = []
  const { purpose, mood } = spec
  const assigned = assignMedia(purpose, spec.media)
  const active = purpose.video.slots
    .map((slot, i) => ({ slot, i }))
    .filter(({ slot, i }) => slot.source === 'card' || assigned.has(i))
  for (const [i, slot] of purpose.video.slots.entries()) {
    if (slot.source === 'media' && !slot.optional && !assigned.has(i)) {
      warnings.push(`"${slot.role}" 장면에 쓸 ${slot.mediaRole} 사진·영상이 없어 건너뜁니다`)
    }
  }
  const [lo, hi] = spec.videoDurationSec
  const durs = slotDurations(active.map(({ slot }) => slot.durationSec), (lo + hi) / 2)

  const clips: PlannedClip[] = []
  active.forEach(({ slot, i }, k) => {
    const line = spec.lines[String(i)] ?? ''
    const slotDur = durs[k]!
    if (slot.source === 'card') {
      clips.push({ slotIndex: i, role: slot.role, card: cardFor(spec, slot.role, line), start: 0, end: clamp(slotDur, 0.8, 8), focus: { x: 0.5, y: 0.5 } })
      return
    }
    let list = assigned.get(i)!
    // 한 컷이 무드의 최소 컷 길이보다 짧아지면 장수를 줄인다
    const maxCount = Math.max(1, Math.floor(slotDur / mood.video.cutSec[0]))
    if (list.length > maxCount) {
      warnings.push(`"${slot.role}" 장면 길이에 비해 사진이 많아 ${list.length - maxCount}장은 영상에서 뺍니다`)
      list = list.slice(0, maxCount)
    }
    const each = slotDur / list.length
    // 사진 한 장을 너무 오래 보여 주면 멈춘 화면처럼 보인다 → 무드 최대 컷 길이의 1.6배까지만 (모자라는 길이는 영상이 짧아짐)
    const stillMax = Math.max(2.5, mood.video.cutSec[1] * 1.6)
    list.forEach((m, j) => {
      let start = 0
      let end = clamp(each, 0.8, Math.min(8, stillMax))
      if (m.kind === 'video') {
        // 원본 끝을 넘지 않게 0.1초 여유 (등록된 길이는 내림한 값)
        const D = Math.max(0, (m.durationSec ?? each) - 0.1)
        if (D < 0.8) {
          warnings.push('1초보다 짧은 영상은 영상에서 뺍니다')
          return
        }
        const len = Math.min(each, D)
        start = Math.max(0, (D - len) / 2) // 가운데 구간 (시작·끝 손떨림 피함)
        end = start + len
      }
      clips.push({
        slotIndex: i,
        role: slot.role,
        media: m,
        start: round(start),
        end: round(end),
        caption: line ? { text: line, style: slot.role === 'hook' ? 'big' : 'sub' } : undefined,
        chip: j === 0 ? CHIP_LABEL[slot.role] : undefined,
        punch: mood.video.motion === 'punch' && slot.role === 'after' && j === 0,
        focus: m.focus ?? { x: 0.5, y: 0.5 },
      })
    })
  })
  const total = round(clips.reduce((t, c) => t + (c.end - c.start), 0))
  if (total < 3) warnings.push('영상이 3초보다 짧아요. 사진·영상을 더 올려 주세요')
  return { clips, total, warnings, activeSlots: active.map((a) => a.i) }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const round = (v: number) => Math.round(v * 100) / 100

// ─── filmcraft 프로필 (channel.toml 과 같은 구조) ────────────────────────────────

const TRANSITIONS: Record<string, string> = { cut: '', crossfade: 'cross_dissolve', whip: 'whip', zoom: 'cross_zoom', flash: 'flash' }

/** 무드 프리셋의 폰트 id → filmcraft(시스템에 설치된) 폰트 이름. 작업자가 presets/fonts/files 를 설치한다 */
export type FontFamilyOf = (fontId: string) => string

export function toProfile(spec: RenderSpec, familyOf: FontFamilyOf): Record<string, unknown> {
  const { mood, format } = spec
  const c = mood.video.captions
  const g = mood.grade
  const H = format.height
  // 예약 스티커 자리(스토리)보다 아래에는 자막을 두지 않는다 → 하단 세이프존을 그 자리 위까지 올림
  const reservedTop = format.reserved.length ? Math.min(...format.reserved.map((r) => r.y)) : H
  const safeBottom = Math.max(format.safeArea.bottom, H - reservedTop + 40)
  const strokeOf = (s: TextStyle) => s.stroke ?? s.background ?? ''
  return {
    channel: { name: spec.shop.name, handle: '', tagline: '', language: 'ko', timezone: 'Asia/Seoul' },
    children: [],
    series: { beauty: '' },
    family: { parents: [], faces_ok: [], terms_ok: [], allow_gendered: true },
    speakers: {},
    voices: { engine: 'supertonic', duck_music_db: -12, duck_original_db: -9 },
    style: {
      face_guard: false, // 얼굴 인식(macOS Vision)에 기대지 않는다 → 어디서나 같은 결과 (구도는 focus 로)
      caption_fade: mood.video.captions.main.animation === 'none' ? 0 : 0.1,
      audio_crossfade_frames: 3,
      push_in: mood.video.motion === 'static' ? 0 : 0.035,
      punch_max: 1.2,
      auto_exposure: false,
      exposure_target: 0.45,
      auto_dialogue_level: true,
      dialogue_target_db: -24,
      font: familyOf(c.main.font),
      font_style: c.main.weight,
      fun_font: familyOf(c.emphasis.font),
      fun_font_style: c.emphasis.weight,
      caption_color: c.main.color,
      caption_stroke: strokeOf(c.main),
      hook_color: c.emphasis.color,
      hook_stroke: strokeOf(c.emphasis),
      chip_color: c.label.color,
      chip_stroke: strokeOf(c.label) || mood.palette.background,
      accent_color: spec.brandColor ?? mood.palette.accent,
      grade_temperature: g.temperature,
      grade_tint: g.tint,
      grade_exposure: g.exposure,
      grade_contrast: g.contrast,
      grade_saturation: g.saturation,
      grade_vibrance: g.vibrance,
      grade_highlights: g.highlights,
      grade_shadows: g.shadows,
      grade_fade: g.fade,
      blur_background: 90,
      video_transition: TRANSITIONS[mood.video.transition] ?? '',
      video_transition_frames: Math.round(mood.video.transitionSec * format.fps),
    },
    frame: {
      canvas: mood.palette.background, title_colors: [mood.palette.accent, mood.palette.text], title_size: 80, title_top: 215,
      tag_color: '#999999', media_top: 490, media_height: 1180, watermark: '', watermark_color: '#999999',
    },
    audio: { target_lufs: -14, music_gain_db: -22, music_only_gain_db: -10 },
    short: {
      width: format.width, height: format.height, fps: format.fps, max_seconds: 60, hard_max_seconds: 90,
      video_kbps: format.encode?.videoKbps ?? 10000, audio_kbps: format.encode?.audioKbps ?? 128,
      hook_seconds: 2.5, safe_top: format.safeArea.top, safe_bottom: safeBottom, safe_side: format.safeArea.side,
    },
    long: { width: 1920, height: 1080, fps: 30, video_kbps: 16000, audio_kbps: 320, outro_seconds: 0, intro_seconds: 0, min_seconds: 0, teaser: false },
    thumbnail: { width: 1280, height: 720, bg: mood.palette.background },
    metadata: { default_tags: [], youtube_hashtags: [], instagram_hashtags: [], instagram_max_hashtags: 5 },
  }
}

// ─── filmcraft plan.json ────────────────────────────────────────────────────

/** paths: 미디어 id 또는 카드 key → 작업자 디스크의 절대 경로 */
export function toFilmcraftPlan(spec: RenderSpec, plan: VideoPlan, paths: Record<string, string>, id: string): Record<string, unknown> {
  const clips = plan.clips.map((c) => {
    const key = c.card ? c.card.key : c.media!.id
    const src = paths[key]
    if (!src) throw new Error(`파일 경로가 없어요: ${key}`)
    const len = c.end - c.start
    const captions: Record<string, unknown>[] = []
    if (c.caption) captions.push({ at: 0.1, text: c.caption.text, dur: Math.max(0.5, len - 0.2), style: c.caption.style })
    if (c.chip) captions.push({ at: 0.1, text: c.chip, dur: Math.min(1.6, Math.max(0.5, len - 0.2)), style: 'chip' })
    return {
      src,
      start: c.start,
      end: c.end,
      focus: c.focus.x,
      focus_y: c.focus.y,
      face_guard: false,
      captions,
      punch: c.punch && len > 1.4 ? [{ at: 0.3, dur: 0.8, scale: 1.2 }] : [],
      targets: ['short'],
      mute: c.media?.kind !== 'video', // 사진·카드는 소리 없음 (영상 원본 소리는 살림)
    }
  })
  const thumbIdx = Math.max(0, plan.clips.findIndex((c) => c.role === 'after'))
  return {
    id,
    date: new Date().toISOString().slice(0, 10),
    concept: `${spec.industryLabel} · ${spec.purpose.label} · ${spec.mood.label}`,
    clips,
    series: 'beauty',
    cast: [],
    layout: 'full',
    title_lines: [],
    music: null,
    outputs: { short: true, long: false },
    thumbnail: { clip: thumbIdx, at: 0.4, text: [spec.shop.name], no_face: true },
  }
}
