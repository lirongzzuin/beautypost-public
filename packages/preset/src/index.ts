import { RAW_PRESETS } from './generated/registry.js'
import { Registry, buildRegistry } from './registry.js'

export * from './schema.js'
export * from './registry.js'
export * from './resolve.js'

let _registry: Registry | null = null

/** presets/ 폴더에서 빌드 때 만들어진 기본 레지스트리 (pnpm --filter @beautypost/preset generate). */
export function getRegistry(): Registry {
  if (!_registry) {
    const { data, errors } = buildRegistry(RAW_PRESETS)
    if (!data) throw new Error(`프리셋 레지스트리 오류:\n${errors.join('\n')}`)
    _registry = new Registry(data)
  }
  return _registry
}

export { RAW_PROMPTS } from './generated/registry.js'
