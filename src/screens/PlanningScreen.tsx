import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { BookingSheet, type SheetMode } from '../components/BookingSheet'
import { DayStrip, type DayInfo } from '../components/DayStrip'
import { Timeline } from '../components/Timeline'
import { Button, cx } from '../components/ui'
import { dayFill, freeRanges, slotStates } from '../lib/capacity'
import { joinRange } from '../lib/layout'
import { getKeys } from '../lib/owner'
import { navigate, useLocation } from '../lib/router'
import { parseBookingPath } from '../lib/share'
import { useData, useNow } from '../lib/store'
import { addDays, capitalize, dayLong, dayName, diffDays } from '../lib/time'
import type { Visit } from '../lib/types'

export function PlanningScreen() {
  const { planning, settings, status, online, mine, refresh } = useData()
  const now = useNow()
  const { path, search } = useLocation()
  const [sheet, setSheet] = useState<SheetMode | null>(null)
  const [dir, setDir] = useState<'next' | 'prev' | null>(null)

  const visits = planning?.visits ?? []
  const blocks = planning?.blocks ?? []

  // Après la fermeture, on montre demain par défaut.
  const defaultDay = now.min >= settings.close_min ? addDays(now.day, 1) : now.day
  const days = useMemo(
    () => Array.from({ length: settings.days_ahead }, (_, i) => addDays(now.day, i)),
    [now.day, settings.days_ahead],
  )
  const requested = search.get('jour')
  const day = requested && days.includes(requested) ? requested : defaultDay

  // Lien partagé : /r/2026-10-20/15h-17h?avec=Manu
  const deepLink = useRef(parseBookingPath(path))
  useEffect(() => {
    const link = deepLink.current
    if (!link || !planning) return
    deepLink.current = null
    const withName = search.get('avec')
    navigate(`/?jour=${link.day}`, { replace: true })
    if (diffDays(link.day, now.day) < 0) return
    setSheet({ kind: 'book', day: link.day, start: link.start, end: link.end, withName })
  }, [planning]) // eslint-disable-line react-hooks/exhaustive-deps

  const states = useMemo(
    () => slotStates(day, visits, blocks, settings, now),
    [day, visits, blocks, settings, now],
  )

  const dayInfos: DayInfo[] = useMemo(
    () =>
      days.map((d) => ({
        day: d,
        fill: dayFill(slotStates(d, visits, blocks, settings, now), settings.capacity),
        count: visits.filter((v) => v.day === d).length,
      })),
    [days, visits, blocks, settings, now],
  )

  function selectDay(d: string) {
    if (d === day) return
    setDir(d > day ? 'next' : 'prev')
    navigate(`/?jour=${d}`, { replace: true })
  }

  // Glisser à gauche / à droite pour changer de jour.
  const touch = useRef<{ x: number; y: number } | null>(null)
  function onTouchEnd(e: React.TouchEvent) {
    const t = touch.current
    touch.current = null
    if (!t) return
    const dx = e.changedTouches[0].clientX - t.x
    const dy = e.changedTouches[0].clientY - t.y
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return
    const i = days.indexOf(day)
    if (dx < 0 && i < days.length - 1) selectDay(days[i + 1])
    if (dx > 0 && i > 0) selectDay(days[i - 1])
  }

  const dayVisits = visits.filter((v) => v.day === day)
  const free = freeRanges(states, 1, settings.capacity)
  const isToday = day === now.day
  const firstFree = free[0]

  function openBook(start: number) {
    setSheet({ kind: 'book', day, start })
  }

  function openJoin(visit: Visit, from: number) {
    const r = joinRange(states, visit, from, settings.capacity)
    setSheet({ kind: 'book', day, start: r?.start_min ?? from, end: r?.end_min, join: visit })
  }

  function openEdit(visit: Visit) {
    const keyIndex = mine.visits[visit.id]
    const key = getKeys()[keyIndex]
    if (key) setSheet({ kind: 'edit', visit, key })
  }

  if (!planning) {
    return status === 'error' ? (
      <div className="mt-10 flex flex-col items-start gap-4">
        <h2 className="text-[26px] font-medium">Planning indisponible</h2>
        <p className="text-[16px] text-muted">
          {online ? 'Le serveur ne répond pas pour le moment.' : 'Pas de réseau, et aucun planning en mémoire sur ce téléphone.'}
        </p>
        <Button onClick={() => void refresh()}>Réessayer</Button>
      </div>
    ) : (
      <PlanningSkeleton />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <DayStrip days={dayInfos} selected={day} today={now.day} onSelect={selectDay} />

      <div key={day} className={cx(dir === 'next' && 'anim-next', dir === 'prev' && 'anim-prev')} onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }} onTouchEnd={onTouchEnd}>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[26px] font-medium leading-tight">
              {isToday ? "Aujourd'hui" : capitalize(dayLong(day))}
            </h2>
            <DaySummary
              day={day}
              isToday={isToday}
              count={dayVisits.length}
              hasFree={!!firstFree}
              fullyBlocked={states.length > 0 && states.every((s) => s.block)}
              pastAll={states.length > 0 && states.every((s) => s.past)}
            />
          </div>
          {firstFree && (
            <Button
              variant="primary"
              className="shrink-0 px-4"
              icon={<Plus className="size-5" aria-hidden />}
              disabled={!online}
              onClick={() => openBook(firstFree.start_min)}
            >
              Je viens
            </Button>
          )}
        </div>

        <Timeline
          day={day}
          states={states}
          visits={visits}
          blocks={blocks}
          settings={settings}
          now={now}
          mine={mine.visits}
          disabled={!online}
          onFree={openBook}
          onJoin={openJoin}
          onEdit={openEdit}
        />

        <p className="mt-4 text-center text-[13px] text-muted">
          Touchez un espace libre pour venir. Glissez pour changer de jour.
        </p>
      </div>

      <BookingSheet mode={sheet} onClose={() => setSheet(null)} />
    </div>
  )
}

function DaySummary({
  day,
  isToday,
  count,
  hasFree,
  fullyBlocked,
  pastAll,
}: {
  day: string
  isToday: boolean
  count: number
  hasFree: boolean
  fullyBlocked: boolean
  pastAll: boolean
}) {
  if (fullyBlocked) return <p className="mt-1 text-[15px] text-full-ink">Pas de visite ce jour-là.</p>
  if (pastAll) return <p className="mt-1 text-[15px] text-muted">Les visites sont terminées.</p>
  if (count === 0) {
    return (
      <p className="mt-1 text-[15px] font-medium text-sage">
        Personne n'est prévu {isToday ? "aujourd'hui" : dayName(day)}
      </p>
    )
  }
  return (
    <p className="mt-1 text-[15px] text-muted">
      {count} visite{count > 1 ? 's' : ''} prévue{count > 1 ? 's' : ''}
      {hasFree ? ' · encore de la place' : ' · complet'}
    </p>
  )
}

function PlanningSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement du planning" className="flex flex-col gap-5">
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[92px] w-[60px] shrink-0 animate-pulse rounded-2xl bg-sunken" />
        ))}
      </div>
      <div className="h-8 w-48 animate-pulse rounded-xl bg-sunken" />
      <div className="h-[560px] animate-pulse rounded-3xl bg-sunken" />
    </div>
  )
}

