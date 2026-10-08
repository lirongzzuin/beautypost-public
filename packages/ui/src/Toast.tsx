import { useState, useCallback, useRef } from 'react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let globalShow: ((msg: string, type?: Toast['type']) => void) | null = null

export function useToast() {
  const show = useCallback((message: string, type: Toast['type'] = 'success') => {
    globalShow?.(message, type)
  }, [])
  return { show }
}

export function Toast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)

  globalShow = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])

  const bg = { success: '#d6f0e0', error: '#fee2e2', info: '#dbeafe' }
  const color = { success: '#2e7d52', error: '#b91c1c', info: '#1e40af' }

  return (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 999, display: 'flex', flexDirection: 'column', gap: 8, width: 'calc(100% - 32px)', maxWidth: 400 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 600,
          background: bg[t.type], color: color[t.type],
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          animation: 'slideDown 0.2s ease',
        }}>
          {t.message}
        </div>
      ))}
      <style>{`@keyframes slideDown { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </div>
  )
}
