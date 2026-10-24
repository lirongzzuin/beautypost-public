import { Hono } from 'hono'
import { RAW_ASSETS, getRegistry } from '@beautypost/preset'

// 프리셋 목록 (원장님 화면의 선택지). 파일만 추가하면 여기에 바로 나타난다.
const presets = new Hono()

presets.get('/', (c) => {
  const reg = getRegistry()
  return c.json({
    data: {
      moods: reg.data.moods.map((m) => {
        const pv = reg.preview(m.id)
        return {
          id: m.id, label: m.label, palette: m.palette, copyTone: m.copy.tone,
          video: { durationSec: m.video.durationSec, transition: m.video.transition, music: m.video.music },
          thumb: pv.thumb ? `/api/presets/assets/${pv.thumb}` : null,
          sample: null,
        }
      }),
      purposes: reg.data.purposes.map((p) => ({
        id: p.id, label: p.label, description: p.description, requiredMedia: p.requiredMedia, photoLayout: p.photo.layout,
        legacyThemes: p.legacyThemes, slots: p.video.slots.map((s) => ({ role: s.role, source: s.source, mediaRole: s.mediaRole ?? null, optional: s.optional })),
      })),
      industries: reg.data.industries.map((i) => ({ id: i.id, label: i.label, serviceKeys: i.serviceKeys })),
      formats: reg.data.formats.map((f) => ({ id: f.id, label: f.label, kind: f.kind, width: f.width, height: f.height, durationSec: f.durationSec ?? null })),
    },
  })
})

presets.get('/assets/*', (c) => {
  const path = c.req.path.replace(/^.*\/presets\/assets\//, '')
  const b64 = RAW_ASSETS[path]
  if (!b64) return c.json({ code: 'NOT_FOUND', message_ko: '찾을 수 없어요.' }, 404)
  return c.body(new Uint8Array(Buffer.from(b64, 'base64')), 200, {
    'Content-Type': path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
  })
})

export default presets
