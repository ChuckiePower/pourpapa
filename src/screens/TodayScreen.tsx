import { ChevronRight } from 'lucide-react'
import { Guidelines } from '../components/Guidelines'
import { Card, Eyebrow, cx } from '../components/ui'
import { freeRangesByCount, slotStates } from '../lib/capacity'
import { Link } from '../lib/router'
import { useData, useNow } from '../lib/store'
import { addDays, capitalize, dayLong, fmtMin, fmtRange, joinNames } from '../lib/time'
import type { Visit } from '../lib/types'

function who(v: Visit) {
  return v.companion_name ? `${v.name} et ${v.companion_name}` : v.name
}

/** La page qu'on ouvre devant l'hôpital : lisible en une seconde. */
export function TodayScreen() {
  const { planning, settings, online } = useData()
  const now = useNow()
  const visits = planning?.visits ?? []
  const blocks = planning?.blocks ?? []
  const after = now.min >= settings.close_min
  const day = after ? addDays(now.day, 1) : now.day

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[30px] font-medium leading-tight">{after ? 'Demain' : "Aujourd'hui"}</h2>
        <p className="mt-1 text-[15px] text-muted tabular">
          {capitalize(dayLong(day))}
          {!after && ` · ${fmtMin(now.min)}`}
        </p>
      </div>

      {after && (
        <p className="rounded-2xl bg-sunken px-4 py-3 text-[16px] text-muted">
          Les visites sont terminées pour aujourd'hui.
        </p>
      )}

      <DayOverview day={day} visits={visits} blocks={blocks} live={!after} online={online} />

      <Guidelines />
    </div>
  )
}

function DayOverview({
  day,
  visits,
  blocks,
  live,
  online,
}: {
  day: string
  visits: Visit[]
  blocks: { id: string; day: string; start_min: number; end_min: number; reason: string }[]
  live: boolean
  online: boolean
}) {
  const { settings } = useData()
  const now = useNow()
  const ref = live ? now : { day: now.day, min: 0 }
  const dayVisits = visits.filter((v) => v.day === day).sort((a, b) => a.start_min - b.start_min)
  const before = !live || now.min < settings.open_min
  const present = live ? dayVisits.filter((v) => v.start_min <= now.min && v.end_min > now.min) : []
  const upcoming = dayVisits.filter((v) => (live ? v.start_min > now.min : true))
  const states = slotStates(day, visits, blocks, settings, ref)
  const free = freeRangesByCount(states, settings.capacity)
  const evening = live && now.min >= 17 * 60
  const dayBlocks = blocks.filter((b) => b.day === day && (!live || b.end_min > now.min))

  return (
    <>
      {live && (
        <Card className="py-6">
          <Eyebrow>En ce moment</Eyebrow>
          {before ? (
            <p className="mt-2 font-serif text-[28px] leading-tight">Les visites commencent à {fmtMin(settings.open_min)}</p>
          ) : present.length ? (
            <>
              <p className="mt-2 font-serif text-[36px] font-medium leading-[1.1]">{joinNames(present.map(who))}</p>
              <p className="mt-2 text-[16px] text-muted">
                {present.map((v) => `${who(v)} jusqu'à ${fmtMin(v.end_min)}`).join(' · ')}
              </p>
            </>
          ) : (
            <p className="mt-2 font-serif text-[30px] leading-tight text-muted">Personne pour l'instant</p>
          )}
        </Card>
      )}

      {dayBlocks.map((b) => (
        <p key={b.id} className="rounded-2xl bg-full px-4 py-3 text-[16px] text-full-ink">
          <strong className="font-semibold">Pas de visite {fmtRange(b.start_min, b.end_min)}</strong>
          {b.reason ? ` · ${b.reason}` : ''}
        </p>
      ))}

      <Card>
        <Eyebrow>{live ? 'Ensuite' : 'Prévu'}</Eyebrow>
        {upcoming.length ? (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {upcoming.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <span className="text-[20px] font-medium leading-snug">{who(v)}</span>
                <span className="shrink-0 text-[18px] text-muted tabular">
                  {live ? `à ${fmtMin(v.start_min)}` : fmtRange(v.start_min, v.end_min)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[17px] text-muted">Personne d'autre de prévu.</p>
        )}
      </Card>

      <Card>
        <Eyebrow>{live ? (evening ? 'Encore libre ce soir' : "Encore libre aujourd'hui") : 'Libre demain'}</Eyebrow>
        {free.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {free.map((r) => (
              <li key={r.start_min}>
                <Link
                  to={`/r/${day}/${fmtMin(r.start_min)}-${fmtMin(Math.min(r.end_min, r.start_min + 60))}`}
                  aria-disabled={!online}
                  className={cx(
                    '-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-2xl px-2 hover:bg-sunken',
                    !online && 'pointer-events-none',
                  )}
                >
                  <span className="text-[20px] font-medium tabular">{fmtRange(r.start_min, r.end_min)}</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-sage-soft px-3 py-1 text-[14px] font-semibold text-sage">
                      {r.free} place{r.free > 1 ? 's' : ''}
                    </span>
                    <ChevronRight className="size-5 text-muted" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[17px] text-muted">Complet.</p>
        )}
      </Card>
    </>
  )
}
