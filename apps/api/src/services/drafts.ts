import { and, eq } from 'drizzle-orm'
import { generateDrafts, type MediaAnalysis } from '@beautypost/caption'
import type { AiClient } from '@beautypost/ai'
import { schema, type Db } from '../db/index.js'
import { ApiError } from './errors.js'
import { ensureAnalysis, type MediaRow } from './media.js'
import { resolveFor, voiceSamples, type ShopContext } from './context.js'

// 게시글 초안: 사진 분석 → 인스타 후보 3 · 블로그 후보 2 → 정책 검사 → 생성 기록 저장 (선택·수정은 feedback 으로)

export interface DraftRequest {
  purpose: string
  industry?: string | null
  mood?: string | null
  keywords?: string | null
  customerId?: string | null
  instagram?: number
  blog?: number
}

export async function createDrafts(db: Db, ai: AiClient, ctx: ShopContext, rows: MediaRow[], req: DraftRequest) {
  const p = resolveFor(ctx, { purpose: req.purpose, industry: req.industry, mood: req.mood })
  for (const r of rows) await ensureAnalysis(db, ai, r, p.industry.label)

  let customerName: string | undefined
  if (req.customerId) {
    const [c] = await db
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, req.customerId), eq(schema.customers.userId, ctx.profile.userId)))
      .limit(1)
    customerName = c?.name
  }

  const result = await generateDrafts(
    ai,
    {
      shop: ctx.shop,
      preset: p,
      keywords: req.keywords ?? undefined,
      customerName,
      media: rows.map((r, i) => ({ index: i + 1, role: r.role, kind: r.type, analysis: r.analysis as unknown as MediaAnalysis | null })),
      voiceSamples: await voiceSamples(db, ctx.profile.userId),
      userBanned: ctx.profile.prohibitedPhrases,
    },
    { instagram: req.instagram ?? 3, blog: req.blog ?? 2 },
  )

  const instagram = result.instagram.map((c) => ({
    angle: c.draft.angle, caption: c.draft.caption, hashtags: c.draft.hashtags, text: c.text, kakao: c.kakao,
    findings: c.findings, rewritten: c.rewritten,
  }))
  const blog = result.blog.map((c) => ({ title: c.draft.title, sections: c.draft.sections, tags: c.draft.tags, text: c.text, findings: c.findings, rewritten: c.rewritten }))
  const [gen] = await db
    .insert(schema.generations)
    .values({
      userId: ctx.profile.userId,
      kind: 'caption',
      input: { ...req, mediaIds: rows.map((r) => r.id), industry: p.industry.id, mood: p.mood.id } as Record<string, unknown>,
      candidates: { instagram, blog },
      promptVersions: result.promptVersions,
      model: result.model,
    })
    .returning()
  return { id: gen!.id, keyword: result.keyword, industry: p.industry.id, mood: p.mood.id, instagram, blog }
}

/** 원장님이 고른 후보와 직접 고친 최종본 → 다음 생성의 말투 샘플이 된다 (context.voiceSamples) */
export async function saveFeedback(db: Db, userId: string, id: string, fb: { channel: 'instagram' | 'blog'; index: number; text: string }) {
  const [gen] = await db.select().from(schema.generations).where(and(eq(schema.generations.id, id), eq(schema.generations.userId, userId))).limit(1)
  if (!gen) throw new ApiError(404, 'GENERATION_NOT_FOUND', '초안을 찾을 수 없어요.')
  const chosen = { ...(gen.chosen ?? {}), [fb.channel]: fb.index }
  // 인스타는 해시태그 줄을 빼고 본문만 말투 샘플로
  const body = fb.channel === 'instagram' ? fb.text.replace(/\n+(#\S+\s*)+$/u, '').trim() : fb.text.trim()
  const edited = { ...(gen.edited ?? {}), [fb.channel]: body }
  await db.update(schema.generations).set({ chosen, edited, updatedAt: new Date() }).where(eq(schema.generations.id, id))
  return { ok: true }
}
