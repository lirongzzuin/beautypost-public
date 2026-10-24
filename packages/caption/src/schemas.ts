import { z } from 'zod'
import { COPY_SECTIONS } from '@beautypost/preset'

// AI 출력 형식. 모델은 이 스키마에 맞춰 구조화된 JSON 을 낸다.

const Box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })

export const MediaAnalysis = z.object({
  subject: z.string().describe('사진에 보이는 것 한 문장'),
  area: z.enum(['eyebrow', 'lash', 'lip', 'nail', 'hair', 'scalp', 'skin', 'body', 'shop', 'person', 'document', 'other']),
  stage: z.enum(['before', 'after', 'process', 'unknown']),
  details: z.array(z.string()).max(8).describe('구체적인 관찰'),
  colors: z.array(z.string()).max(4),
  faces: z.array(Box).max(10).describe('얼굴 영역 (0~1)'),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).describe('시술 부위 중심'),
  textInImage: z.string(),
  quality: z.object({ brightness: z.enum(['dark', 'ok', 'bright']), blurry: z.boolean() }),
})
export type MediaAnalysis = z.infer<typeof MediaAnalysis>

export const InstagramDraft = z.object({
  angle: z.string().describe('후킹 방식 (예: 결과형, 질문형, 공감형)'),
  caption: z.string().describe('해시태그를 뺀 본문'),
  hashtags: z.array(z.string()).describe('# 포함'),
})
export const InstagramDrafts = z.object({ candidates: z.array(InstagramDraft).min(1).max(3) })
export type InstagramDraft = z.infer<typeof InstagramDraft>

export const BlogSection = z.object({
  heading: z.string(),
  body: z.string(),
  photo: z.number().int().nullable().describe('이 섹션에 넣을 사진 번호 (1부터). 없으면 null'),
})
export const BlogDraft = z.object({
  title: z.string(),
  sections: z.array(BlogSection).min(2).max(8),
  tags: z.array(z.string()),
})
export const BlogDrafts = z.object({ candidates: z.array(BlogDraft).min(1).max(3) })
export type BlogDraft = z.infer<typeof BlogDraft>

export const Rewrite = z.object({ text: z.string() })

export const VideoCopy = z.object({ lines: z.array(z.object({ slot: z.number().int(), text: z.string() })) })
export type VideoCopy = z.infer<typeof VideoCopy>

export const CopySection = z.enum(COPY_SECTIONS)
