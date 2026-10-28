import { and, eq, sql } from 'drizzle-orm'
import { generateDrafts, type MediaAnalysis } from '@beautypost/caption'
import type { AiClient } from '@beautypost/ai'
import { schema, type Db } from '../db/index.js'
import { ApiError } from './errors.js'
import { ensureAnalyses, ownedMedia, type MediaRow } from './media.js'
import { captionSettings, resolveFor, voiceSamples, type ShopContext } from './context.js'

// 게시글 초안: 사진 분석 → 인스타 후보 3 → 정책 검사 → 생성 기록 저장 (선택·수정은 feedback 으로).
// 블로그 후보는 길어서(1,000자 이상) 따로 만든다 → 인스타 글이 먼저 빨리 나온다 (createBlogDrafts)

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
  const [, customerName, voice] = await Promise.all([
    ensureAnalyses(db, ai, rows, p.industry.label),
    customerNameOf(db, ctx, req.customerId),
    voiceSamples(db, ctx.profile.userId),
  ])

  const result = await generateDrafts(
    ai,
    {
      shop: ctx.shop,
      preset: p,
      keywords: req.keywords ?? undefined,
      customerName,
      media: rows.map((r, i) => ({ index: i + 1, role: r.role, kind: r.type, analysis: r.analysis as unknown as MediaAnalysis | null })),
      voiceSamples: voice,
      userBanned: ctx.profile.prohibitedPhrases,
      settings: captionSettings(ctx),
    },
    { instagram: req.instagram ?? 3, blog: req.blog ?? 0 },
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
      input: { ...req, mediaIds: rows.map((r) => r.id), industry: p.industry.id, mood: p.mood.id, keyword: result.keyword } as Record<string, unknown>,
      candidates: { instagram, blog },
      promptVersions: result.promptVersions,
      model: result.model,
    })
    .returning()
  return { id: gen!.id, keyword: result.keyword, industry: p.industry.id, mood: p.mood.id, instagram, blog }
}

async function customerNameOf(db: Db, ctx: ShopContext, id?: string | null): Promise<string | undefined> {
  if (!id) return undefined
  const [c] = await db
    .select({ name: schema.customers.name })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, id), eq(schema.customers.userId, ctx.profile.userId)))
    .limit(1)
  return c?.name
}

/** 블로그 후보 2개: 인스타 초안을 만든 같은 입력으로. 이미 만들었으면 저장된 것 */
export async function createBlogDrafts(db: Db, ai: AiClient, ctx: ShopContext, id: string) {
  const [gen] = await db.select().from(schema.generations).where(and(eq(schema.generations.id, id), eq(schema.generations.userId, ctx.profile.userId))).limit(1)
  if (!gen) throw new ApiError(404, 'GENERATION_NOT_FOUND', '초안을 찾을 수 없어요.')
  const existing = (gen.candidates as { blog?: unknown[] }).blog
  if (existing?.length) return { keyword: String(gen.input.keyword ?? ''), blog: existing }
  const input = gen.input as unknown as DraftRequest & { mediaIds?: string[] }
  const rows = await ownedMedia(db, ctx.profile.userId, input.mediaIds ?? []).catch(() => [] as MediaRow[])
  const p = resolveFor(ctx, { purpose: input.purpose, industry: input.industry, mood: input.mood })
  const [, customerName, voice] = await Promise.all([
    ensureAnalyses(db, ai, rows, p.industry.label),
    customerNameOf(db, ctx, input.customerId),
    voiceSamples(db, ctx.profile.userId),
  ])
  const result = await generateDrafts(
    ai,
    {
      shop: ctx.shop,
      preset: p,
      keywords: input.keywords ?? undefined,
      customerName,
      media: rows.map((r, i) => ({ index: i + 1, role: r.role, kind: r.type, analysis: r.analysis as unknown as MediaAnalysis | null })),
      voiceSamples: voice,
      userBanned: ctx.profile.prohibitedPhrases,
      settings: captionSettings(ctx),
    },
    { instagram: 0, blog: 2 },
  )
  const blog = result.blog.map((c) => ({ title: c.draft.title, sections: c.draft.sections, tags: c.draft.tags, text: c.text, findings: c.findings, rewritten: c.rewritten }))
  // 다른 요청이 그사이 인스타 선택 등을 저장했을 수 있어 candidates.blog 만 바꾼다 (한 문장).
  // 두 요청이 동시에 만들었으면 먼저 저장한 쪽을 쓴다 (블로그가 비어 있을 때만 저장)
  const saved = await db
    .update(schema.generations)
    .set({
      candidates: sql`jsonb_set(${schema.generations.candidates}, '{blog}', ${JSON.stringify(blog)}::jsonb)`,
      promptVersions: sql`${schema.generations.promptVersions} || ${JSON.stringify({ blog: result.promptVersions.blog })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.generations.id, gen.id), sql`coalesce(jsonb_array_length(${schema.generations.candidates}->'blog'), 0) = 0`))
    .returning({ id: schema.generations.id })
  if (!saved.length) {
    const [now] = await db.select({ candidates: schema.generations.candidates }).from(schema.generations).where(eq(schema.generations.id, gen.id)).limit(1)
    return { keyword: result.keyword, blog: (now?.candidates as { blog?: unknown[] } | undefined)?.blog ?? blog }
  }
  return { keyword: result.keyword, blog }
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
