import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100svh', gap: 16, padding: 24,
          textAlign: 'center',
        }}>
          <span style={{ fontSize: 48 }}>😵</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
            앗, 오류가 발생했어요
          </h2>
          <p style={{ fontSize: 14, color: '#666', margin: 0 }}>
            {this.state.error?.message ?? '일시적인 문제가 있어요. 페이지를 새로고침해주세요.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px', background: 'var(--color-primary)', color: 'white',
              border: 'none', borderRadius: 12, fontWeight: 600, cursor: 'pointer', fontSize: 15,
            }}
          >
            새로고침
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
