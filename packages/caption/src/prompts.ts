import { RAW_PROMPTS } from '@beautypost/preset'

// 프롬프트 템플릿: presets/prompts/<id>@<version>.md (코드에 하드코딩하지 않음)
// 문법: {{변수}}, {{#if 변수}}…{{/if}} (변수가 비어 있으면 블록 통째로 생략)
// 새 버전은 파일을 추가(<id>@<n+1>.md)하면 가장 높은 버전이 쓰인다. PROMPT_<ID>=<n> 로 특정 버전 고정 가능.

export interface PromptTemplate {
  id: string
  version: number
  body: string
  /** 생성 기록에 남기는 식별자 (예: caption-instagram@1) */
  ref: string
}

export function parsePrompt(key: string, text: string): PromptTemplate {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`프롬프트 ${key}: 머리말(---)이 없어요`)
  const meta = Object.fromEntries(
    m[1]!.split('\n').map((l) => {
      const i = l.indexOf(':')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
  )
  const id = meta.id
  const version = Number(meta.version)
  if (!id || !Number.isInteger(version)) throw new Error(`프롬프트 ${key}: id/version 이 필요해요`)
  if (key !== `${id}@${version}`) throw new Error(`프롬프트 파일 이름 ${key} 와 머리말 ${id}@${version} 이 달라요`)
  return { id, version, body: m[2]!.trim(), ref: key }
}

let _all: PromptTemplate[] | null = null

export function allPrompts(raw: Record<string, string> = RAW_PROMPTS): PromptTemplate[] {
  if (raw !== RAW_PROMPTS) return Object.entries(raw).map(([k, v]) => parsePrompt(k, v))
  _all ??= Object.entries(raw).map(([k, v]) => parsePrompt(k, v))
  return _all
}

export function getPrompt(id: string, raw?: Record<string, string>): PromptTemplate {
  const list = allPrompts(raw).filter((p) => p.id === id)
  if (!list.length) throw new Error(`프롬프트 "${id}" 가 presets/prompts 에 없어요`)
  const pinned = process.env[`PROMPT_${id.toUpperCase().replace(/-/g, '_')}`]
  if (pinned) {
    const p = list.find((x) => x.version === Number(pinned))
    if (!p) throw new Error(`프롬프트 ${id}@${pinned} 가 없어요`)
    return p
  }
  return list.reduce((a, b) => (b.version > a.version ? b : a))
}

export type PromptVars = Record<string, string | number | null | undefined>

export function renderPrompt(tpl: PromptTemplate, vars: PromptVars): string {
  const has = (k: string) => {
    const v = vars[k]
    return v !== undefined && v !== null && String(v).trim() !== ''
  }
  let out = tpl.body.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k: string, inner: string) => (has(k) ? inner : ''))
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`프롬프트 ${tpl.ref}: 변수 {{${k}}} 값이 없어요`)
    return String(vars[k] ?? '')
  })
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
