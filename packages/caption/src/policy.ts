import type { PolicyList } from '@beautypost/preset'

// 금지·과장·의료 표현과 AI 상투어 검사 (결정적 규칙). 생성 후 반드시 거친다.
// 규칙 원본: presets/policy/*.json + 업종 extraBannedPhrases + 원장님이 설정한 금지어.

export interface Finding {
  listId: string
  severity: 'block' | 'warn'
  match: string
  index: number
  reason: string
  suggest?: string
}

export interface PolicyInput {
  lists: PolicyList[]
  /** 업종 금지어 (block) */
  industryBanned?: string[]
  /** 원장님이 직접 등록한 금지어 (block) */
  userBanned?: string[]
}

function literalRe(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu')
}

export function checkText(text: string, input: PolicyInput): Finding[] {
  const rules: { listId: string; severity: 'block' | 'warn'; re: RegExp; reason: string; suggest?: string }[] = []
  for (const list of input.lists) {
    for (const r of list.rules) {
      rules.push({
        listId: list.id,
        severity: list.severity,
        re: r.kind === 'regex' ? new RegExp(r.match, 'gu') : literalRe(r.match),
        reason: r.reason,
        suggest: r.suggest,
      })
    }
  }
  for (const p of input.industryBanned ?? []) {
    if (p.trim()) rules.push({ listId: 'industry', severity: 'block', re: literalRe(p.trim()), reason: '이 업종에서 쓰면 안 되는 표현' })
  }
  for (const p of input.userBanned ?? []) {
    if (p.trim()) rules.push({ listId: 'user', severity: 'block', re: literalRe(p.trim()), reason: '원장님이 금지어로 등록한 표현' })
  }

  const out: Finding[] = []
  for (const r of rules) {
    for (const m of text.matchAll(r.re)) {
      if (!m[0]) continue
      out.push({ listId: r.listId, severity: r.severity, match: m[0], index: m.index ?? 0, reason: r.reason, suggest: r.suggest })
    }
  }
  // 같은 위치를 여러 규칙이 잡으면 더 심각한 것 하나만
  out.sort((a, b) => a.index - b.index || (a.severity === 'block' ? -1 : 1))
  return out.filter((f, i) => !out.slice(0, i).some((g) => g.index === f.index && g.match === f.match))
}

export function hasBlocking(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'block')
}

export function describeFindings(findings: Finding[]): string {
  return findings
    .map((f) => `- "${f.match}": ${f.reason}${f.suggest ? ` (예: "${f.suggest}")` : ''}`)
    .join('\n')
}
