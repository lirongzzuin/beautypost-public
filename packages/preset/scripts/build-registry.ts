// presets/ 폴더 → 검증 → src/generated/registry.ts (함수 번들에 들어가는 모듈) + presets/_schema/*.schema.json
//
//   pnpm --filter @beautypost/preset generate        (build·typecheck 때 자동 실행)
//
// 새 프리셋은 presets/<종류>/ 에 JSON 파일을 추가하면 끝이다. 검증에 실패하면 이 스크립트가 실패해서 배포가 멈춘다.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { KINDS, type Kind } from '../src/schema.js'
import { buildRegistry, type RawEntry, type RawPresets } from '../src/registry.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../../..')
const PRESETS = process.env.PRESETS_DIR ? resolve(process.env.PRESETS_DIR) : join(ROOT, 'presets')
const OUT = join(here, '../src/generated/registry.ts')

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`${relative(ROOT, file)}: JSON 문법 오류 — ${(e as Error).message}`)
  }
}

export function loadRaw(dir: string): { raw: RawPresets; prompts: Record<string, string> } {
  const raw = {} as RawPresets
  for (const kind of Object.keys(KINDS) as Kind[]) {
    raw[kind] = []
    const kdir = join(dir, kind)
    if (!existsSync(kdir)) continue
    for (const name of readdirSync(kdir).sort()) {
      if (name.startsWith('.') || name.startsWith('_')) continue
      const p = join(kdir, name)
      if (kind === 'moods') {
        // 무드는 폴더 단위: moods/<id>/preset.json + 미리보기 파일
        if (!statSync(p).isDirectory()) continue
        const file = join(p, 'preset.json')
        if (!existsSync(file)) throw new Error(`${relative(ROOT, p)}: preset.json 이 없어요`)
        const assets = readdirSync(p).filter((f) => f !== 'preset.json' && !f.startsWith('.'))
        raw[kind].push({ file: relative(ROOT, file), name, data: readJson(file), assets } satisfies RawEntry)
      } else if (name.endsWith('.json')) {
        raw[kind].push({ file: relative(ROOT, p), name: name.slice(0, -5), data: readJson(p) })
      }
    }
  }
  // 프롬프트 템플릿: presets/prompts/<이름>@<버전>.md (caption 패키지가 해석)
  const prompts: Record<string, string> = {}
  const pdir = join(dir, 'prompts')
  if (existsSync(pdir)) {
    for (const name of readdirSync(pdir).sort()) {
      if (name.endsWith('.md')) prompts[name.slice(0, -3)] = readFileSync(join(pdir, name), 'utf8')
    }
  }
  return { raw, prompts }
}

function main(): void {
  const { raw, prompts } = loadRaw(PRESETS)
  const { data, errors, warnings } = buildRegistry(raw)
  // 폰트 파일이 실제로 있는지, 선언한 굵기마다 파일이 있는지
  for (const f of data?.fonts ?? []) {
    for (const style of f.styles) {
      const file = f.files[style]
      if (!file) errors.push(`presets/fonts/${f.id}.json: ${style} 굵기의 files 항목이 없어요`)
      else if (!existsSync(join(PRESETS, 'fonts/files', file))) errors.push(`presets/fonts/${f.id}.json: 폰트 파일 fonts/files/${file} 이 없어요`)
    }
  }
  for (const w of warnings) console.warn(`  ! ${w}`)
  if (!data || errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`)
    console.error(`\n프리셋 검증 실패 (${errors.length}건). presets/ 파일을 고친 뒤 다시 실행하세요.`)
    process.exit(1)
  }

  // 에디터 자동완성용 JSON Schema ("$schema": "../_schema/<kind>.schema.json")
  const schemaDir = join(PRESETS, '_schema')
  mkdirSync(schemaDir, { recursive: true })
  for (const [kind, schema] of Object.entries(KINDS)) {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
    writeFileSync(join(schemaDir, `${kind}.schema.json`), JSON.stringify(json, null, 2) + '\n')
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    `// 자동 생성 파일 — 직접 고치지 말 것. 원본: presets/ (scripts/build-registry.ts)\n` +
      `import type { RawPresets } from '../registry.js'\n\n` +
      `export const RAW_PRESETS: RawPresets = ${JSON.stringify(raw, null, 2)}\n\n` +
      `export const RAW_PROMPTS: Record<string, string> = ${JSON.stringify(prompts, null, 2)}\n`,
  )
  const counts = (Object.keys(KINDS) as Kind[]).map((k) => `${k} ${data[k].length}`).join(' · ')
  console.log(`✓ 프리셋 레지스트리: ${counts} · prompts ${Object.keys(prompts).length}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
