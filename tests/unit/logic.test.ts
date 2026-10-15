import { describe, expect, it } from 'vitest'
import { checkVisit, dayFill, fits, freeRanges, freeRangesByCount, maxEnd, slotStates } from '../../src/lib/capacity'
import { assignColumns, freeSegments, joinRange } from '../../src/lib/layout'
import { addDays, dayLong, dayRelative, fmtDuration, fmtMin, fmtRange, joinNames, parisParts } from '../../src/lib/time'
import { DEFAULT_SETTINGS, type Visit } from '../../src/lib/types'

const DAY = '2026-10-20'
const NOW = { day: '2026-10-19', min: 600 }
const S = { ...DEFAULT_SETTINGS, per_day: null }
const h = (s: string) => {
  const [a, b] = s.split('h')
  return Number(a) * 60 + (b ? Number(b) : 0)
}
let n = 0
const v = (name: string, from: string, to: string, people: 1 | 2 = 1, companion: string | null = null): Visit => ({
  id: `v${++n}-${name}`, day: DAY, start_min: h(from), end_min: h(to), people, name, companion_name: companion,
})

function canBook(visits: Visit[], from: string, to: string, people = 1) {
  const st = slotStates(DAY, visits, [], S, NOW)
  return checkVisit({ day: DAY, start: h(from), end: h(to), people }, st, S, NOW).ok
}

describe('miroir client de la règle de capacité', () => {
  it('reproduit le scénario de l’énoncé', () => {
    const visits: Visit[] = []
    expect(canBook(visits, '14h', '16h')).toBe(true)
    visits.push(v('A', '14h', '16h'))
    expect(canBook(visits, '15h', '17h')).toBe(true)
    visits.push(v('B', '15h', '17h'))
    expect(canBook(visits, '15h30', '16h')).toBe(false)
    expect(canBook(visits, '16h', '17h')).toBe(true)
    visits.push(v('C', '16h', '17h'))
    expect(canBook(visits, '18h', '19h', 2)).toBe(true)
    visits.push(v('D', '18h', '19h', 2, 'D2'))
    expect(canBook(visits, '18h30', '19h')).toBe(false)
    expect(canBook(visits, '19h', '19h30')).toBe(true)
  })

  it('bord à bord et visites à deux', () => {
    const visits = [v('X', '14h', '16h', 2, 'X2')]
    expect(canBook(visits, '16h', '18h', 2)).toBe(true)
    expect(canBook(visits, '15h30', '16h30')).toBe(false)
  })

  it('durée maximale atteignable et plages libres', () => {
    const visits = [v('A', '14h', '16h'), v('B', '15h', '17h')]
    const st = slotStates(DAY, visits, [], S, NOW)
    expect(maxEnd(st, h('14h'), 1, 2)).toBe(h('15h'))
    expect(maxEnd(st, h('16h'), 1, 2)).toBe(h('20h'))
    expect(maxEnd(st, h('16h'), 2, 2)).toBe(h('16h'))
    expect(freeRanges(st, 1, 2)).toEqual([
      { start_min: h('14h'), end_min: h('15h') },
      { start_min: h('16h'), end_min: h('20h') },
    ])
    expect(freeRangesByCount(st, 2)).toEqual([
      { start_min: h('14h'), end_min: h('15h'), free: 1 },
      { start_min: h('16h'), end_min: h('17h'), free: 1 },
      { start_min: h('17h'), end_min: h('20h'), free: 2 },
    ])
  })

  it('heures passées, horizon, blocages', () => {
    const now = { day: DAY, min: h('15h10') }
    const st = slotStates(DAY, [], [{ id: 'b', day: DAY, start_min: h('18h'), end_min: h('20h'), reason: 'Examens' }], S, now)
    expect(checkVisit({ day: DAY, start: h('14h30'), end: h('15h30'), people: 1 }, st, S, now)).toEqual({ ok: false, reason: 'past' })
    expect(checkVisit({ day: DAY, start: h('15h'), end: h('16h'), people: 1 }, st, S, now).ok).toBe(true)
    expect(checkVisit({ day: DAY, start: h('17h'), end: h('18h30'), people: 1 }, st, S, now)).toEqual({ ok: false, reason: 'blocked' })
    expect(checkVisit({ day: addDays(DAY, 14), start: h('15h'), end: h('16h'), people: 1 }, st, S, now)).toEqual({ ok: false, reason: 'too_far' })
    // une visite commencée garde son heure d'arrivée
    expect(fits(st, h('14h'), h('16h'), 1, 2, h('14h'))).toBe(true)
    expect(fits(st, h('14h'), h('16h'), 1, 2)).toBe(false)
  })

  it('remplissage d’une journée', () => {
    expect(dayFill(slotStates(DAY, [], [], S, NOW), 2)).toBe(0)
    expect(dayFill(slotStates(DAY, [v('A', '14h', '20h', 2, 'B')], [], S, NOW), 2)).toBe(1)
    expect(dayFill(slotStates(DAY, [v('A', '14h', '17h')], [], S, NOW), 2)).toBe(0.25)
  })
})

describe('disposition de la timeline', () => {
  it('colonnes et places libres « avec Manu »', () => {
    const a = v('Manu', '14h', '16h')
    const b = v('Léa', '15h', '17h')
    const d = v('Paul', '18h', '19h', 2, 'Jo')
    const visits = [a, b, d]
    const cols = assignColumns(visits, 2)
    expect(cols.get(a.id)).toEqual([0])
    expect(cols.get(b.id)).toEqual([1])
    expect(cols.get(d.id)).toEqual([0, 1])
    const st = slotStates(DAY, visits, [], S, NOW)
    const segs = freeSegments(st, cols, 2).map((s) => ({
      r: fmtRange(s.start_min, s.end_min), cols: s.cols, with: s.alongside.map((x) => x.name),
    }))
    expect(segs).toEqual([
      { r: '14h–15h', cols: [1], with: ['Manu'] },
      { r: '16h–17h', cols: [0], with: ['Léa'] },
      { r: '17h–18h', cols: [0, 1], with: [] },
      { r: '19h–20h', cols: [0, 1], with: [] },
    ])
  })

  it('« Rejoindre » propose la plage libre pendant la visite', () => {
    const manu = v('Manu', '15h', '17h')
    const paul = v('Paul', '15h', '15h30')
    const st = slotStates(DAY, [manu, paul], [], S, NOW)
    expect(joinRange(st, manu, h('15h30'), 2)).toEqual({ start_min: h('15h30'), end_min: h('17h') })
    const st2 = slotStates(DAY, [manu], [], S, { day: DAY, min: h('16h05') })
    expect(joinRange(st2, manu, h('16h'), 2)).toEqual({ start_min: h('16h'), end_min: h('17h') })
  })
})

describe('dates et heures', () => {
  it('formats français', () => {
    expect(fmtMin(900)).toBe('15h')
    expect(fmtMin(930)).toBe('15h30')
    expect(fmtRange(900, 1020)).toBe('15h–17h')
    expect(fmtDuration(30)).toBe('30 min')
    expect(fmtDuration(90)).toBe('1h30')
    expect(dayLong('2026-10-20')).toBe('mardi 20 octobre')
    expect(dayLong('2026-11-01')).toBe('dimanche 1er novembre')
    expect(dayRelative('2026-10-20', '2026-10-20')).toBe("aujourd'hui")
    expect(dayRelative('2026-10-21', '2026-10-20')).toBe('demain')
    expect(dayRelative('2026-10-23', '2026-10-20')).toBe('vendredi')
    expect(joinNames(['Manu', 'Léa', 'Paul'])).toBe('Manu, Léa et Paul')
  })

  it('heure de Paris, y compris au changement d’heure', () => {
    // 25 octobre 2026 : 3h du matin (heure d'été) -> 2h (heure d'hiver)
    expect(parisParts(new Date('2026-10-25T00:30:00Z'))).toEqual({ day: '2026-10-25', min: 150 })
    expect(parisParts(new Date('2026-10-25T01:30:00Z'))).toEqual({ day: '2026-10-25', min: 150 })
    expect(parisParts(new Date('2026-10-25T13:00:00Z'))).toEqual({ day: '2026-10-25', min: 840 })
    expect(parisParts(new Date('2026-10-24T12:00:00Z'))).toEqual({ day: '2026-10-24', min: 840 })
    expect(parisParts(new Date('2026-10-24T22:30:00Z'))).toEqual({ day: '2026-10-25', min: 30 })
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })
})

describe('limite de personnes par jour (miroir client)', () => {
  const S2 = { ...S, per_day: 2 }
  const ok = (visits: Visit[], from: string, to: string, people = 1) =>
    checkVisit({ day: DAY, start: h(from), end: h(to), people }, slotStates(DAY, visits, [], S2, NOW), S2, NOW)

  it('deux personnes sur la journée, à n’importe quelle heure', () => {
    const a = v('A', '14h', '15h')
    expect(ok([a], '18h', '19h').ok).toBe(true)
    expect(ok([a], '18h', '19h', 2)).toEqual({ ok: false, reason: 'day_full' })
    expect(ok([a, v('B', '18h', '19h')], '16h', '17h')).toEqual({ ok: false, reason: 'day_full' })
    expect(ok([v('D', '15h', '16h', 2, 'L')], '18h', '19h')).toEqual({ ok: false, reason: 'day_full' })
  })

  it('places libres, remplissage et timeline tiennent compte de la journée', () => {
    const manu = v('Manu', '14h', '16h')
    const st = slotStates(DAY, [manu], [], S2, NOW)
    expect(freeRangesByCount(st, 2)).toEqual([{ start_min: h('14h'), end_min: h('20h'), free: 1 }])
    expect(freeRanges(st, 2, 2)).toEqual([])
    expect(dayFill(st, 2, 2)).toBe(0.5)
    const segs = freeSegments(st, assignColumns([manu], 2), 2).map((s) => ({
      r: fmtRange(s.start_min, s.end_min), places: s.places, with: s.alongside.map((x) => x.name),
    }))
    expect(segs).toEqual([
      { r: '14h–16h', places: 1, with: ['Manu'] },
      { r: '16h–20h', places: 1, with: [] },
    ])
    const full = slotStates(DAY, [manu, v('Léa', '18h', '19h')], [], S2, NOW)
    expect(freeSegments(full, assignColumns([manu], 2), 2)).toEqual([])
    expect(dayFill(full, 2, 2)).toBe(1)
  })
})
