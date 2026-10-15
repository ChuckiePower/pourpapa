/**
 * Tout est en heure locale de Paris : un jour = "AAAA-MM-JJ",
 * une heure = minutes depuis minuit. Aucun calcul en UTC « brut ».
 */

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** Écart entre l'horloge du serveur et celle du téléphone (ms). */
let clockOffset = 0

export function setClockOffset(ms: number) {
  // On ignore les écarts minimes (latence réseau).
  const next = Math.abs(ms) > 60_000 ? ms : 0
  if (next !== clockOffset) {
    clockOffset = next
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('visites:clock'))
  }
}

const parisFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function parisParts(date: Date): { day: string; min: number } {
  const parts = Object.fromEntries(parisFmt.formatToParts(date).map((p) => [p.type, p.value]))
  const hour = Number(parts.hour) % 24
  return { day: `${parts.year}-${parts.month}-${parts.day}`, min: hour * 60 + Number(parts.minute) }
}

export function parisNow(): { day: string; min: number } {
  return parisParts(new Date(Date.now() + clockOffset))
}

function toUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

export function addDays(day: string, n: number): string {
  const d = toUtcDate(day)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtcDate(a).getTime() - toUtcDate(b).getTime()) / 86_400_000)
}

export function weekday(day: string): number {
  return toUtcDate(day).getUTCDay()
}

/** 900 -> "15h", 930 -> "15h30" */
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

export function fmtRange(start: number, end: number): string {
  return `${fmtMin(start)}–${fmtMin(end)}`
}

/** "de 15h à 17h" */
export function fmtFromTo(start: number, end: number): string {
  return `de ${fmtMin(start)} à ${fmtMin(end)}`
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** "mardi 15 octobre" */
export function dayLong(day: string): string {
  const d = toUtcDate(day)
  const num = d.getUTCDate()
  return `${DAYS[d.getUTCDay()]} ${num === 1 ? '1er' : num} ${MONTHS[d.getUTCMonth()]}`
}

/** "mardi" */
export function dayName(day: string): string {
  return DAYS[weekday(day)]
}

export function dayShort(day: string): { dow: string; num: number } {
  const d = toUtcDate(day)
  return { dow: DAYS_SHORT[d.getUTCDay()], num: d.getUTCDate() }
}

/** "aujourd'hui", "demain", "mardi" (dans la semaine), "mardi 27 octobre" */
export function dayRelative(day: string, today: string): string {
  const diff = diffDays(day, today)
  if (diff === 0) return "aujourd'hui"
  if (diff === 1) return 'demain'
  if (diff === -1) return 'hier'
  if (diff > 1 && diff < 7) return dayName(day)
  return dayLong(day)
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Liste française : "Manu", "Manu et Léa", "Manu, Léa et Paul" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
}
