// Email adapter — Resend in production, console.log in dev

interface SendEmailOptions {
  to: string
  subject: string
  html: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    // Dev mode: log to console
    const text = opts.html
      .replace(/<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2 → $1')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    console.log(`\n📧 [DEV EMAIL]\nTo: ${opts.to}\nSubject: ${opts.subject}\n---\n${text}\n---\n`)
    return
  }
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'noreply@beautypost.kr',
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  })
  if (error) {
    console.error('[Resend] send failed:', JSON.stringify(error))
    throw new Error(`Email send failed: ${error.message}`)
  }
  console.log('[Resend] sent:', data?.id, '→', opts.to)
}

export function magicLinkEmail(email: string, link: string): SendEmailOptions {
  return {
    to: email,
    subject: '뷰티포스트 로그인 링크',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #a23553; margin-bottom: 8px;">뷰티포스트</h2>
        <p style="color: #201a1d; font-size: 16px; line-height: 1.6;">
          안녕하세요 원장님 👋<br/>
          아래 버튼을 눌러 로그인해주세요. 링크는 15분 후 만료됩니다.
        </p>
        <a href="${link}"
          style="display:inline-block;margin-top:24px;padding:14px 28px;background:#a23553;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;">
          로그인하기
        </a>
        <p style="color:#897175;font-size:13px;margin-top:24px;">
          이 링크를 요청하지 않으셨다면 무시해주세요.
        </p>
      </div>`,
  }
}

export function trialExpiryEmail(email: string, name: string, daysLeft: number): SendEmailOptions {
  return {
    to: email,
    subject: `뷰티포스트 무료 체험 ${daysLeft}일 남았어요`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#a23553;">뷰티포스트</h2>
        <p>${name} 원장님, 무료 체험 기간이 <strong>${daysLeft}일</strong> 남았어요.</p>
        <a href="${process.env.APP_URL}/billing"
          style="display:inline-block;margin-top:16px;padding:14px 28px;background:#a23553;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;">
          구독 시작하기
        </a>
      </div>`,
  }
}
