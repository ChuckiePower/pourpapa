import { buildIcs } from './ics'
import { dayRelative, fmtFromTo, fmtMin } from './time'

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Lien qui ouvre la réservation pré-remplie : /r/2026-10-20/15h-17h?avec=Manu */
export function bookingLink(day: string, start: number, end: number, withName?: string): string {
  const q = withName ? `?avec=${encodeURIComponent(withName)}` : ''
  return `${location.origin}/r/${day}/${fmtMin(start)}-${fmtMin(end)}${q}`
}

export function parseBookingPath(path: string): { day: string; start: number; end: number } | null {
  const m = /^\/r\/(\d{4}-\d{2}-\d{2})\/(\d{1,2})h(\d{2})?-(\d{1,2})h(\d{2})?\/?$/.exec(path)
  if (!m) return null
  const start = Number(m[2]) * 60 + Number(m[3] ?? 0)
  const end = Number(m[4]) * 60 + Number(m[5] ?? 0)
  if (start % 30 || end % 30 || start >= end || end > 1440) return null
  return { day: m[1], start, end }
}

/** Message WhatsApp ; le lien pré-remplit la plage où une place reste libre. */
export function inviteText(p: {
  patient: string
  day: string
  start: number
  end: number
  free?: { start_min: number; end_min: number }
  today: string
  name: string
}): string {
  const link = bookingLink(p.day, p.free?.start_min ?? p.start, p.free?.end_min ?? p.end, p.name)
  return `Je vais voir ${p.patient} ${dayRelative(p.day, p.today)} ${fmtFromTo(p.start, p.end)}, il reste une place si tu veux venir avec moi 🤍\n${link}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Ajoute la visite à l'agenda : fonction serveur (iPhone) ou fichier local. */
export function addToCalendar(e: { id: string; day: string; start: number; end: number; title: string; guidelines: string }) {
  const useServer = !import.meta.env.DEV && navigator.onLine
  if (useServer) {
    const q = new URLSearchParams({
      d: e.day, s: String(e.start), e: String(e.end), t: e.title, g: e.guidelines.slice(0, 600), u: e.id,
    })
    window.location.href = `/api/ics?${q}`
    return
  }
  const ics = buildIcs({ uid: e.id, day: e.day, start: e.start, end: e.end, title: e.title, description: e.guidelines })
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'visite.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
