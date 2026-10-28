import type { MockResponder } from '@beautypost/ai'

// AI 키가 없는 로컬 개발·테스트용 결정적 응답 (AI_PROVIDER=mock).
// 실제 모델처럼 프롬프트의 값(샵 이름·업종·자막 슬롯)을 읽어 그럴듯한 한국어를 만든다. 품질 평가용이 아니다.

function pick(prompt: string, re: RegExp, fallback = ''): string {
  return prompt.match(re)?.[1]?.trim() ?? fallback
}

export const mockResponder: MockResponder = (req) => {
  const p = req.prompt
  const shop = pick(p, /"([^"]+)"/, '우리 샵')
  const industry = pick(p, /업종: ([^\n/,]+)/, '시술')
  const count = Number(pick(p, /후보 (\d+)개/, '2'))
  switch (req.task) {
    case 'media-analysis': {
      const role = pick(p, /역할: (\S+)/)
      const stage = role === '비포' ? 'before' : role === '애프터' ? 'after' : role === '시술 과정' ? 'process' : 'unknown'
      return {
        subject: `${industry} 시술 부위를 가까이 찍은 사진`,
        area: 'other',
        stage,
        details: ['가까이서 찍은 시술 부위', '밝은 실내 조명'],
        colors: ['베이지'],
        faces: [],
        focus: { x: 0.5, y: 0.5 },
        areaBox: { x: 0.3, y: 0.35, w: 0.4, h: 0.2 },
        textInImage: '',
        quality: { brightness: 'ok', blurry: false },
      }
    }
    case 'caption-instagram':
      return {
        candidates: ['시술 기록', '한 장면 대화', '짧은 팁'].slice(0, count).map((angle, i) => ({
          angle,
          caption: [
            i === 1 ? `“티 안 나게 할 수 있을까요?”` : i === 2 ? `${industry} 디자인은 얼굴형에서 시작해요.` : `비어 있던 부분을 채우고 싶다고 오신 고객님.`,
            '',
            '얼굴형과 기존 결 방향을 먼저 보고',
            '디자인을 함께 정했어요.',
            '',
            `${shop}이 생각하는 ${industry}는 원래 내 것처럼 자연스러운 모습이에요.`,
          ].join('\n'),
          hashtags: [`#${industry.replace(/\s+/g, '')}`, '#뷰티샵', '#1인샵'],
        })),
      }
    case 'caption-blog':
      return {
        candidates: Array.from({ length: count }, (_, i) => ({
          title: i === 0 ? `${industry} 디자인 상담부터 완성까지` : `${industry} 받기 전 알아두면 좋은 점`,
          sections: [
            { heading: '이런 고민으로 오셨어요', body: `${industry}를 처음 받으시는 분들은 디자인이 어색할까 걱정하세요. 상담에서 평소 스타일을 먼저 여쭤봐요.`, photo: 1 },
            { heading: '시술 포인트', body: '얼굴형과 피부 상태를 보고 디자인을 정한 뒤 단계별로 진행했어요.', photo: 2 },
            { heading: '관리 방법', body: '시술 후 관리 방법은 개인차가 있어 상담 때 자세히 안내드려요.', photo: null },
            { heading: '예약 안내', body: `${shop}은 1:1 예약제로 운영해요. 편하실 때 문의 주세요.`, photo: null },
          ],
          tags: [industry.replace(/\s+/g, ''), '뷰티샵', '1인샵', '예약제', '상담'],
        })),
      }
    case 'caption-rewrite': {
      // 지적된 표현을 지운다
      const text = p.split('[글]\n')[1] ?? ''
      const bad = [...p.matchAll(/- "([^"]+)":/g)].map((m) => m[1]!)
      return { text: bad.reduce((t, b) => t.replaceAll(b, ''), text).replace(/ {2,}/g, ' ') }
    }
    case 'video-captions': {
      const slots = [...p.matchAll(/^(\d+)\. \[(\w+)\] ([^—\n]+)/gm)].map((m) => ({ slot: Number(m[1]), role: m[2]!, intent: m[3]!.trim() }))
      const by: Record<string, string> = { hook: `${industry} 결과`, before: '시술 전 고민', after: '자연스러운 마무리', process: '꼼꼼한 과정', compare: '전후 비교', cta: `${shop} 예약 문의`, info: '자세한 안내', detail: '디테일', shop: '편안한 공간', owner: '원장님 1:1', review: '고객님 후기' }
      return { lines: slots.map((s) => ({ slot: s.slot, text: by[s.role] ?? s.intent })) }
    }
    default:
      throw new Error(`mock: 알 수 없는 작업 ${req.task}`)
  }
}
