import { createHash } from 'node:crypto'
import { generateVideoCopy, type MediaAnalysis } from '@beautypost/caption'
import { RenderSpec, planVideo, type RenderMedia } from '@beautypost/render'
import type { AiClient } from '@beautypost/ai'
import { getRegistry } from '@beautypost/preset'
import { eq } from 'drizzle-orm'
import { schema, type Db } from '../db/index.js'
import { enqueue } from '../jobs/queue.js'
import { ApiError } from './errors.js'
import { assertConsent, blurBoxes, tryAnalyses, type MediaRow } from './media.js'
import { captionSettings, resolveFor, type ShopContext } from './context.js'
import { areaOf } from './photos.js'

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

  // 같은 요청을 연달아 누르면 작업을 하나만 (10분 단위). AI 자막을 만들기 전에 확인해 비용을 아낀다.
  // 이미 실패한 작업은 막지 않는다 → "다시 시도"는 새 작업. 구도를 고친 뒤면 다른 요청
  const bucket = Math.floor(Date.now() / 600_000)
  let key = createHash('sha256').update(JSON.stringify([ctx.profile.userId, rows.map((r) => [r.id, r.areaBox ?? null]), req, bucket])).digest('hex')
  const [dup] = await db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, key)).limit(1)
  if (dup && dup.status !== 'failed') return { jobId: dup.id, status: dup.status, warnings: [], estimatedSeconds: 0, lines: {} }
  if (dup) key = `${key}:${Date.now()}`

  await tryAnalyses(db, ai, rows, p.industry)
  assertConsent(rows)

  const media: RenderMedia[] = rows.map((r) => ({
    id: r.id,
    url: r.originalUrl,
    kind: r.type,
    role: r.role ?? 'any',
    durationSec: r.durationSeconds,
    focus: r.areaBox ? { x: r.areaBox.x + r.areaBox.w / 2, y: r.areaBox.y + r.areaBox.h / 2 } : (r.analysis as unknown as MediaAnalysis | null)?.focus ?? null,
    area: r.type === 'image' ? areaOf(r) : null,
    blurFaces: r.type === 'image' ? blurBoxes(r) : [],
  }))
  const base = {
    specVersion: 1 as const,
    mood: p.mood,
    purpose: p.purpose,
    format: p.format,
    videoDurationSec: p.videoDurationSec,
    industryLabel: p.industry.label,
    gradeLimits: p.industry.gradeLimits,
    shop: { ...ctx.shop, handle: ctx.settings.instagramHandle || null },
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
      settings: captionSettings(ctx),
    },
    slots,
  )
  const spec = RenderSpec.parse({ ...base, lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [String(k), v])) })

  const job = await enqueue(db, {
    type: 'render_reel',
    userId: ctx.profile.userId,
    payload: spec as unknown as Record<string, unknown>,
    idempotencyKey: key,
  })
  return { jobId: job.id, status: job.status, warnings: draft.warnings, estimatedSeconds: draft.total, lines: spec.lines }
}
