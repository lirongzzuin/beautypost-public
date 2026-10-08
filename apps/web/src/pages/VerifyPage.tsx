import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useAuthStore } from '~/store/auth'
import { PageLoader } from '~/components/PageLoader'

export default function VerifyPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { token?: string }
  const login = useAuthStore((s) => s.login)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = search.token
    if (!token) {
      setError('유효하지 않은 링크예요.')
      return
    }

    fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(async (body: {
        data?: { accessToken: string; refreshToken: string; needsOnboarding: boolean }
        code?: string
        message_ko?: string
      }) => {
        if (!body.data) throw new Error(body.message_ko ?? '오류가 발생했어요.')
        await login(body.data.accessToken, body.data.refreshToken)
        if (body.data.needsOnboarding) {
          navigate({ to: '/onboarding' })
        } else {
          navigate({ to: '/' })
        }
      })
      .catch((err: Error) => setError(err.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>😢</div>
        <h2 style={{ fontWeight: 700, textAlign: 'center' }}>링크가 만료됐어요</h2>
        <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>{error}</p>
        <a href="/auth/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
          새 링크 요청하기
        </a>
      </div>
    )
  }

  return <PageLoader />
}
