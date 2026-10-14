import { useEffect, useRef } from 'react'
import { dayLong, dayShort } from '../lib/time'
import { cx } from './ui'

export type DayInfo = { day: string; fill: number; count: number }

/** Bande de jours défilante, avec le remplissage de chaque jour. */
export function DayStrip({
  days,
  selected,
  today,
  onSelect,
}: {
  days: DayInfo[]
  selected: string
  today: string
  onSelect: (day: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-day="${selected}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [selected])

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Jours"
      className="no-scrollbar -mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 pt-1"
      onKeyDown={(e) => {
        const i = days.findIndex((d) => d.day === selected)
        if (e.key === 'ArrowRight' && i < days.length - 1) onSelect(days[i + 1].day)
        if (e.key === 'ArrowLeft' && i > 0) onSelect(days[i - 1].day)
      }}
    >
      {days.map(({ day, fill, count }) => {
        const { dow, num } = dayShort(day)
        const active = day === selected
        const empty = count === 0 && fill === 0
        const full = fill >= 0.999
        const state = empty ? 'libre' : full ? 'complet' : null
        return (
          <button
            key={day}
            type="button"
            role="tab"
            data-day={day}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            aria-label={`${dayLong(day)}${day === today ? ", aujourd'hui" : ''}, ${
              empty ? 'personne de prévu' : full ? 'complet' : `${count} visite${count > 1 ? 's' : ''}`
            }`}
            onClick={() => onSelect(day)}
            className={cx(
              'flex w-[60px] shrink-0 snap-center flex-col items-center rounded-2xl border pb-2 pt-2 transition-colors duration-150',
              active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink hover:bg-sunken',
            )}
          >
            <span className={cx('text-[12px] font-medium', active ? 'text-bg/75' : 'text-muted')}>
              {day === today ? 'auj.' : dow}
            </span>
            <span className="font-serif text-[22px] font-medium leading-tight tabular">{num}</span>
            <span aria-hidden className={cx('mt-1 h-[3px] w-7 overflow-hidden rounded-full', active ? 'bg-bg/25' : 'bg-line')}>
              <span
                className={cx('block h-full rounded-full', active ? 'bg-bg' : 'bg-accent-text/80')}
                style={{ width: `${Math.round(fill * 100)}%` }}
              />
            </span>
            <span
              aria-hidden
              className={cx(
                'mt-1 h-4 text-[11px] font-medium leading-4',
                active ? 'text-bg/80' : empty ? 'text-sage' : 'text-muted',
              )}
            >
              {state}
            </span>
          </button>
        )
      })}
    </div>
  )
}
