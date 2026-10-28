import { describe, expect, it } from 'vitest'
import { createAiClient, type MockResponder } from '@beautypost/ai'
import { getRegistry, resolvePreset } from '@beautypost/preset'
import {
  allPrompts,
  analyzeImage,
  blogText,
  checkText,
  fixBlogPhotos,
  generateDrafts,
  generateVideoCopy,
  getPrompt,
  keywordsFor,
  mockResponder,
  normalizeHashtags,
  parsePrompt,
  renderPrompt,
  screenLine,
  shortRegion,
  type DraftContext,
} from '../src/index.js'

const reg = getRegistry()

function ctx(over: Partial<DraftContext> = {}): DraftContext {
  return {
    shop: { name: '뷰티룸', region: '서울 강남구 역삼동', booking: '프로필 링크' },
    preset: resolvePreset(reg, { purpose: 'before-after', industry: 'eyebrow', format: 'reel', mood: 'warm-natural' }),
    media: [
      { index: 1, role: 'before', kind: 'image', analysis: null },
      { index: 2, role: 'after', kind: 'image', analysis: null },
    ],
    voiceSamples: ['오늘도 예쁘게 완성 :)'],
    ...over,
  }
}

describe('프롬프트 템플릿', () => {
  it('모든 템플릿이 파싱되고 필수 변수를 채우면 렌더된다', () => {
    expect([...new Set(allPrompts().map((p) => p.id))].sort()).toEqual(['caption-blog', 'caption-instagram', 'caption-rewrite', 'media-analysis', 'media-analysis-batch', 'video-captions'])
    expect(getPrompt('caption-instagram').version).toBe(2)
  })
  it('{{#if}} 는 중첩할 수 있다', () => {
    const t = parsePrompt('n@1', '---\nid: n\nversion: 1\n---\n[{{#if a}}A{{#if b}}B{{/if}}{{/if}}]')
    expect(renderPrompt(t, { a: '1', b: '' })).toBe('[A]')
    expect(renderPrompt(t, { a: '1', b: '1' })).toBe('[AB]')
    expect(renderPrompt(t, { a: '', b: '1' })).toBe('[]')
  })
  it('{{#if}} 블록은 값이 비면 사라지고, 없는 변수는 오류', () => {
    const t = parsePrompt('t@1', '---\nid: t\nversion: 1\n---\nA{{#if x}} X={{x}}{{/if}} B={{y}}')
    expect(renderPrompt(t, { x: '', y: 1 })).toBe('A B=1')
    expect(renderPrompt(t, { x: 'k', y: 1 })).toBe('A X=k B=1')
    expect(() => renderPrompt(t, { x: '' })).toThrow(/\{\{y\}\}/)
  })
  it('가장 높은 버전을 쓰고, 환경변수로 버전을 고정할 수 있다', () => {
    const raw = {
      'a@1': '---\nid: a\nversion: 1\n---\nv1',
      'a@2': '---\nid: a\nversion: 2\n---\nv2',
    }
    expect(getPrompt('a', raw).body).toBe('v2')
    process.env.PROMPT_A = '1'
    expect(getPrompt('a', raw).body).toBe('v1')
    delete process.env.PROMPT_A
  })
  it('파일 이름과 머리말 버전이 다르면 오류', () => {
    expect(() => parsePrompt('a@2', '---\nid: a\nversion: 1\n---\nx')).toThrow()
  })
})

describe('정책 검사', () => {
  const lists = reg.data.policy
  it('의료 단정은 block, 상투어는 warn, 업종·원장님 금지어도 잡는다', () => {
    const f = checkText('부작용 없는 시술! 특별한 경험. 번짐 없이 오래가요. 할인중', {
      lists,
      industryBanned: ['번짐 없'],
      userBanned: ['할인중'],
    })
    const by = Object.fromEntries(f.map((x) => [x.match, x.severity]))
    expect(by['부작용 없']).toBe('block')
    expect(by['특별한 경험']).toBe('warn')
    expect(by['번짐 없']).toBe('block')
    expect(by['할인중']).toBe('block')
  })
  it('"반영구"는 정상 단어로 통과한다', () => {
    expect(checkText('반영구 눈썹 리터치 안내', { lists })).toEqual([])
  })
})

describe('서식', () => {
  it('지역 이름을 짧게 만들어 키워드·해시태그를 만든다', () => {
    expect(shortRegion('서울 강남구 역삼동')).toBe('역삼')
    expect(shortRegion('부산')).toBe('부산')
    expect(shortRegion('성수동')).toBe('성수')
    expect(keywordsFor(['{region} 눈썹문신'], '서울 강남구')).toEqual(['강남 눈썹문신'])
  })
  it('해시태그: # 붙이기, 공백 제거, 중복 제거, 지역 태그 우선, 10~15개', () => {
    const tags = normalizeHashtags(['눈썹 문신', '#눈썹문신', '#반영구'], { priority: ['역삼눈썹문신'], fill: ['#a', '#b', '#c', '#d', '#e', '#f', '#g', '#h', '#i'] })
    expect(tags[0]).toBe('#역삼눈썹문신')
    expect(tags).toContain('#눈썹문신')
    expect(tags.filter((t) => t === '#눈썹문신')).toHaveLength(1)
    expect(tags.length).toBeGreaterThanOrEqual(10)
    expect(normalizeHashtags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(15)
  })
  it('블로그 사진 자리: 없는 번호 제거, 안 쓴 사진 배치', () => {
    const d = fixBlogPhotos({ title: 't', tags: [], sections: [{ heading: 'a', body: 'x', photo: 9 }, { heading: 'b', body: 'y', photo: null }] }, 2)
    expect(d.sections.map((s) => s.photo)).toEqual([1, 2])
    expect(blogText(d)).toContain('[사진 1]')
  })
  it('화면 자막은 이모지를 빼고 글자 수를 지킨다', () => {
    expect(screenLine('예쁜 눈썹 ✨ 완성했어요', 6)).toBe('예쁜 눈썹')
  })
})

describe('게시글 생성 (목 모델)', () => {
  it('인스타 3개·블로그 2개 후보, 지역 키워드·해시태그(기본 5개)·카카오 문구까지', async () => {
    const ai = createAiClient({ mock: mockResponder })
    const r = await generateDrafts(ai, ctx())
    expect(r.instagram).toHaveLength(3)
    expect(r.blog).toHaveLength(2)
    expect(r.keyword).toBe('역삼 눈썹문신')
    expect(new Set(r.instagram.map((c) => c.draft.angle)).size).toBe(3) // 서로 다른 형식
    for (const c of r.instagram) {
      expect(c.draft.hashtags[0]).toBe('#역삼눈썹문신')
      expect(c.draft.hashtags).toHaveLength(5)
      expect(c.text).toContain(c.draft.hashtags.join(' '))
      expect(c.kakao).toContain('📍 뷰티룸')
      expect(c.findings.filter((f) => f.severity === 'block')).toEqual([])
    }
    expect(r.blog[0]!.draft.title).toContain('역삼 눈썹문신')
    expect(r.blog[0]!.text).toMatch(/\[사진 1\][\s\S]*\[사진 2\]/)
    expect(r.promptVersions.instagram).toBe('caption-instagram@2')
  })

  it('샵 고정 안내 문구는 본문과 해시태그 사이에 그대로, 고정 해시태그는 앞쪽에, 개수는 설정대로', async () => {
    const prompts: string[] = []
    const ai = createAiClient({ mock: (req) => (prompts.push(req.prompt), mockResponder(req)) })
    const signature = '𝗿𝗲𝘀𝗲𝗿𝘃𝗮𝘁𝗶𝗼𝗻\n* 카카오채널 #뷰티룸'
    const r = await generateDrafts(ai, ctx({ settings: { signature, hashtagCount: 3, brandHashtags: ['#뷰티룸'] } }), { instagram: 1, blog: 0 })
    const c = r.instagram[0]!
    expect(c.draft.hashtags).toEqual(['#역삼눈썹문신', '#역삼반영구눈썹', '#뷰티룸'])
    expect(c.text).toBe(`${c.draft.caption.trim()}\n\n${signature}\n\n#역삼눈썹문신 #역삼반영구눈썹 #뷰티룸`)
    // 고정 안내가 있으면 AI 에게 예약 문장을 쓰지 말라고 한다
    expect(prompts[0]).toContain('고정 안내 문구가 글 끝에 자동으로')
    expect(prompts[0]).toContain('[해시태그] 3개')
  })

  it('고정 안내가 없으면 마지막 줄 예약 유도를 쓰게 한다', async () => {
    const prompts: string[] = []
    const ai = createAiClient({ mock: (req) => (prompts.push(req.prompt), mockResponder(req)) })
    await generateDrafts(ai, ctx(), { instagram: 1, blog: 0 })
    expect(prompts[0]).toContain('마지막 줄 예약 유도는 한 문장')
    expect(prompts[0]).not.toContain('고정 안내 문구가 글 끝에')
  })

  it('프롬프트에 사진 분석·말투·업종 어휘·금지 표현이 들어간다', async () => {
    const prompts: string[] = []
    const spy: MockResponder = (req) => {
      prompts.push(req.prompt)
      return mockResponder(req)
    }
    await generateDrafts(createAiClient({ mock: spy }), ctx({
      media: [{ index: 1, role: 'after', kind: 'image', analysis: { subject: '결 눈썹 클로즈업', area: 'eyebrow', stage: 'after', details: ['앞머리 결 표현'], colors: ['브라운'], faces: [], focus: { x: 0.5, y: 0.4 }, textInImage: '', quality: { brightness: 'ok', blurry: false } } }],
    }), { instagram: 2, blog: 0 })
    const p = prompts[0]!
    expect(p).toContain('결 눈썹 클로즈업')
    expect(p).toContain('앞머리 결 표현')
    expect(p).toContain('오늘도 예쁘게 완성')
    expect(p).toContain('엠보')
    expect(p).toContain('번짐 없')
    expect(p).toContain('#역삼눈썹문신')
  })

  it('금지 표현이 나오면 자동으로 고치고, 고친 뒤에는 block 이 없다', async () => {
    const bad: MockResponder = (req) => {
      if (req.task === 'caption-instagram') {
        return { candidates: [{ angle: '결과형', caption: '부작용 없는 눈썹!\n평생 유지돼요', hashtags: ['#눈썹'] }] }
      }
      return mockResponder(req)
    }
    const r = await generateDrafts(createAiClient({ mock: bad }), ctx(), { instagram: 1, blog: 0 })
    const c = r.instagram[0]!
    expect(c.rewritten).toBe(true)
    expect(c.draft.caption).not.toContain('부작용 없')
    expect(c.findings.some((f) => f.severity === 'block')).toBe(false)
  })

  it('목 응답이 스키마와 다르면 오류 (실제 모델 응답과 같은 검증)', async () => {
    const broken: MockResponder = () => ({ candidates: [{ angle: 1 }] })
    await expect(generateDrafts(createAiClient({ mock: broken }), ctx(), { blog: 0 })).rejects.toThrow()
  })
})

describe('사진 분석·영상 자막', () => {
  it('분석 결과는 스키마를 지키고 역할을 프롬프트에 넘긴다', async () => {
    let seen = ''
    const ai = createAiClient({ mock: (req) => { seen = req.prompt; return mockResponder(req) } })
    const r = await analyzeImage(ai, { data: new Uint8Array([1]), mediaType: 'image/jpeg' }, { industryLabel: '네일아트', role: 'before' })
    expect(r.analysis.stage).toBe('before')
    expect(seen).toContain('비포')
  })

  it('영상 자막: 슬롯마다 한 줄, 글자 수 제한, 금지 표현은 기본 문구로', async () => {
    const ai = createAiClient({
      mock: (req) => req.task === 'video-captions'
        ? { lines: [{ slot: 1, text: '부작용 없는 눈썹 ✨' }, { slot: 2, text: '아주아주아주아주 긴 자막입니다 정말로' }] }
        : mockResponder(req),
    })
    const { lines } = await generateVideoCopy(ai, ctx(), [
      { index: 1, role: 'hook', intent: '후킹', maxChars: 14 },
      { index: 2, role: 'after', intent: '결과', maxChars: 10 },
      { index: 3, role: 'cta', intent: '예약', maxChars: 20 },
    ])
    expect(lines[1]).toBe('비포·애프터') // 금지 표현 → 기본 문구 (목적 이름)
    expect([...lines[2]!].length).toBeLessThanOrEqual(10)
    expect(lines[3]).toBe('뷰티룸 · 프로필 링크')
  })
})
