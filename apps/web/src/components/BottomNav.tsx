import type { ReactElement } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import styles from './BottomNav.module.css'

interface IconProps {
  size: number
  active?: boolean
}

interface NavItem {
  to: '/' | '/calendar' | '/posts/create' | '/customers' | '/settings'
  icon: (props: IconProps) => ReactElement
  label: string
  isPrimary?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: HomeIcon, label: '홈' },
  { to: '/calendar', icon: CalendarIcon, label: '캘린더' },
  { to: '/posts/create', icon: SparkleIcon, label: '만들기', isPrimary: true },
  { to: '/customers', icon: PeopleIcon, label: '고객' },
  { to: '/settings', icon: MoreIcon, label: '더보기' },
]

// Full-screen focused flows render their own footer actions — the global tab
// bar would overlap those buttons, so it is hidden on these routes.
const HIDDEN_ON = ['/posts/create']

export function BottomNav() {
  const { location } = useRouterState()
  const pathname = location.pathname

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null
  }

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
            <item.icon size={item.isPrimary ? 26 : 24} active={isActive} />
            {!item.isPrimary && <span className={styles.label}>{item.label}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

// ─── Icons ───────────────────────────────────────────────────────────────────
// Refined stroke-based line icons (rounded caps/joins) to match the soft rose
// aesthetic. Active tabs get a heavier stroke + a faint tinted fill rather than
// the generic solid-glyph look.

const STROKE = 1.75
const STROKE_ACTIVE = 2.1

function base(active?: boolean) {
  return {
    fill: active ? 'currentColor' : 'none',
    fillOpacity: active ? 0.12 : 0,
    stroke: 'currentColor',
    strokeWidth: active ? STROKE_ACTIVE : STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

function HomeIcon({ size, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base(active)}>
      <path d="M3.5 10.2 12 4l8.5 6.2" />
      <path d="M5.5 9.2V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.2" />
      <path d="M9.5 20v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5" fill="none" />
    </svg>
  )
}

function CalendarIcon({ size, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base(active)}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17" fill="none" />
      <path d="M8 3v4M16 3v4" fill="none" />
      <circle cx="8.5" cy="14" r="1.1" fill="currentColor" stroke="none" fillOpacity="1" />
      <circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none" fillOpacity="1" />
    </svg>
  )
}

// "만들기" = AI content creation → a sparkle conveys the magic/AI feel better
// than a bare plus sign.
function SparkleIcon({ size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3c.4 3.4 1.6 4.6 5 5-3.4.4-4.6 1.6-5 5-.4-3.4-1.6-4.6-5-5 3.4-.4 4.6-1.6 5-5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 13.5c.2 1.6.8 2.2 2.5 2.5-1.7.3-2.3.9-2.5 2.5-.2-1.6-.8-2.2-2.5-2.5 1.7-.3 2.3-.9 2.5-2.5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PeopleIcon({ size, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base(active)}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 19.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
    </svg>
  )
}

function MoreIcon({ size, active }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...base(active)}>
      <rect x="4" y="4" width="7" height="7" rx="2.2" />
      <rect x="13" y="4" width="7" height="7" rx="2.2" />
      <rect x="4" y="13" width="7" height="7" rx="2.2" />
      <rect x="13" y="13" width="7" height="7" rx="2.2" />
    </svg>
  )
}
