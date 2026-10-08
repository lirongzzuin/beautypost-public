import type { ButtonHTMLAttributes, CSSProperties } from 'react'

type Variant = 'primary' | 'outline' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}

const base: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 600,
  borderRadius: 12,
  border: 'none',
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
  fontFamily: 'inherit',
}

const variants: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--color-primary)', color: 'white' },
  outline: { background: 'transparent', border: '1.5px solid var(--color-primary)', color: 'var(--color-primary)' },
  ghost: { background: 'transparent', color: 'var(--color-primary)' },
}

const sizes: Record<Size, CSSProperties> = {
  sm: { padding: '8px 16px', fontSize: 13 },
  md: { padding: '13px 24px', fontSize: 15 },
  lg: { padding: '15px 32px', fontSize: 16 },
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  ...props
}: ButtonProps) {
  const computedStyle: CSSProperties = {
    ...base,
    ...variants[variant],
    ...sizes[size],
    ...(fullWidth ? { width: '100%' } : {}),
    opacity: (disabled ?? loading) ? 0.5 : 1,
    ...style,
  }

  return (
    <button
      {...props}
      disabled={disabled ?? loading}
      style={computedStyle}
    >
      {loading ? '처리 중...' : children}
    </button>
  )
}
