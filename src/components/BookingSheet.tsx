import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Link2, Send } from 'lucide-react'
import * as api from '../lib/api'
import { checkVisit, fits, freeRanges, maxEnd, SLOT, slotStates } from '../lib/capacity'
import { getKeys, modificationLink, primaryKey, saveName, savedName } from '../lib/owner'
import { addToCalendar, copyText, inviteText, whatsappUrl } from '../lib/share'
import { useData, useNow } from '../lib/store'
import { addDays, capitalize, dayLong, fmtDuration, fmtMin, fmtRange } from '../lib/time'
import type { Fail, Range, Visit } from '../lib/types'
import { Guidelines } from './Guidelines'
import { Button, charCount, Chip, cx, ErrorNote, Input, Segmented, Select, Sheet, Spinner, TextArea, useToast } from './ui'

export type SheetMode =
  | { kind: 'book'; day: string; start: number; end?: number; join?: Visit | null; withName?: string | null }
  | { kind: 'edit'; visit: Visit; key: string }
  | { kind: 'admin'; token: string; visit: Visit | null; day: string; start: number }

const DURATIONS = [30, 60, 90, 120]

const REASON_TEXT: Record<string, string> = {
  past: 'Cet horaire est déjà passé.',
  too_far: "Ce jour n'est pas encore ouvert aux visites.",
  too_long: 'Cette visite est trop longue.',
  outside_hours: "C'est en dehors des heures de visite.",
  blocked: 'Pas de visite possible à ce moment-là.',
  full: "Il n'y a plus assez de place à ce moment-là.",
  invalid: 'Les horaires ne sont pas valides.',
}

export function BookingSheet({ mode, onClose }: { mode: SheetMode | null; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const key = mode ? modeKey(mode) : null
  const isConfirmed = confirmed !== null && confirmed === key
  return (
    <Sheet
      open={!!mode}
      onClose={() => {
        setConfirmed(null)
        onClose()
      }}
      title={!mode ? '' : isConfirmed ? <span className="sr-only">Confirmation</span> : <Title mode={mode} />}
      subtitle={mode && !isConfirmed ? <Subtitle mode={mode} /> : null}
    >
      {mode && <BookingForm key={key} mode={mode} onClose={() => { setConfirmed(null); onClose() }} onDone={() => setConfirmed(key)} />}
    </Sheet>
  )
}

function modeKey(m: SheetMode) {
  if (m.kind === 'book') return `b-${m.day}-${m.start}-${m.join?.id ?? ''}`
  if (m.kind === 'edit') return `e-${m.visit.id}`
  return `a-${m.visit?.id ?? 'new'}`
}

function Title({ mode }: { mode: SheetMode }) {
  const { settings } = useData()
  if (mode.kind === 'edit') return <>Modifier ma visite</>
  if (mode.kind === 'admin') return <>{mode.visit ? 'Modifier la visite' : 'Ajouter une visite'}</>
  const withName = mode.join?.name ?? mode.withName
  if (withName) return <>Venir avec {withName}</>
  return <>Je viens voir {settings.patient_label}</>
}

function Subtitle({ mode }: { mode: SheetMode }) {
  if (mode.kind === 'book' && mode.join) {
    return (
      <>
        {capitalize(dayLong(mode.day))} · {mode.join.name} vient {fmtRange(mode.join.start_min, mode.join.end_min)}
      </>
    )
  }
  if (mode.kind === 'book') return <>{capitalize(dayLong(mode.day))}</>
  return null
}

type Done = { visit: Visit; edited: boolean }

function BookingForm({ mode, onClose, onDone }: { mode: SheetMode; onClose: () => void; onDone: () => void }) {
  const { planning, settings, online, upsertVisit, refresh } = useData()
  const now = useNow()
  const toast = useToast()
  const admin = mode.kind === 'admin'
  const existing = mode.kind === 'edit' ? mode.visit : mode.kind === 'admin' ? mode.visit : null

  const [day, setDay] = useState(existing?.day ?? (mode.kind === 'book' || mode.kind === 'admin' ? mode.day : now.day))
  const [start, setStart] = useState(existing?.start_min ?? (mode.kind !== 'edit' ? mode.start : settings.open_min))
  const [end, setEnd] = useState(existing?.end_min ?? (mode.kind === 'book' && mode.end ? mode.end : start + 60))
  const [people, setPeople] = useState<1 | 2>(existing?.people ?? 1)
  const [name, setName] = useState(existing?.name ?? (admin ? '' : savedName()))
  const [companion, setCompanion] = useState(existing?.companion_name ?? '')
  const [note, setNote] = useState('')
  const [hp, setHp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Fail | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  const visits = planning?.visits ?? []
  const blocks = admin ? [] : (planning?.blocks ?? [])
  const refNow = admin ? { day: '1970-01-01', min: 0 } : now
  const cap = settings.capacity
  const keepStart = existing && existing.day === day && !admin ? existing.start_min : undefined

  const states = useMemo(
    () => slotStates(day, visits, blocks, settings, refNow, existing?.id),
    [day, visits, blocks, settings, refNow.day, refNow.min, existing?.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const limitEnd = (s: number) =>
    Math.min(settings.close_min, !admin && settings.max_duration_min ? s + settings.max_duration_min : settings.close_min)

  const bestEnd = (s: number, p: number, wantedDuration: number) => {
    const reach = Math.min(maxEnd(states, s, p, cap, keepStart), limitEnd(s))
    if (reach <= s) return s + SLOT
    return Math.min(s + wantedDuration, reach)
  }

  // À l'ouverture : un départ cohérent avec la place disponible.
  useEffect(() => {
    if (existing) return
    if (!fits(states, start, end, people, cap, keepStart) || end > limitEnd(start)) {
      setEnd(bestEnd(start, people, mode.kind === 'book' && mode.end ? mode.end - start : 60))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startOptions = states
    .filter((st) => !st.past || st.slot === keepStart)
    .map((st) => ({ slot: st.slot, ok: fits(states, st.slot, st.slot + SLOT, 1, cap, keepStart) || st.slot === start }))

  const duoPossible = fits(states, start, Math.min(end, start + SLOT), 2, cap, keepStart)
  const endOptions: number[] = []
  for (let e = start + SLOT; e <= limitEnd(start); e += SLOT) endOptions.push(e)

  const check = checkVisit({ day, start, end, people, keepStart }, states, settings, refNow, admin)

  function changeStart(s: number) {
    setStart(s)
    setError(null)
    const p = people === 2 && !fits(states, s, s + SLOT, 2, cap, keepStart) ? 1 : people
    if (p !== people) setPeople(1)
    setEnd(bestEnd(s, p, end - start))
  }

  function changePeople(p: 1 | 2) {
    setPeople(p)
    setError(null)
    if (!fits(states, start, end, p, cap, keepStart)) setEnd(bestEnd(start, p, end - start))
  }

  function applyRange(r: Range) {
    setStart(r.start_min)
    setEnd(Math.min(r.end_min, r.start_min + Math.max(end - start, SLOT), limitEnd(r.start_min)))
    setError(null)
  }

  const noteTooLong = charCount(note) > 140
  const nameOk = name.trim().length > 0
  const companionOk = people === 1 || companion.trim().length > 0
  const canSubmit = online && !busy && check.ok && nameOk && companionOk && !noteTooLong

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const input: api.VisitInput = { day, start, end, people, name: name.trim(), companion: people === 2 ? companion.trim() : null }
    let res
    if (mode.kind === 'book') {
      res = await api.bookVisit({ ...input, note: note.trim() || null, key: primaryKey(), hp })
    } else if (mode.kind === 'edit') {
      res = await api.updateVisit(mode.visit.id, mode.key, input)
    } else {
      res = await api.adminSaveVisit(mode.token, mode.visit?.id ?? null, input)
    }
    setBusy(false)
    if (!res.ok) {
      setError(res)
      void refresh()
      return
    }
    const visit = res.visit
    if (mode.kind !== 'admin') {
      saveName(input.name)
      upsertVisit(visit, mode.kind === 'book' ? { key: 0 } : { key: getKeys().indexOf(mode.key) })
    } else {
      upsertVisit(visit)
    }
    void refresh()
    if (mode.kind === 'admin') {
      toast(mode.visit ? 'Visite modifiée' : 'Visite ajoutée')
      onClose()
      return
    }
    setDone({ visit, edited: mode.kind === 'edit' })
    onDone()
  }

  if (done) return <Confirmation done={done} onClose={onClose} />

  const visibleDays = Array.from({ length: settings.days_ahead }, (_, i) => addDays(now.day, i))
  if (existing && !visibleDays.includes(existing.day)) visibleDays.unshift(existing.day)

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {mode.kind !== 'book' && (
        <Select label="Jour" value={day} onChange={(e) => { setDay(e.target.value); setError(null) }}>
          {visibleDays.map((d) => (
            <option key={d} value={d}>{capitalize(dayLong(d))}</option>
          ))}
        </Select>
      )}

      <Select label="Arrivée" value={start} onChange={(e) => changeStart(Number(e.target.value))}>
        {startOptions.map((o) => (
          <option key={o.slot} value={o.slot} disabled={!o.ok}>
            {fmtMin(o.slot)}{o.ok ? '' : ' · complet'}
          </option>
        ))}
      </Select>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-muted" id="duree">Durée</span>
          <span className="text-[14px] text-muted tabular">
            Départ à <strong className="font-semibold text-ink">{fmtMin(end)}</strong>
          </span>
        </div>
        <div role="group" aria-labelledby="duree" className="grid grid-cols-4 gap-2">
          {DURATIONS.map((d) => {
            const possible = start + d <= limitEnd(start) && fits(states, start, start + d, people, cap, keepStart)
            return (
              <Chip
                key={d}
                selected={end - start === d}
                disabled={!possible}
                aria-label={possible ? fmtDuration(d) : `${fmtDuration(d)}, impossible : pas assez de place`}
                onClick={() => { setEnd(start + d); setError(null) }}
              >
                {fmtDuration(d)}
              </Chip>
            )
          })}
        </div>
        <Select
          className="mt-2"
          aria-label="Heure de départ"
          value={end}
          onChange={(e) => { setEnd(Number(e.target.value)); setError(null) }}
        >
          {endOptions.map((e) => {
            const ok = fits(states, start, e, people, cap, keepStart)
            return (
              <option key={e} value={e} disabled={!ok}>
                Jusqu'à {fmtMin(e)} ({fmtDuration(e - start)}){ok ? '' : ' · complet'}
              </option>
            )
          })}
        </Select>
      </div>

      <div>
        <Segmented<'1' | '2'>
          label="Nombre de personnes"
          value={people === 2 ? '2' : '1'}
          onChange={(v) => changePeople(v === '2' ? 2 : 1)}
          options={[
            { value: '1', label: admin ? 'Seul·e' : 'Je viens seul·e' },
            { value: '2', label: admin ? 'À deux' : 'On vient à deux', disabled: !duoPossible && people !== 2 },
          ]}
        />
        {!duoPossible && people === 1 && (
          <p className="mt-2 text-[14px] text-muted">Une seule place libre à {fmtMin(start)} : impossible de venir à deux.</p>
        )}
      </div>

      <Input
        label={admin ? 'Prénom' : 'Ton prénom'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={30}
        autoComplete="given-name"
        autoCapitalize="words"
        enterKeyHint="next"
        required
      />
      {people === 2 && (
        <Input
          label="Prénom de la 2e personne"
          value={companion}
          onChange={(e) => setCompanion(e.target.value)}
          maxLength={30}
          autoComplete="off"
          autoCapitalize="words"
          required
        />
      )}

      {mode.kind === 'book' && (
        <TextArea
          label={`Un petit mot pour ${settings.patient_label}`}
          max={140}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Facultatif. Il le lira pendant une visite."
          rows={3}
        />
      )}

      {/* Pot de miel : invisible pour les humains. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Site web
          <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
      </div>

      {!check.ok && !error && (
        <p className="text-[14px] text-accent-text" role="status">{REASON_TEXT[check.reason]}</p>
      )}

      {error && (
        <ErrorNote>
          <p>{error.reason === 'full' ? 'Oups, quelqu’un vient de prendre cette place.' : error.message}</p>
          {error.alternatives && error.alternatives.length > 0 && (
            <div className="mt-3">
              <p className="text-[14px] text-muted">Encore libre ce jour-là :</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {error.alternatives.slice(0, 6).map((r) => (
                  <Chip key={r.start_min} onClick={() => applyRange(r)}>
                    {fmtRange(r.start_min, r.end_min)}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </ErrorNote>
      )}

      {mode.kind === 'book' && <Guidelines compact />}

      <div
        className="sticky -mx-5 bg-bg px-5 pt-2"
        style={{ bottom: 'calc(-1 * max(1.25rem, env(safe-area-inset-bottom)))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <Button type="submit" variant="primary" block disabled={!canSubmit} className="min-h-14 text-[17px]">
          {busy ? <Spinner /> : null}
          {!online
            ? 'Hors ligne : réservation impossible'
            : mode.kind === 'book'
              ? 'Je viens'
              : 'Enregistrer'}
        </Button>
        <p className="mt-2 text-center text-[13px] text-muted tabular">
          {capitalize(dayLong(day))} · {fmtRange(start, end)}
          {people === 2 ? ' · à deux' : ''}
        </p>
      </div>
    </form>
  )
}

function Confirmation({ done, onClose }: { done: Done; onClose: () => void }) {
  const { planning, settings } = useData()
  const now = useNow()
  const toast = useToast()
  const v = done.visit

  // Reste-t-il une place pendant ma visite ?
  const states = slotStates(v.day, [...(planning?.visits ?? []).filter((x) => x.id !== v.id), v], planning?.blocks ?? [], settings, now)
  const freeDuring = freeRanges(states, 1, settings.capacity)
    .map((r) => ({ start_min: Math.max(r.start_min, v.start_min), end_min: Math.min(r.end_min, v.end_min) }))
    .filter((r) => r.start_min < r.end_min)
  const canInvite = v.people === 1 && freeDuring.length > 0

  return (
    <div className="anim-rise flex flex-col gap-6 pb-2">
      <div className="pt-2 text-center">
        <p className="font-serif text-[34px] font-medium leading-tight">
          {done.edited ? "C'est modifié" : <>C'est noté <span aria-hidden>❤️</span></>}
        </p>
        <p className="mt-2 text-[18px] tabular">
          {capitalize(dayLong(v.day))} · {fmtRange(v.start_min, v.end_min)}
        </p>
        {v.companion_name && <p className="mt-1 text-[15px] text-muted">avec {v.companion_name}</p>}
      </div>

      <Guidelines />

      <div className="flex flex-col gap-3">
        <Button
          icon={<CalendarPlus className="size-5" aria-hidden />}
          block
          onClick={() =>
            addToCalendar({
              id: v.id,
              day: v.day,
              start: v.start_min,
              end: v.end_min,
              title: `Visite à ${settings.patient_label}`,
              guidelines: settings.guidelines,
            })
          }
        >
          Ajouter à mon agenda
        </Button>
        {canInvite && (
          <a
            href={whatsappUrl(
              inviteText({
                patient: settings.patient_label,
                day: v.day,
                start: v.start_min,
                end: v.end_min,
                free: freeDuring[0],
                today: now.day,
                name: v.name,
              }),
            )}
            target="_blank"
            rel="noopener noreferrer"
            className={cx(
              'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2 text-center text-[15px] font-medium leading-snug shadow-soft hover:bg-sunken',
            )}
          >
            <Send className="size-5" aria-hidden />
            Proposer à quelqu'un de venir avec moi
          </a>
        )}
        <Button
          icon={<Link2 className="size-5" aria-hidden />}
          block
          onClick={async () => {
            const ok = await copyText(modificationLink())
            toast(ok ? 'Lien copié. Garde-le précieusement.' : 'Copie impossible')
          }}
        >
          Copier mon lien de modification
        </Button>
        <p className="-mt-1 px-2 text-center text-[13px] leading-snug text-muted">
          Ce lien permet de retrouver et modifier tes visites depuis un autre téléphone.
        </p>
        <Button variant="primary" block onClick={onClose} className="mt-2">
          Terminé
        </Button>
      </div>
    </div>
  )
}
