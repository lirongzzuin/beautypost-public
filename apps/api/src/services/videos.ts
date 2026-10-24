import { createHash } from 'node:crypto'
import { generateVideoCopy, type MediaAnalysis } from '@beautypost/caption'
import { RenderSpec, planVideo, type RenderMedia } from '@beautypost/render'
import type { AiClient } from '@beautypost/ai'
import { getRegistry } from '@beautypost/preset'
import type { Db } from '../db/index.js'
import { enqueue } from '../jobs/queue.js'
import { ApiError } from './errors.js'
import { assertConsent, blurBoxes, ensureAnalysis, type MediaRow } from './media.js'
import { resolveFor, type ShopContext } from './context.js'

// 영상 만들기 요청 → 작업 입력(RenderSpec) 작성 → 작업 큐 등록. 실제 렌더링은 작업자가 한다 (즉시 응답).

export interface VideoRequest {
  purpose: string
  industry?: string | null
  mood?: string | null
  format: string
  keywords?: string | null
}

export async function requestVideo(db: Db, ai: AiClient, ctx: ShopContext, rows: MediaRow[], req: VideoRequest) {
  const reg = getRegistry()
  if (!reg.has('formats', req.format) || reg.format(req.format).kind === 'photo') {
    throw new ApiError(400, 'FORMAT_INVALID', `영상으로 만들 수 없는 형식이에요: ${req.format}`)
  }
  const p = resolveFor(ctx, { purpose: req.purpose, industry: req.industry, mood: req.mood, format: req.format })
  for (const r of rows) await ensureAnalysis(db, ai, r, p.industry.label)
  assertConsent(rows, { video: true })

  const media: RenderMedia[] = rows.map((r) => ({
    id: r.id,
    url: r.originalUrl,
    kind: r.type,
    role: r.role ?? 'any',
    durationSec: r.durationSeconds,
    focus: (r.analysis as unknown as MediaAnalysis | null)?.focus ?? null,
    blurFaces: r.type === 'image' ? blurBoxes(r) : [],
  }))
  const base = {
    specVersion: 1 as const,
    mood: p.mood,
    purpose: p.purpose,
    format: p.format,
    videoDurationSec: p.videoDurationSec,
    industryLabel: p.industry.label,
    shop: ctx.shop,
    brandColor: ctx.brandPreset?.brandColor ?? null,
    logoUrl: null as string | null,
    media,
    lines: {} as Record<string, string>,
  }
  const draft = planVideo(RenderSpec.parse(base))
  if (!draft.clips.some((c) => c.media)) {
    throw new ApiError(400, 'NO_SCENES', '이 콘텐츠 목적에 맞는 사진·영상이 없어요. 사진 역할(비포·애프터 등)을 확인해 주세요.', { warnings: draft.warnings })
  }

  // 화면 자막: 실제로 쓰는 장면만 AI 로 한 줄씩 (이모지 제거·글자 수·금지 표현 검사 포함)
  const slots = draft.activeSlots
    .map((i) => ({ i, slot: p.purpose.video.slots[i]! }))
    .filter(({ slot }) => slot.caption)
    .map(({ i, slot }) => ({ index: i, role: slot.role, intent: slot.caption!.intent, maxChars: slot.caption!.maxChars }))
  const { lines } = await generateVideoCopy(
    ai,
    {
      shop: ctx.shop,
      preset: p,
      keywords: req.keywords ?? undefined,
      media: rows.map((r, i) => ({ index: i + 1, role: r.role, kind: r.type, analysis: r.analysis as unknown as MediaAnalysis | null })),
      voiceSamples: [],
      userBanned: ctx.profile.prohibitedPhrases,
    },
    slots,
  )
  const spec = RenderSpec.parse({ ...base, lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [String(k), v])) })

  // 같은 요청을 연달아 누르면 작업을 하나만 만든다 (10분 단위)
  const bucket = Math.floor(Date.now() / 600_000)
  const key = createHash('sha256').update(JSON.stringify([ctx.profile.userId, rows.map((r) => r.id), req, bucket])).digest('hex')
  const job = await enqueue(db, {
    type: 'render_reel',
    userId: ctx.profile.userId,
    payload: spec as unknown as Record<string, unknown>,
    idempotencyKey: key,
  })
  return { jobId: job.id, status: job.status, warnings: draft.warnings, estimatedSeconds: draft.total, lines: spec.lines }
}
