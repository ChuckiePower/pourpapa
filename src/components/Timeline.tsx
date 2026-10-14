import { useRef } from 'react'
import { Lock, Pencil } from 'lucide-react'
import { SLOT, type SlotState } from '../lib/capacity'
import { assignColumns, freeSegments, type FreeSegment } from '../lib/layout'
import { fmtMin, fmtRange, joinNames } from '../lib/time'
import type { Block, Settings, Visit } from '../lib/types'
import { cx } from './ui'

/** Hauteur d'une demi-heure, en pixels (cibles tactiles ≥ 48 px). */
const ROW = 52
const GUTTER = 48

type Props = {
  day: string
  states: SlotState[]
  visits: Visit[]
  blocks: Block[]
  settings: Settings
  now: { day: string; min: number }
  mine: Record<string, number>
  disabled?: boolean
  onFree: (start: number) => void
  onJoin: (visit: Visit, from: number) => void
  onEdit: (visit: Visit) => void
}

export function Timeline({ day, states, visits, blocks, settings, now, mine, disabled, onFree, onJoin, onEdit }: Props) {
  const { open_min: open, close_min: close, capacity } = settings
  const y = (min: number) => ((min - open) / SLOT) * ROW
  const height = y(close)
  const dayVisits = visits.filter((v) => v.day === day)
  const dayBlocks = blocks.filter((b) => b.day === day)
  const placement = assignColumns(dayVisits, capacity)
  const segments = freeSegments(states, placement, capacity)
  const isToday = day === now.day
  const pastUntil = isToday ? Math.min(Math.max(now.min, open), close) : open
  const showNow = isToday && now.min >= open && now.min < close

  const hours: number[] = []
  for (let m = Math.ceil(open / 60) * 60; m <= close; m += 60) hours.push(m)
  const halves: number[] = []
  for (let m = open; m <= close; m += SLOT) if (m % 60) halves.push(m)

  const colStyle = (cols: number[]) => {
    const first = Math.min(...cols)
    const span = Math.max(...cols) - first + 1
    return { left: `${(first / capacity) * 100}%`, width: `${(span / capacity) * 100}%` }
  }

  return (
    <div className="relative select-none" style={{ paddingLeft: GUTTER }}>
      {/* En-têtes de colonnes */}
      <div className="mb-2 grid text-center text-[12px] font-medium text-muted" style={{ gridTemplateColumns: `repeat(${capacity}, 1fr)` }} aria-hidden>
        {Array.from({ length: capacity }, (_, c) => (
          <span key={c}>Place {c + 1}</span>
        ))}
      </div>

      <div className="relative" style={{ height }}>
        {/* Heures passées (sous les visites, pour garder les prénoms lisibles) */}
        {pastUntil > open && (
          <div className="pointer-events-none absolute inset-x-0 top-0 rounded-b-xl bg-sunken/80" style={{ height: y(pastUntil) }} aria-hidden />
        )}

        {/* Graduations */}
        {hours.map((m) => (
          <div key={m} className="absolute inset-x-0 border-t border-line" style={{ top: y(m) }} aria-hidden>
            <span className="absolute -translate-y-1/2 bg-bg pr-2 text-[13px] text-muted tabular" style={{ left: -GUTTER, top: 0, width: GUTTER - 4 }}>
              {fmtMin(m)}
            </span>
          </div>
        ))}
        {halves.map((m) => (
          <div key={m} className="absolute inset-x-0 border-t border-dashed border-line/70" style={{ top: y(m) }} aria-hidden />
        ))}

        {/* Périodes bloquées */}
        {dayBlocks.map((b) => {
          const top = y(Math.max(b.start_min, open))
          const h = y(Math.min(b.end_min, close)) - top
          if (h <= 0) return null
          return (
            <div key={b.id} className="absolute inset-x-0 p-[3px]" style={{ top, height: h }}>
              <div className="hatch flex h-full items-start gap-2 rounded-2xl border border-line bg-full px-3 py-2 text-full-ink">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="text-[14px] leading-snug">
                  <span className="font-semibold">Pas de visite</span>
                  {b.reason ? ` · ${b.reason}` : ''}
                  <span className="sr-only"> {fmtRange(b.start_min, b.end_min)}</span>
                </p>
              </div>
            </div>
          )
        })}

        {/* Places libres */}
        {segments.map((s) => (
          <FreeBlock
            key={`${s.start_min}-${s.cols.join()}`}
            seg={s}
            top={y(s.start_min)}
            height={y(s.end_min) - y(s.start_min)}
            style={colStyle(s.cols)}
            capacity={capacity}
            disabled={disabled}
            onFree={onFree}
            onJoin={onJoin}
          />
        ))}

        {/* Visites */}
        {dayVisits.map((v) => {
          const cols = placement.get(v.id) ?? [0]
          const top = y(Math.max(v.start_min, open))
          const h = y(Math.min(v.end_min, close)) - top
          if (h <= 0) return null
          const isMine = v.id in mine
          const ended = isToday && v.end_min <= now.min
          const blocked = dayBlocks.some((b) => b.start_min < v.end_min && b.end_min > v.start_min)
          const names = v.companion_name ? joinNames([v.name, v.companion_name]) : v.name
          const body = (
            <div
              className={cx(
                'flex h-full flex-col overflow-hidden rounded-2xl border px-3 text-left',
                h <= ROW ? 'justify-center py-1' : 'py-2',
                isMine ? 'border-accent-text/35 bg-accent-soft' : 'border-line bg-surface shadow-soft',
              )}
            >
              <p className="truncate text-[15px] font-semibold leading-5">{names}</p>
              <p className="truncate text-[13px] leading-4 text-muted tabular">
                {fmtRange(v.start_min, v.end_min)}
                {v.people === 2 ? ' · à deux' : ''}
              </p>
              {isMine && h > ROW && (
                <p className="mt-auto flex items-center gap-1 text-[12px] font-medium text-accent-text">
                  <Pencil className="size-3" aria-hidden /> Ma visite
                </p>
              )}
              {blocked && h > ROW && <p className="mt-auto text-[12px] font-medium text-accent-text">Période bloquée</p>}
            </div>
          )
          return (
            <div key={v.id} className={cx('absolute p-[3px]', ended && 'opacity-60')} style={{ top, height: h, ...colStyle(cols) }}>
              {isMine && !ended ? (
                <button
                  type="button"
                  className="block h-full w-full"
                  onClick={() => onEdit(v)}
                  aria-label={`Ma visite, ${fmtRange(v.start_min, v.end_min)}. Modifier`}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </div>
          )
        })}

        {/* Maintenant */}
        {showNow && (
          <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: y(now.min) }} aria-hidden>
            <div className="h-[1.5px] bg-accent-text/80" />
            <span className="absolute -top-[3px] -left-[3px] size-2 rounded-full bg-accent-text" />
            <span className="absolute -translate-y-1/2 rounded bg-bg pr-1 text-[12px] font-semibold text-accent-text tabular" style={{ left: -GUTTER, top: 0 }}>
              {fmtMin(now.min)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function FreeBlock({
  seg,
  top,
  height,
  style,
  capacity,
  disabled,
  onFree,
  onJoin,
}: {
  seg: FreeSegment
  top: number
  height: number
  style: { left: string; width: string }
  capacity: number
  disabled?: boolean
  onFree: (start: number) => void
  onJoin: (visit: Visit, from: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const rows = Math.round(height / ROW)
  const join = seg.alongside.length > 0
  const places = join ? seg.cols.length : capacity
  const range = fmtRange(seg.start_min, seg.end_min)
  const withNames = joinNames(seg.alongside.map((v) => (v.companion_name ? `${v.name} et ${v.companion_name}` : v.name)))

  /** Heure tapée dans le bloc : l'arrivée est pré-remplie à cette demi-heure. */
  function slotAt(clientY: number | null): number {
    if (clientY === null || !ref.current) return seg.start_min
    const r = ref.current.getBoundingClientRect()
    const idx = Math.max(0, Math.min(rows - 1, Math.floor((clientY - r.top) / ROW)))
    return seg.start_min + idx * SLOT
  }

  const label = join
    ? `Une place libre avec ${withNames}, ${range}. Rejoindre`
    : `Libre, ${places} place${places > 1 ? 's' : ''}, ${range}. Réserver`

  return (
    <div className="absolute p-[3px]" style={{ top, height, ...style }}>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={(e) => {
          const from = slotAt(e.detail === 0 ? null : e.clientY)
          if (join) onJoin(seg.alongside[0], from)
          else onFree(from)
        }}
        className={cx(
          'group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-dashed border-sage-line bg-sage-soft px-3 text-left text-sage transition-colors duration-150',
          'hover:border-sage disabled:cursor-not-allowed disabled:opacity-60',
          rows <= 1 ? 'justify-center py-1' : 'py-2',
        )}
      >
        {join ? (
          rows <= 1 ? (
            <>
              <span className="truncate text-[14px] font-semibold leading-5">Rejoindre {withNames}</span>
              <span className="truncate text-[12px] leading-4">1 place libre</span>
            </>
          ) : (
            <>
              <span className={cx('text-[14px] font-medium leading-5', rows === 2 ? 'line-clamp-2' : 'line-clamp-3')}>
                Une place libre avec {withNames}
              </span>
              <span className="mt-auto inline-flex w-fit items-center rounded-full bg-surface px-2.5 py-0.5 text-[13px] font-semibold text-accent-text shadow-soft">
                Rejoindre
              </span>
            </>
          )
        ) : (
          <>
            <span className="text-[14px] font-semibold leading-5">Libre</span>
            <span className="text-[12px] leading-4">
              {places} place{places > 1 ? 's' : ''}
              {rows > 1 ? ` · ${range}` : ''}
            </span>
          </>
        )}
      </button>
    </div>
  )
}
