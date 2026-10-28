import { describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { getRegistry, resolvePreset } from '@beautypost/preset'
import { ensureFonts } from '../src/fonts.js'
import { PermanentError, renderJob } from '../src/pipeline.js'

// filmcraft 대신 가짜 br: 받은 plan/profile 을 남기고 render.json 을 쓴다 (모드에 따라 실패도 흉내)
function fakeFilmcraft(mode: 'ok' | 'plan-error' | 'crash' = 'ok'): string {
  const dir = mkdtempSync(join(tmpdir(), 'fc-'))
  writeFileSync(
    join(dir, 'br'),
    `#!/bin/sh
JOB="$2"
mkdir -p "$JOB/out"
case "${mode}" in
  plan-error) echo "✗ plan 오류: clips[0] 파일 없음"; exit 1;;
  crash) echo "Traceback: boom"; exit 3;;
esac
printf 'video' > "$JOB/out/video.mp4"; printf 'cover' > "$JOB/out/cover.jpg"
cat > "$JOB/render.json" <<EOF
{"video": "$JOB/out/video.mp4", "cover": "$JOB/out/cover.jpg", "width": 1080, "height": 1920, "duration": 18.2,
 "segments": [{"clip_index": 0, "start": 0, "end": 1.5}, {"clip_index": 3, "start": 15, "end": 18.2}],
 "qa": ["15.2~18.0s 화면이 멈춰 있습니다 (2.8s, 끊겨 보임)", "1.0~3.5s 화면이 멈춰 있습니다 (2.5s, 끊겨 보임)"], "warnings": []}
EOF
`,
  )
  chmodSync(join(dir, 'br'), 0o755)
  return dir
}

async function spec(purpose = 'before-after') {
  const media = mkdtempSync(join(tmpdir(), 'media-'))
  const img = async (name: string) => {
    const f = join(media, name)
    writeFileSync(f, await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#c0a090' } }).jpeg().toBuffer())
    return pathToFileURL(f).href
  }
  const p = resolvePreset(getRegistry(), { purpose, industry: 'nail', format: 'reel', mood: 'lovely-pastel' })
  return {
    specVersion: 1, mood: p.mood, purpose: p.purpose, format: p.format, videoDurationSec: p.videoDurationSec, industryLabel: p.industry.label,
    shop: { name: '네일룸', region: '부산', booking: '카톡 예약' },
    media: [
      { id: 'b', url: await img('b.jpg'), kind: 'image', role: 'before', blurFaces: [] },
      { id: 'a', url: await img('a.jpg'), kind: 'image', role: 'after', blurFaces: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }] },
    ],
    lines: { '0': '오늘의 네일', '4': '네일룸 예약' },
  }
}

describe('renderJob (가짜 filmcraft)', () => {
  it('내려받기 → 얼굴 가림 → 카드 → plan/profile → 결과 경로, 카드 구간의 멈춤 경고는 뺀다', async () => {
    const work = mkdtempSync(join(tmpdir(), 'work-'))
    const stages: string[] = []
    // 이벤트 안내: 글자 카드가 있는 목적 (가짜 render.json 의 3번 장면 = 카드)
    const r = await renderJob(await spec('event-booking'), 'job1', { workDir: work, filmcraftDir: fakeFilmcraft(), engine: 'filmcraft', stage: (s) => void stages.push(s), allowFileUrls: true })
    expect(r.duration).toBe(18.2)
    expect(readFileSync(r.video, 'utf8')).toBe('video')
    expect(r.qa).toEqual(['1.0~3.5s 화면이 멈춰 있습니다 (2.5s, 끊겨 보임)']) // 15~18s 는 글자 카드 → 제외
    expect(stages).toEqual(expect.arrayContaining(['download', 'prepare', 'render']))

    const job = join(work, 'job1')
    const plan = JSON.parse(readFileSync(join(job, 'plan.json'), 'utf8'))
    const profile = JSON.parse(readFileSync(join(job, 'profile.json'), 'utf8'))
    expect(plan.layout).toBe('full')
    expect(plan.clips.at(-1).src).toMatch(/card-cta\.png$/)
    expect(profile.style.fun_font).toBe('Pretendard')
    expect(profile.style.video_transition).toBe('cross_dissolve') // 러블리·파스텔 = crossfade
    const files = readdirSync(join(job, 'media'))
    expect(files).toContain('a-blurred.jpg') // 얼굴 가림을 고른 사진
    expect(files).toContain('card-cta.png')
    const card = await sharp(join(job, 'media', 'card-cta.png')).metadata()
    expect([card.width, card.height]).toEqual([1080, 1920])
  })

  it('입력이 틀리면 재시도하지 않는 오류', async () => {
    await expect(renderJob({ specVersion: 2 }, 'bad', { workDir: tmpdir(), filmcraftDir: fakeFilmcraft(), engine: 'filmcraft' })).rejects.toBeInstanceOf(PermanentError)
  })

  it('filmcraft 의 plan 오류는 재시도 안 함, 그 밖의 실패는 재시도 대상', async () => {
    const w = mkdtempSync(join(tmpdir(), 'work-'))
    await expect(renderJob(await spec(), 'p', { workDir: w, filmcraftDir: fakeFilmcraft('plan-error'), engine: 'filmcraft', allowFileUrls: true })).rejects.toBeInstanceOf(PermanentError)
    const crash = renderJob(await spec(), 'c', { workDir: w, filmcraftDir: fakeFilmcraft('crash'), engine: 'filmcraft', allowFileUrls: true })
    await expect(crash).rejects.toThrow(/filmcraft 실패 \(코드 3\)/)
    await expect(crash).rejects.not.toBeInstanceOf(PermanentError)
    expect(existsSync(join(w, 'c', 'filmcraft.log'))).toBe(true)
  })

  it('육아 채널 자동화가 FilmCraft 를 쓰는 중이면 기다린다 (중단 신호로 멈춤)', async () => {
    const fc = fakeFilmcraft()
    mkdirSync(join(fc, 'data/auto.lock'), { recursive: true })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 200)
    await expect(renderJob(await spec(), 'l', { workDir: mkdtempSync(join(tmpdir(), 'w-')), filmcraftDir: fc, engine: 'filmcraft', signal: ctrl.signal, allowFileUrls: true })).rejects.toThrow(/중단/)
  })

  it('큐 작업은 file:// 미디어를 거부한다 (로컬 파일 읽기 방지)', async () => {
    await expect(renderJob(await spec(), 'f', { workDir: mkdtempSync(join(tmpdir(), 'w-')), filmcraftDir: fakeFilmcraft(), engine: 'filmcraft' })).rejects.toThrow(/허용되지 않는 미디어 주소/)
  })

  it('잠금이 오래 안 풀리면 최대 대기 후 재시도 가능한 실패', async () => {
    const fc = fakeFilmcraft()
    mkdirSync(join(fc, 'data/auto.lock'), { recursive: true })
    const err = await renderJob(await spec(), 'm', { workDir: mkdtempSync(join(tmpdir(), 'w-')), filmcraftDir: fc, engine: 'filmcraft', allowFileUrls: true, lockWaitMs: 50 }).catch((e) => e)
    expect(String(err)).toMatch(/나중에 다시/)
    expect(err).not.toBeInstanceOf(PermanentError)
  }, 15_000)
})

describe('renderJob (기본 엔진)', () => {
  it('ffmpeg 로 바로 mp4·커버를 만든다 (filmcraft 없이, 얼굴 가림 사진 포함)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'work-'))
    const stages: string[] = []
    const r = await renderJob(await spec(), 'n1', { workDir: work, filmcraftDir: '/nonexistent', stage: (s) => void stages.push(s), allowFileUrls: true })
    expect(existsSync(r.video)).toBe(true)
    expect(r.video.endsWith('.mp4')).toBe(true)
    const cover = await sharp(r.cover).metadata()
    expect([cover.width, cover.height]).toEqual([1080, 1920])
    expect(r.duration).toBeGreaterThan(3)
    expect(stages).toEqual(expect.arrayContaining(['download', 'render']))
    expect(readdirSync(join(work, 'n1', 'media'))).toContain('a-blurred.jpg')
  }, 60_000)
})

describe('ensureFonts', () => {
  it('없는 폰트만 설치하고 다시 부르면 아무것도 안 한다', () => {
    const target = mkdtempSync(join(tmpdir(), 'fonts-'))
    const src = join(__dirname, '../../../presets/fonts/files')
    expect(ensureFonts(src, target).length).toBeGreaterThan(3)
    expect(ensureFonts(src, target)).toEqual([])
  })
})
