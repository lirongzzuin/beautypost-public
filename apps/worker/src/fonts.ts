import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

// FilmCraft 는 시스템에 설치된 폰트 이름으로 글자를 그린다 → 프리셋 폰트 파일을 사용자 폰트 폴더에 설치.
// 이미 있으면 건드리지 않는다. (macOS: ~/Library/Fonts, 리눅스: ~/.local/share/fonts)

export function userFontDir(): string {
  return platform() === 'darwin' ? join(homedir(), 'Library/Fonts') : join(homedir(), '.local/share/fonts')
}

export function ensureFonts(fontsDir: string, target = userFontDir()): string[] {
  if (!existsSync(fontsDir)) throw new Error(`폰트 폴더가 없어요: ${fontsDir}`)
  mkdirSync(target, { recursive: true })
  const installed: string[] = []
  for (const f of readdirSync(fontsDir)) {
    if (!/\.(otf|ttf)$/i.test(f)) continue
    const dest = join(target, f)
    if (!existsSync(dest)) {
      copyFileSync(join(fontsDir, f), dest)
      installed.push(f)
    }
  }
  return installed
}
