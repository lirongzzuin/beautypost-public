import type { ReactElement } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import styles from './BottomNav.module.css'

interface NavItem {
  to: '/' | '/calendar' | '/posts/create' | '/customers' | '/settings'
  icon: ({ size }: { size: number }) => ReactElement
  label: string
  isPrimary?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: HomeIcon, label: '홈' },
  { to: '/calendar', icon: CalendarIcon, label: '캘린더' },
  { to: '/posts/create', icon: PlusIcon, label: '만들기', isPrimary: true },
  { to: '/customers', icon: PeopleIcon, label: '고객' },
  { to: '/settings', icon: MoreIcon, label: '더보기' },
]

export function BottomNav() {
  const { location } = useRouterState()
  const pathname = location.pathname

  return (
    <nav className={styles.nav} role="navigation" aria-label="메인 메뉴">
      {NAV_ITEMS.map((item) => {
        const isActive = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`${styles.item} ${item.isPrimary ? styles.primary : ''} ${isActive ? styles.active : ''}`}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <item.icon size={item.isPrimary ? 28 : 24} />
            {!item.isPrimary && <span className={styles.label}>{item.label}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

// ─── Icons (inline SVG for zero dependency) ──────────────────────────────────

function HomeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  )
}

function CalendarIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" />
    </svg>
  )
}

function PlusIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  )
}

function PeopleIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  )
}

function MoreIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  )
}
