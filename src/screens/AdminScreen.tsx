import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Plus, Send } from 'lucide-react'
import { BookingSheet, type SheetMode } from '../components/BookingSheet'
import { Button, Card, Chip, ErrorNote, Input, Select, Spinner, TextArea, useToast } from '../components/ui'
import * as api from '../lib/api'
import { freeRanges, slotStates } from '../lib/capacity'
import { Link } from '../lib/router'
import { whatsappUrl } from '../lib/share'
import { storage } from '../lib/storage'
import { useData, useNow } from '../lib/store'
import { addDays, capitalize, dayLong, dayRelative, fmtDuration, fmtFromTo, fmtMin, fmtRange, joinNames } from '../lib/time'
import type { Result, Settings, Visit } from '../lib/types'

const TOKEN = 'visites.admin'

export function AdminScreen() {
  const [token, setToken] = useState<string | null>(() => storage.get<string>(TOKEN))

  useEffect(() => {
    if (!token) return
    void api.adminCheck(token).then((r) => {
      if (!r.ok && (r as { reason?: string }).reason !== 'offline') {
        storage.remove(TOKEN)
        setToken(null)
      }
    })
  }, [token])

  const logout = () => {
    if (token) void api.adminLogout(token)
    storage.remove(TOKEN)
    setToken(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[30px] font-medium leading-tight">Admin</h2>
        <Link to="/" className="inline-flex min-h-12 items-center gap-2 rounded-2xl px-3 text-[15px] font-medium text-muted hover:bg-sunken hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Planning
        </Link>
      </div>
      {token ? (
        <AdminPanel
          token={token}
          onToken={(t) => {
            storage.set(TOKEN, t)
            setToken(t)
          }}
          onLogout={logout}
        />
      ) : (
        <PinForm
          onLogin={(t) => {
            storage.set(TOKEN, t)
            setToken(t)
          }}
        />
      )}
    </div>
  )
}

function PinForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          const r = await api.adminLogin(pin)
          setBusy(false)
          if (r.ok) onLogin(r.token)
          else setError(r.message)
        }}
      >
        <Input
          label="Code PIN"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" disabled={busy || pin.length < 4}>
          {busy && <Spinner />} Entrer
        </Button>
      </form>
    </Card>
  )
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-[21px] font-medium">{title}</h3>
        {hint && <p className="mt-1 text-[14px] leading-snug text-muted">{hint}</p>}
      </div>
      {children}
    </Card>
  )
}

function AdminPanel({ token, onToken, onLogout }: { token: string; onToken: (t: string) => void; onLogout: () => void }) {
  const { planning, settings, refresh, online } = useData()
  const toast = useToast()
  const [sheet, setSheet] = useState<SheetMode | null>(null)

  /** Exécute une action admin ; gère la session expirée. */
  async function run<T>(p: Promise<Result<T>>, success?: string): Promise<Result<T>> {
    const r = await p
    if (!r.ok && r.reason === 'unauthorized') {
      toast('Session expirée, reconnecte-toi.')
      onLogout()
    } else if (!r.ok) {
      toast(r.message)
    } else {
      if (success) toast(success)
      void refresh()
    }
    return r
  }

  if (!planning) return <Spinner />

  return (
    <>
      <AnnouncementEditor token={token} run={run} />
      <BlockEditor token={token} run={run} />
      <VisitsAdmin token={token} run={run} onEdit={setSheet} />
      <GuidelinesEditor token={token} run={run} />
      <SettingsEditor token={token} run={run} settings={settings} />
      <NotesAdmin token={token} run={run} />
      <PinEditor token={token} onToken={onToken} run={run} />
      <Button variant="ghost" onClick={onLogout} disabled={!online}>
        Se déconnecter
      </Button>
      <BookingSheet mode={sheet} onClose={() => setSheet(null)} />
    </>
  )
}

type Run = <T>(p: Promise<Result<T>>, success?: string) => Promise<Result<T>>

/* ------------------------------------------------------------------ Annonce */

function AnnouncementEditor({ token, run }: { token: string; run: Run }) {
  const { settings, online } = useData()
  const [text, setText] = useState(settings.announcement)
  useEffect(() => setText(settings.announcement), [settings.announcement])
  return (
    <Section title="Annonce" hint="Affichée en haut de toutes les pages.">
      <TextArea
        value={text}
        max={280}
        onChange={(e) => setText(e.target.value)}
        placeholder="Papa est fatigué, privilégiez demain."
        aria-label="Texte de l'annonce"
        rows={3}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={!online || !settings.announcement}
          onClick={() => {
            setText('')
            void run(api.adminUpdateSettings(token, { announcement: '' }), 'Annonce retirée')
          }}
        >
          Retirer
        </Button>
        <Button
          variant="primary"
          disabled={!online || [...text].length > 280 || text === settings.announcement}
          onClick={() => void run(api.adminUpdateSettings(token, { announcement: text }), 'Annonce publiée')}
        >
          Publier
        </Button>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ Blocages */

const REASONS = ['Examens', 'Pas de visite aujourd’hui', 'Soins', 'Repos']

function BlockEditor({ token, run }: { token: string; run: Run }) {
  const { planning, settings, online } = useData()
  const now = useNow()
  const days = Array.from({ length: settings.days_ahead }, (_, i) => addDays(now.day, i))
  const [day, setDay] = useState(days[0])
  const [start, setStart] = useState(settings.open_min)
  const [end, setEnd] = useState(settings.close_min)
  const [reason, setReason] = useState('')
  const [affected, setAffected] = useState<{ visits: Visit[]; day: string; start: number; end: number; reason: string } | null>(null)
  const slots: number[] = []
  for (let m = settings.open_min; m <= settings.close_min; m += 30) slots.push(m)
  const mid = Math.min(Math.max(17 * 60, settings.open_min + 60), settings.close_min - 30)

  const presets = [
    { label: 'Toute la journée', s: settings.open_min, e: settings.close_min },
    { label: `Jusqu'à ${fmtMin(mid)}`, s: settings.open_min, e: mid },
    { label: `À partir de ${fmtMin(mid)}`, s: mid, e: settings.close_min },
  ]

  const blocks = (planning?.blocks ?? []).filter((b) => b.day >= now.day)
  const visits = planning?.visits ?? []

  const notice = (a: NonNullable<typeof affected>) =>
    `Petit changement : pas de visite ${dayRelative(a.day, now.day)} ${fmtFromTo(a.start, a.end)}${a.reason ? ` (${a.reason})` : ''}. ` +
    `${joinNames(a.visits.map((v) => v.name))}, votre visite est concernée : vous pouvez choisir un autre moment ici 🤍\n${location.origin}/?jour=${a.day}`

  return (
    <Section title="Bloquer une période" hint="Personne ne pourra réserver sur cette période. Les visites déjà prévues sont signalées.">
      <Select label="Jour" value={day} onChange={(e) => setDay(e.target.value)}>
        {days.map((d) => (
          <option key={d} value={d}>{capitalize(dayLong(d))}</option>
        ))}
      </Select>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Chip key={p.label} selected={start === p.s && end === p.e} onClick={() => { setStart(p.s); setEnd(p.e) }}>
            {p.label}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="De" value={start} onChange={(e) => setStart(Number(e.target.value))}>
          {slots.slice(0, -1).map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}
        </Select>
        <Select label="À" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
          {slots.slice(1).map((m) => <option key={m} value={m} disabled={m <= start}>{fmtMin(m)}</option>)}
        </Select>
      </div>
      <div>
        <Input label="Motif (court)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} placeholder="Examens" />
        <div className="mt-2 flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</Chip>
          ))}
        </div>
      </div>
      <Button
        variant="primary"
        disabled={!online || end <= start}
        onClick={async () => {
          const r = await run(api.adminBlock(token, { day, start, end, reason }), 'Période bloquée')
          if (r.ok) setAffected({ visits: r.affected, day, start, end, reason })
        }}
      >
        Bloquer {fmtRange(start, end)}
      </Button>

      {affected && affected.visits.length > 0 && (
        <ErrorNote>
          <p className="font-semibold">À prévenir :</p>
          <ul className="mt-1">
            {affected.visits.map((v) => (
              <li key={v.id}>{v.companion_name ? `${v.name} et ${v.companion_name}` : v.name} · {fmtRange(v.start_min, v.end_min)}</li>
            ))}
          </ul>
          <a
            href={whatsappUrl(notice(affected))}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-12 items-center gap-2 font-medium text-accent-text"
          >
            <Send className="size-4" aria-hidden /> Prévenir sur WhatsApp
          </a>
        </ErrorNote>
      )}

      {blocks.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-t border-line">
          {blocks.map((b) => {
            const hit = visits.filter((v) => v.day === b.day && v.start_min < b.end_min && v.end_min > b.start_min)
            return (
              <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium">
                    {capitalize(dayRelative(b.day, now.day))} · {fmtRange(b.start_min, b.end_min)}
                  </p>
                  <p className="text-[14px] text-muted">
                    {b.reason || 'Sans motif'}
                    {hit.length > 0 && ` · ${hit.length} visite${hit.length > 1 ? 's' : ''} à prévenir (${joinNames(hit.map((v) => v.name))})`}
                  </p>
                </div>
                <Button variant="quiet" className="shrink-0 px-3" disabled={!online} onClick={() => void run(api.adminUnblock(token, b.id), 'Période débloquée')}>
                  Débloquer
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ Visites */

function VisitsAdmin({ token, run, onEdit }: { token: string; run: Run; onEdit: (m: SheetMode) => void }) {
  const { planning, settings, online } = useData()
  const now = useNow()
  const [confirm, setConfirm] = useState<string | null>(null)
  const visits = (planning?.visits ?? []).filter((v) => v.day >= now.day)
  const byDay = useMemo(() => {
    const m = new Map<string, Visit[]>()
    for (const v of [...visits].sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min)) {
      m.set(v.day, [...(m.get(v.day) ?? []), v])
    }
    return m
  }, [visits])

  const firstFree = () => {
    const states = slotStates(now.day, planning?.visits ?? [], [], settings, now)
    return freeRanges(states, 1, settings.capacity)[0]?.start_min ?? settings.open_min
  }

  return (
    <Section title="Toutes les visites" hint="Tu peux aussi ajouter la visite de quelqu'un qui n'a pas de téléphone.">
      <Button icon={<Plus className="size-5" aria-hidden />} disabled={!online} onClick={() => onEdit({ kind: 'admin', token, visit: null, day: now.day, start: firstFree() })}>
        Ajouter une visite
      </Button>
      {byDay.size === 0 && <p className="text-[15px] text-muted">Aucune visite à venir.</p>}
      {[...byDay.entries()].map(([d, list]) => (
        <div key={d}>
          <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{capitalize(dayLong(d))}</p>
          <ul className="flex flex-col divide-y divide-line">
            {list.map((v) => (
              <li key={v.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 text-[15px]">
                    <span className="tabular text-muted">{fmtRange(v.start_min, v.end_min)}</span>{' '}
                    <span className="font-medium">{v.companion_name ? `${v.name} et ${v.companion_name}` : v.name}</span>
                  </p>
                  <div className="flex shrink-0">
                    <Button variant="ghost" className="px-3" disabled={!online} onClick={() => onEdit({ kind: 'admin', token, visit: v, day: v.day, start: v.start_min })}>
                      Modifier
                    </Button>
                    <Button variant="quiet" className="px-3" disabled={!online} onClick={() => setConfirm(confirm === v.id ? null : v.id)}>
                      Supprimer
                    </Button>
                  </div>
                </div>
                {confirm === v.id && (
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl bg-sunken p-2">
                    <Button onClick={() => setConfirm(null)}>Garder</Button>
                    <Button variant="danger" onClick={() => { setConfirm(null); void run(api.adminDeleteVisit(token, v.id), 'Visite supprimée') }}>
                      Oui, supprimer
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  )
}

/* ------------------------------------------------------------------ Consignes */

function GuidelinesEditor({ token, run }: { token: string; run: Run }) {
  const { settings, online } = useData()
  const [text, setText] = useState(settings.guidelines)
  useEffect(() => setText(settings.guidelines), [settings.guidelines])
  return (
    <Section title="Consignes de visite" hint="Une consigne par ligne. Affichées à la réservation, à la confirmation et sur « Aujourd'hui ».">
      <TextArea value={text} max={1000} rows={5} onChange={(e) => setText(e.target.value)} aria-label="Consignes" />
      <Button
        variant="primary"
        disabled={!online || text === settings.guidelines || [...text].length > 1000}
        onClick={() => void run(api.adminUpdateSettings(token, { guidelines: text }), 'Consignes enregistrées')}
      >
        Enregistrer
      </Button>
    </Section>
  )
}

/* ------------------------------------------------------------------ Réglages */

function SettingsEditor({ token, run, settings }: { token: string; run: Run; settings: Settings }) {
  const { online } = useData()
  const [s, setS] = useState(settings)
  useEffect(() => setS(settings), [settings])
  const hours: number[] = []
  for (let m = 6 * 60; m <= 23 * 60; m += 30) hours.push(m)
  const changed = (['app_name', 'patient_label', 'open_min', 'close_min', 'capacity', 'max_duration_min', 'days_ahead'] as const).some(
    (k) => s[k] !== settings[k],
  )
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }))

  return (
    <Section title="Réglages">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Début" value={s.open_min} onChange={(e) => set('open_min', Number(e.target.value))}>
          {hours.map((m) => <option key={m} value={m}>{fmtMin(m)}</option>)}
        </Select>
        <Select label="Fin" value={s.close_min} onChange={(e) => set('close_min', Number(e.target.value))}>
          {hours.map((m) => <option key={m} value={m} disabled={m <= s.open_min}>{fmtMin(m)}</option>)}
        </Select>
        <Select label="Personnes max" value={s.capacity} onChange={(e) => set('capacity', Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Select
          label="Durée max"
          value={s.max_duration_min ?? ''}
          onChange={(e) => set('max_duration_min', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Aucune</option>
          {[60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{fmtDuration(m)}</option>)}
        </Select>
        <Select label="Jours visibles" value={s.days_ahead} onChange={(e) => set('days_ahead', Number(e.target.value))}>
          {[7, 10, 14, 21, 30].map((n) => <option key={n} value={n}>{n} jours</option>)}
        </Select>
      </div>
      <Input label="Nom de l'app" value={s.app_name} maxLength={40} onChange={(e) => set('app_name', e.target.value)} />
      <Input label="On rend visite à" value={s.patient_label} maxLength={30} onChange={(e) => set('patient_label', e.target.value)} placeholder="papa" />
      <Button
        variant="primary"
        disabled={!online || !changed || s.close_min <= s.open_min || !s.app_name.trim() || !s.patient_label.trim()}
        onClick={() =>
          void run(
            api.adminUpdateSettings(token, {
              app_name: s.app_name,
              patient_label: s.patient_label,
              open_min: s.open_min,
              close_min: s.close_min,
              capacity: s.capacity,
              max_duration_min: s.max_duration_min,
              days_ahead: s.days_ahead,
            }),
            'Réglages enregistrés',
          )
        }
      >
        Enregistrer les réglages
      </Button>
    </Section>
  )
}

/* ------------------------------------------------------------------ Petits mots */

function NotesAdmin({ token, run }: { token: string; run: Run }) {
  const { planning, online, removeNote } = useData()
  const notes = planning?.notes ?? []
  if (!notes.length) return null
  return (
    <Section title="Petits mots">
      <ul className="flex flex-col divide-y divide-line">
        {notes.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-3 py-3">
            <p className="min-w-0 text-[15px] leading-snug">
              <span className="whitespace-pre-line">{n.body}</span>
              <span className="text-muted"> — {n.author}</span>
            </p>
            <Button
              variant="quiet"
              className="shrink-0 px-3"
              disabled={!online}
              onClick={async () => {
                const r = await run(api.adminDeleteNote(token, n.id), 'Mot supprimé')
                if (r.ok) removeNote(n.id)
              }}
            >
              Supprimer
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/* ------------------------------------------------------------------ PIN */

function PinEditor({ token, onToken, run }: { token: string; onToken: (t: string) => void; run: Run }) {
  const { online } = useData()
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  return (
    <Section title="Code PIN">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Nouveau code" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} />
        <Input label="Encore une fois" type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      <Button
        disabled={!online || pin.length < 4 || pin !== again}
        onClick={async () => {
          const r = await run(api.adminSetPin(token, pin), 'Code changé')
          if (r.ok) {
            onToken(r.token)
            setPin('')
            setAgain('')
          }
        }}
      >
        Changer le code
      </Button>
    </Section>
  )
}


