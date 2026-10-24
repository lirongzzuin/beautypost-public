import type { BlogDraft } from './schemas.js'

// 채널별 서식: 해시태그 정리, 지역 키워드, 복사용 텍스트

/** "서울 강남구 역삼동" → "역삼", "부산" → "부산", "성수동" → "성수" (해시태그·키워드용 짧은 지역명) */
export function shortRegion(region: string): string {
  const last = region.trim().split(/\s+/).filter(Boolean).pop() ?? ''
  const stripped = last.replace(/(특별시|광역시|특별자치시|특별자치도|시|구|군|동|읍|면|가)$/u, '')
  return stripped.length >= 2 ? stripped : last
}

export function keywordsFor(patterns: string[], region: string): string[] {
  const r = shortRegion(region)
  return patterns.map((p) => p.replaceAll('{region}', r).trim()).filter(Boolean)
}

export function toHashtag(s: string): string | null {
  const body = s.replace(/^#+/, '').replace(/[\s.,!?·'"()[\]{}<>/\\|~`@$%^&*=+;:-]+/gu, '')
  return body ? `#${body}` : null
}

/** # 붙이기·공백 제거·중복 제거. 지역 키워드 태그를 앞에, 개수는 [min, max] */
export function normalizeHashtags(tags: string[], opts: { priority?: string[]; fill?: string[]; min?: number; max?: number } = {}): string[] {
  const min = opts.min ?? 10
  const max = opts.max ?? 15
  const seen = new Set<string>()
  const out: string[] = []
  const add = (t: string) => {
    const h = toHashtag(t)
    if (!h || seen.has(h.toLowerCase())) return
    seen.add(h.toLowerCase())
    out.push(h)
  }
  for (const t of opts.priority ?? []) add(t)
  for (const t of tags) add(t)
  for (const t of opts.fill ?? []) {
    if (out.length >= min) break
    add(t)
  }
  return out.slice(0, max)
}

export function instagramText(caption: string, hashtags: string[]): string {
  return `${caption.trim()}\n\n${hashtags.join(' ')}`
}

/** 네이버 블로그에 붙여넣기 좋은 텍스트. [사진 N] 은 원장님이 사진을 넣을 자리 */
export function blogText(d: BlogDraft): string {
  const parts = [d.title.trim(), '']
  for (const s of d.sections) {
    parts.push(`■ ${s.heading.trim()}`)
    if (s.photo) parts.push(`[사진 ${s.photo}]`)
    parts.push(s.body.trim(), '')
  }
  if (d.tags.length) parts.push(d.tags.map((t) => `#${t.replace(/^#/, '').replace(/\s+/g, '')}`).join(' '))
  return parts.join('\n').trim()
}

/** 카카오톡 채널·문자용: 해시태그 없이 + 매장·예약 한 줄 */
export function kakaoText(caption: string, shop: { name: string; booking?: string | null }): string {
  const tail = [`📍 ${shop.name}`, shop.booking ? `예약: ${shop.booking}` : null].filter(Boolean).join('\n')
  return `${caption.trim()}\n\n${tail}`
}

/** 블로그 사진 번호를 실제 사진 수에 맞춘다 (없는 번호 제거, 안 쓴 사진은 뒤 섹션부터 배치) */
export function fixBlogPhotos(d: BlogDraft, photoCount: number): BlogDraft {
  const used = new Set<number>()
  const sections = d.sections.map((s) => {
    const ok = s.photo && s.photo >= 1 && s.photo <= photoCount && !used.has(s.photo)
    if (ok) used.add(s.photo!)
    return { ...s, photo: ok ? s.photo : null }
  })
  const missing = Array.from({ length: photoCount }, (_, i) => i + 1).filter((n) => !used.has(n))
  for (const s of sections) {
    if (!missing.length) break
    if (!s.photo) s.photo = missing.shift()!
  }
  return { ...d, sections }
}

const EMOJI = /\p{Extended_Pictographic}|️|‍/gu

/** 화면 자막: 이모지 제거 + 글자 수 제한 */
export function screenLine(text: string, maxChars: number): string {
  const clean = text.replace(EMOJI, '').replace(/\s+/g, ' ').trim()
  return [...clean].length <= maxChars ? clean : [...clean].slice(0, maxChars).join('').trim()
}
