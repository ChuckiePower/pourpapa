import { useEffect, useState } from 'react'
import { Link2, Send } from 'lucide-react'
import { BookingSheet, type SheetMode } from '../components/BookingSheet'
import { Button, Card, Eyebrow, useToast } from '../components/ui'
import * as api from '../lib/api'
import { freeRanges, slotStates } from '../lib/capacity'
import { getKeys, modificationLink } from '../lib/owner'
import { Link, navigate, useLocation } from '../lib/router'
import { copyText, inviteText, whatsappUrl } from '../lib/share'
import { useData, useNow } from '../lib/store'
import { capitalize, dayLong, fmtFromTo, fmtRange } from '../lib/time'
import type { Visit } from '../lib/types'

function who(v: Visit) {
  return v.companion_name ? `${v.name} et ${v.companion_name}` : v.name
}

/** « Léa te rejoint de 16h à 17h », « Tu rejoins Manu de 15h à 16h » */
function companionLine(mine: Visit, other: Visit): string {
  const start = Math.max(mine.start_min, other.start_min)
  const end = Math.min(mine.end_min, other.end_min)
  const range = fmtFromTo(start, end)
  if (other.start_min >= mine.start_min) {
    return `${who(other)} ${other.people === 2 ? 'te rejoignent' : 'te rejoint'} ${range}`
  }
  return `Tu rejoins ${who(other)} ${range}`
}

export function MyVisitsScreen() {
  const { planning, settings, mine, online, refreshMine, removeVisit, removeNote, refresh } = useData()
  const now = useNow()
  const toast = useToast()
  const { search } = useLocation()
  const [sheet, setSheet] = useState<SheetMode | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [confirmNote, setConfirmNote] = useState<string | null>(null)
  const keys = getKeys()

  useEffect(() => {
    void refreshMine()
  }, [refreshMine])

  useEffect(() => {
    if (search.get('retrouve')) {
      toast('Tes visites sont maintenant sur ce téléphone.')
      navigate('/mes-visites', { replace: true })
    }
  }, [search, toast])

  const visits = planning?.visits ?? []
  const myVisits = visits
    .filter((v) => v.id in mine.visits && (v.day > now.day || (v.day === now.day && v.end_min > now.min)))
    .sort((a, b) => a.day.localeCompare(b.day) || a.start_min - b.start_min)
  const myNotes = (planning?.notes ?? []).filter((n) => n.id in mine.notes)

  async function cancel(v: Visit) {
    const key = keys[mine.visits[v.id]]
    const res = await api.cancelVisit(v.id, key)
    setConfirmCancel(null)
    if (!res.ok) return toast(res.message)
    removeVisit(v.id)
    toast('Visite annulée')
    void refresh()
  }

  async function deleteNote(id: string) {
    const res = await api.deleteNote(id, keys[mine.notes[id]])
    setConfirmNote(null)
    if (!res.ok) return toast(res.message)
    removeNote(id)
    toast('Petit mot supprimé')
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-[30px] font-medium leading-tight">Mes visites</h2>

      {myVisits.length === 0 ? (
        <Card className="flex flex-col items-start gap-4">
          <p className="text-[17px] leading-relaxed">Aucune visite prévue depuis ce téléphone.</p>
          <Link to="/" className="inline-flex min-h-12 items-center rounded-2xl bg-accent px-5 text-[15px] font-medium text-on-accent shadow-soft">
            Choisir un moment
          </Link>
          <p className="text-[14px] leading-relaxed text-muted">
            Tu as réservé depuis un autre téléphone ? Ouvre ici ton lien de modification.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {myVisits.map((v) => {
            const others = visits.filter(
              (o) => o.id !== v.id && o.day === v.day && o.start_min < v.end_min && o.end_min > v.start_min,
            )
            const states = slotStates(v.day, visits, planning?.blocks ?? [], settings, now)
            const free = freeRanges(states, 1, settings.capacity)
              .map((r) => ({ start_min: Math.max(r.start_min, v.start_min), end_min: Math.min(r.end_min, v.end_min) }))
              .filter((r) => r.start_min < r.end_min)
            const live = v.day === now.day && v.start_min <= now.min
            const key = keys[mine.visits[v.id]]
            return (
              <Card as="li" key={v.id} className="flex flex-col gap-4">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <Eyebrow>{capitalize(dayLong(v.day))}</Eyebrow>
                    {live && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] font-semibold text-accent-text">En cours</span>}
                  </div>
                  <p className="mt-1 font-serif text-[30px] font-medium leading-tight tabular">{fmtRange(v.start_min, v.end_min)}</p>
                  <p className="mt-1 text-[15px] text-muted">
                    {v.people === 2 ? `${v.name}, avec ${v.companion_name}` : `${v.name}, seul·e`}
                  </p>
                </div>

                {(others.length > 0 || (v.people === 1 && free.length > 0)) && (
                  <ul className="flex flex-col gap-1.5 border-t border-line pt-3 text-[15px]">
                    {others.map((o) => (
                      <li key={o.id}>{companionLine(v, o)}</li>
                    ))}
                    {v.people === 1 && free.length > 0 && (
                      <li className="text-sage">
                        Une place reste libre {fmtFromTo(free[0].start_min, free[0].end_min)}
                      </li>
                    )}
                  </ul>
                )}

                {confirmCancel === v.id ? (
                  <div className="flex flex-col gap-2 rounded-2xl bg-sunken p-3">
                    <p className="text-[15px]">Annuler cette visite ?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={() => setConfirmCancel(null)}>Garder</Button>
                      <Button variant="danger" disabled={!online} onClick={() => void cancel(v)}>
                        Oui, annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Button disabled={!online || !key} onClick={() => key && setSheet({ kind: 'edit', visit: v, key })}>
                      Modifier
                    </Button>
                    <Button variant="danger" disabled={!online} onClick={() => setConfirmCancel(v.id)}>
                      Annuler
                    </Button>
                    {v.people === 1 && free.length > 0 && (
                      <a
                        href={whatsappUrl(
                          inviteText({
                            patient: settings.patient_label,
                            day: v.day,
                            start: v.start_min,
                            end: v.end_min,
                            free: free[0],
                            today: now.day,
                            name: v.name,
                          }),
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 py-2 text-center text-[15px] font-medium leading-snug text-accent-text hover:bg-accent-soft"
                      >
                        <Send className="size-4" aria-hidden />
                        Proposer à quelqu'un de venir avec moi
                      </a>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </ul>
      )}

      {myNotes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[22px] font-medium">Mes petits mots</h3>
          <ul className="flex flex-col gap-3">
            {myNotes.map((n) => (
              <Card as="li" key={n.id} className="flex flex-col gap-3">
                <p className="whitespace-pre-line font-serif text-[19px] leading-snug">{n.body}</p>
                {confirmNote === n.id ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => setConfirmNote(null)}>Garder</Button>
                    <Button variant="danger" disabled={!online} onClick={() => void deleteNote(n.id)}>
                      Supprimer
                    </Button>
                  </div>
                ) : (
                  <Button variant="quiet" className="self-start px-3" disabled={!online} onClick={() => setConfirmNote(n.id)}>
                    Supprimer ce mot
                  </Button>
                )}
              </Card>
            ))}
          </ul>
        </section>
      )}

      <Card className="flex flex-col gap-3">
        <h3 className="text-[20px] font-medium">Mon lien de modification</h3>
        <p className="text-[15px] leading-relaxed text-muted">
          Garde-le pour retrouver tes visites sur un autre téléphone, ou si ce navigateur est effacé. Ne le partage
          pas : il permet de les modifier.
        </p>
        <Button
          icon={<Link2 className="size-5" aria-hidden />}
          onClick={async () => toast((await copyText(modificationLink())) ? 'Lien copié' : 'Copie impossible')}
        >
          Copier le lien
        </Button>
        <a
          href={whatsappUrl(`Mon lien pour modifier mes visites (à garder pour moi) :\n${modificationLink()}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-medium text-accent-text hover:bg-accent-soft"
        >
          <Send className="size-4" aria-hidden />
          Me l'envoyer sur WhatsApp
        </a>
      </Card>

      <BookingSheet mode={sheet} onClose={() => setSheet(null)} />
    </div>
  )
}
