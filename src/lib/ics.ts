/** Fichier agenda (.ics) en heure de Paris, avec un rappel une heure avant. */

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

function fold(line: string): string {
  const chars = [...line]
  if (chars.length <= 70) return line
  const out: string[] = []
  for (let i = 0; i < chars.length; i += 70) out.push((i ? ' ' : '') + chars.slice(i, i + 70).join(''))
  return out.join('\r\n')
}

function local(day: string, min: number): string {
  const hh = String(Math.floor(min / 60)).padStart(2, '0')
  const mm = String(min % 60).padStart(2, '0')
  return `${day.replace(/-/g, '')}T${hh}${mm}00`
}

export type IcsInput = {
  uid: string
  day: string
  start: number
  end: number
  title: string
  description?: string
  url?: string
}

export function buildIcs(e: IcsInput): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Visites//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${esc(e.uid)}@visites`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Paris:${local(e.day, e.start)}`,
    `DTEND;TZID=Europe/Paris:${local(e.day, e.end)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...(e.url ? [`URL:${esc(e.url)}`] : []),
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(e.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function validIcsInput(q: Record<string, string | undefined>): IcsInput | null {
  const day = q.d ?? ''
  const start = Number(q.s)
  const end = Number(q.e)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end) return null
  const title = (q.t ?? 'Visite').slice(0, 120)
  const description = q.g ? q.g.slice(0, 1000) : undefined
  const uid = (q.u ?? `${day}-${start}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'visite'
  return { uid, day, start, end, title, description }
}
