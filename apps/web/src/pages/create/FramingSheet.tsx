import { useRef, useState, type PointerEvent } from 'react'
import { Sheet, useToast } from '@beautypost/ui'
import { contentApi, type AreaBox } from '~/api/content'
import type { Item } from './types'
import styles from './create.module.css'

// 구도 맞추기: 사진 위에 시술 부위를 상자로 감싼다 (게시용 사진·영상이 이 상자를 중심으로 잘린다).
// 빈 곳을 끌면 새 상자, 상자 안을 끌면 옮기기, 오른쪽 아래 모서리를 끌면 크기 조절.

const DEFAULT_BOX: AreaBox = { x: 0.2, y: 0.4, w: 0.6, h: 0.16 }
const MIN = 0.04

type Drag =
  | { kind: 'draw'; x0: number; y0: number }
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'resize' }

export function initialBox(item: Item): AreaBox {
  const m = item.media
  const ai = (m?.analysis as { areaBox?: AreaBox | null } | null)?.areaBox
  return m?.areaBox ?? ai ?? DEFAULT_BOX
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

interface Props {
  item: Item | null
  industryLabel: string
  onClose: () => void
  onSaved: (item: Item, media: NonNullable<Item['media']>) => void
}

export default function FramingSheet({ item, industryLabel, onClose, onSaved }: Props) {
  const toast = useToast()
  const area = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<AreaBox>(DEFAULT_BOX)
  const [aspect, setAspect] = useState(1)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [saving, setSaving] = useState(false)
  const [forId, setForId] = useState<string | null>(null)
  // 다른 사진을 열면 그 사진의 상자로
  if (item && item.localId !== forId) {
    setForId(item.localId)
    setBox(initialBox(item))
  }

  const point = (e: PointerEvent) => {
    const r = area.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }

  const onDown = (e: PointerEvent) => {
    e.preventDefault()
    area.current!.setPointerCapture(e.pointerId)
    const p = point(e)
    const r = area.current!.getBoundingClientRect()
    const nearCorner = Math.abs(p.x - (box.x + box.w)) * r.width < 28 && Math.abs(p.y - (box.y + box.h)) * r.height < 28
    if (nearCorner) setDrag({ kind: 'resize' })
    else if (p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h) setDrag({ kind: 'move', dx: p.x - box.x, dy: p.y - box.y })
    else {
      setDrag({ kind: 'draw', x0: p.x, y0: p.y })
      setBox({ x: p.x, y: p.y, w: MIN, h: MIN })
    }
  }

  const onMove = (e: PointerEvent) => {
    if (!drag) return
    const p = point(e)
    if (drag.kind === 'move') setBox((b) => ({ ...b, x: clamp(p.x - drag.dx, 0, 1 - b.w), y: clamp(p.y - drag.dy, 0, 1 - b.h) }))
    else if (drag.kind === 'resize') setBox((b) => ({ ...b, w: clamp(p.x - b.x, MIN, 1 - b.x), h: clamp(p.y - b.y, MIN, 1 - b.y) }))
    else {
      const x = Math.min(drag.x0, p.x)
      const y = Math.min(drag.y0, p.y)
      setBox({ x, y, w: Math.max(MIN, Math.abs(p.x - drag.x0)), h: Math.max(MIN, Math.abs(p.y - drag.y0)) })
    }
  }

  async function save(next: AreaBox | null) {
    if (!item?.media) return
    setSaving(true)
    try {
      const media = await contentApi.patchMedia(item.media.id, {
        areaBox: next && { x: clamp(next.x), y: clamp(next.y), w: Math.min(next.w, 1 - next.x), h: Math.min(next.h, 1 - next.y) },
      })
      onSaved(item, media)
      onClose()
    } catch {
      toast.show('구도를 저장하지 못했어요.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasAi = !!(item?.media?.analysis as { areaBox?: AreaBox | null } | null)?.areaBox
  return (
    <Sheet open={!!item} onClose={onClose} title="구도 맞추기">
      {item && (
        <>
          <p className={styles.framingHelp}>
            <strong>{industryLabel}</strong> 시술 부위를 상자로 감싸 주세요{industryLabel.includes('눈썹') ? ' (양쪽 눈썹이 보이면 두 눈썹 모두)' : ''}. 게시용 사진과 영상이 이 부분을 중심으로 잘려요.
          </p>
          <div
            ref={area}
            className={styles.framingArea}
            style={{ aspectRatio: String(aspect), maxWidth: `calc(55dvh * ${aspect})` }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            <img src={item.preview} alt="" draggable={false} onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 1)} />
            <div
              className={styles.framingBox}
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
            >
              <span className={styles.framingHandle} />
            </div>
          </div>
          <div className={styles.consentBtns}>
            <button type="button" disabled={saving} onClick={() => void save(box)}>
              이 구도로 저장
            </button>
            {item.media?.areaBox && (
              <button type="button" disabled={saving} onClick={() => void save(null)}>
                {hasAi ? 'AI 추천 구도로 되돌리기' : '구도 지우기'}
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}
