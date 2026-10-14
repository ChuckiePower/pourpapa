import { describe, expect, it } from 'vitest'
import handler, { buildIcs, validIcsInput } from '../../api/ics'
import { parseBookingPath } from '../../src/lib/share'

describe('lien de réservation partagé', () => {
  it('se lit correctement', () => {
    expect(parseBookingPath('/r/2026-10-20/15h-17h')).toEqual({ day: '2026-10-20', start: 900, end: 1020 })
    expect(parseBookingPath('/r/2026-10-20/15h30-16h')).toEqual({ day: '2026-10-20', start: 930, end: 960 })
    expect(parseBookingPath('/r/2026-10-20/15h15-16h')).toBeNull()
    expect(parseBookingPath('/r/2026-10-20/17h-15h')).toBeNull()
    expect(parseBookingPath('/mots')).toBeNull()
  })
})

describe('fichier agenda', () => {
  it('heure locale de Paris avec fuseau, rappel et texte échappé', () => {
    const ics = buildIcs({ uid: 'abc', day: '2026-10-25', start: 900, end: 1020, title: 'Visite à papa', description: 'Masque, blouse; mains\nAccueil' })
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261025T150000')
    expect(ics).toContain('DTEND;TZID=Europe/Paris:20261025T170000')
    expect(ics).toContain('TZID:Europe/Paris')
    expect(ics).toContain('TRIGGER:-PT1H')
    expect(ics).toContain('DESCRIPTION:Masque\\, blouse\; mains\\nAccueil')
    expect(ics.split('\r\n').every((l) => [...l].length <= 75)).toBe(true)
  })

  it('refuse des paramètres invalides', () => {
    expect(validIcsInput({ d: '2026-10-25', s: '900', e: '800' })).toBeNull()
    expect(validIcsInput({ d: 'hier', s: '900', e: '960' })).toBeNull()
    expect(validIcsInput({ d: '2026-10-25', s: '900', e: '960', u: '<script>' })?.uid).toBe('script')
  })

  it('la fonction Vercel répond en text/calendar', () => {
    const headers: Record<string, string> = {}
    let body = ''
    const res = { statusCode: 0, setHeader: (k: string, v: string) => (headers[k] = v), end: (b?: string) => (body = b ?? '') }
    handler({ url: '/api/ics?d=2026-10-20&s=900&e=1020&t=Visite', headers: { 'user-agent': 'iPhone' } }, res)
    expect(res.statusCode).toBe(200)
    expect(headers['Content-Type']).toContain('text/calendar')
    expect(headers['Content-Disposition']).toContain('inline')
    expect(body).toContain('BEGIN:VEVENT')
    handler({ url: '/api/ics?d=x', headers: {} }, res)
    expect(res.statusCode).toBe(400)
  })
})
