import { useState } from 'react'
import { api } from '~/api/client'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) {
      setError('올바른 이메일 주소를 입력해주세요.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/auth/magic-link', { email })
      setSent(true)
    } catch {
      setError('이메일 발송에 실패했어요. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.icon}>📬</div>
          <h2 className={styles.title}>이메일을 확인해주세요</h2>
          <p className={styles.desc}>
            <strong>{email}</strong>로 로그인 링크를 보냈어요.<br />
            링크는 15분 후 만료돼요.
          </p>
          <button className={styles.linkBtn} onClick={() => setSent(false)}>
            다른 이메일로 시도하기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoMark}>B</div>
          <h1 className={styles.logoText}>뷰티포스트</h1>
        </div>
        <p className={styles.tagline}>뷰티 원장님을 위한<br />SNS 자동화 서비스</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label} htmlFor="email">이메일</label>
          <input
            id="email"
            type="email"
            className={styles.input}
            placeholder="example@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? '전송 중...' : '로그인 링크 받기'}
          </button>
        </form>

        <p className={styles.hint}>
          가입 없이 이메일만으로 로그인할 수 있어요 ✨
        </p>
      </div>
    </div>
  )
}
