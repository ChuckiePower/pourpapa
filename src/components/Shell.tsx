import { useEffect, type ReactNode } from 'react'
import { CalendarDays, Clock3, Mail, UserRound, WifiOff } from 'lucide-react'
import { Link, useLocation } from '../lib/router'
import { useData } from '../lib/store'
import { fmtMin, parisParts } from '../lib/time'
import { cx } from './ui'

const TABS = [
  { to: '/', label: 'Planning', icon: CalendarDays },
  { to: '/aujourdhui', label: "Aujourd'hui", icon: Clock3 },
  { to: '/mes-visites', label: 'Mes visites', icon: UserRound },
  { to: '/mots', label: 'Mots', icon: Mail },
] as const

export function Shell({ children }: { children: ReactNode }) {
  const { settings } = useData()
  const { path } = useLocation()

  useEffect(() => {
    document.title = settings.app_name
  }, [settings.app_name])

  const isAdmin = path === '/admin'

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="pt-safe px-5">
        <div className="flex h-16 items-center justify-between gap-3">
          <Link to="/" className="font-serif text-[26px] font-medium leading-none tracking-tight">
            {settings.app_name} <span aria-hidden className="text-[20px]">🤍</span>
          </Link>
          <p className="text-right text-[13px] leading-tight text-muted tabular">
            {fmtMin(settings.open_min)}–{fmtMin(settings.close_min)}
            <br />
            {settings.capacity} {settings.capacity > 1 ? 'personnes' : 'personne'} max
          </p>
        </div>
      </header>

      <OfflineBanner />
      {!isAdmin && <Announcement />}

      <main className="flex-1 px-5 pb-32">{children}</main>

      {!isAdmin && <TabBar path={path} />}
    </div>
  )
}

function OfflineBanner() {
  const { online, lastSync } = useData()
  if (online) return null
  const at = lastSync ? fmtMin(parisParts(new Date(lastSync)).min) : null
  return (
    <div role="status" className="sticky top-0 z-30 mx-5 mb-3 flex items-start gap-3 rounded-2xl bg-ink px-4 py-3 text-bg">
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-[14px] leading-snug">
        <strong className="font-semibold">Hors ligne.</strong>{' '}
        {at ? `Planning chargé à ${at}.` : 'Aucun planning en mémoire.'} Les réservations reviennent avec le réseau.
      </p>
    </div>
  )
}

function Announcement() {
  const { settings } = useData()
  const text = settings.announcement.trim()
  if (!text) return null
  return (
    <div className="mx-5 mb-4 rounded-2xl border border-accent-text/20 bg-accent-soft px-4 py-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-accent-text">Annonce</p>
      <p className="mt-0.5 whitespace-pre-line text-[16px] leading-snug text-ink">{text}</p>
    </div>
  )
}

function TabBar({ path }: { path: string }) {
  const current = TABS.find((t) => t.to !== '/' && path.startsWith(t.to))?.to ?? '/'
  return (
    <nav aria-label="Navigation" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 backdrop-blur">
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active = current === to
          return (
            <li key={to}>
              <Link
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium',
                  active ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                <Icon className={cx('size-[22px]', active && 'text-accent-text')} strokeWidth={active ? 2.1 : 1.8} aria-hidden />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
