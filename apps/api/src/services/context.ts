import { desc, eq, isNotNull, and } from 'drizzle-orm'
import {
  BrandPreset,
  PresetNotFoundError,
  getRegistry,
  resolvePreset,
  type BrandPresetInput,
  type MoodOverrides,
  type ResolvedPreset,
} from '@beautypost/preset'
import { schema, type Db } from '../db/index.js'
import { ApiError } from './errors.js'

// 생성 요청마다 필요한 샵 정보·브랜드 기본값·프리셋 해석을 한곳에서.

export type ProfileRow = typeof schema.profiles.$inferSelect
export type BrandRow = typeof schema.brandProfiles.$inferSelect

export interface ShopContext {
  profile: ProfileRow
  brand: BrandRow | null
  brandPreset: BrandPresetInput | null
  shop: { name: string; region: string; booking: string | null }
}

const CATEGORY_TO_INDUSTRY: Record<string, string> = {
  eyebrow_tattoo: 'eyebrow', lash_perm: 'lash', nail: 'nail', lip_blush: 'lip-blush',
}

export async function loadShop(db: Db, userId: string): Promise<ShopContext> {
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1)
  if (!profile) throw new ApiError(400, 'PROFILE_REQUIRED', '프로필 설정을 먼저 완료해주세요.')
  const [brand] = await db.select().from(schema.brandProfiles).where(eq(schema.brandProfiles.userId, userId)).limit(1)
  const parsed = brand?.brandPreset ? BrandPreset.safeParse(brand.brandPreset) : null
  return {
    profile,
    brand: brand ?? null,
    brandPreset: parsed?.success ? parsed.data : null,
    shop: { name: profile.shopName, region: profile.region, booking: brand?.bookingLabel ?? null },
  }
}

/** 업종: 요청 > 브랜드 기본값 > 프로필의 서비스·업종에서 추정 > 첫 업종 */
export function industryOf(ctx: ShopContext, requested?: string | null): string {
  const reg = getRegistry()
  if (requested) return requested
  if (ctx.brand?.industry && reg.has('industries', ctx.brand.industry)) return ctx.brand.industry
  for (const key of ctx.profile.services) {
    const ind = reg.industryForService(key)
    if (ind) return ind.id
  }
  return CATEGORY_TO_INDUSTRY[ctx.profile.category] ?? reg.data.industries[0]!.id
}

export function resolveFor(
  ctx: ShopContext,
  req: { purpose: string; industry?: string | null; mood?: string | null; format?: string | null; adjust?: MoodOverrides | null },
): ResolvedPreset {
  try {
    return resolvePreset(getRegistry(), {
      purpose: req.purpose,
      industry: industryOf(ctx, req.industry),
      mood: req.mood ?? undefined,
      format: req.format ?? 'feed-portrait',
      brand: ctx.brandPreset,
      adjust: req.adjust ?? null,
    })
  } catch (e) {
    if (e instanceof PresetNotFoundError) throw new ApiError(400, 'PRESET_NOT_FOUND', `선택한 스타일을 찾을 수 없어요 (${e.kind}/${e.id})`)
    throw new ApiError(400, 'PRESET_INVALID', '스타일 조정 값이 허용 범위를 벗어났어요.')
  }
}

/** 말투 샘플: 원장님이 직접 넣은 글(style_examples) + 최근에 고르거나 고친 인스타 글 */
export async function voiceSamples(db: Db, userId: string): Promise<string[]> {
  const own = await db
    .select({ text: schema.styleExamples.text })
    .from(schema.styleExamples)
    .where(eq(schema.styleExamples.userId, userId))
    .orderBy(desc(schema.styleExamples.createdAt))
    .limit(5)
  const picked = await db
    .select({ edited: schema.generations.edited })
    .from(schema.generations)
    .where(and(eq(schema.generations.userId, userId), isNotNull(schema.generations.edited)))
    .orderBy(desc(schema.generations.updatedAt))
    .limit(3)
  const fromPicks = picked.map((p) => p.edited?.instagram).filter((t): t is string => !!t?.trim())
  return [...new Set([...own.map((o) => o.text), ...fromPicks])].slice(0, 6)
}
