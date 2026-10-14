import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { book, createDb, KEY_A, KEY_B, m, type Db } from './helpers'

// Mardi 20 octobre 2026 ; « maintenant » = lundi 19 octobre 10h00 (heure de Paris).
const DAY = '2026-10-20'

let db: Db

beforeAll(async () => {
  db = await createDb('capacity')
})
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  await db.reset()
})

async function loads(day = DAY) {
  return db.sql<{ slot: number; load: number }>(
    `select slot, load from private.day_slots($1) order by slot`,
    [day],
  )
}

describe('règle centrale : 2 personnes maximum en même temps', () => {
  it('scénario complet de l’énoncé (A, B, C, D)', async () => {
    // A seul 14h–16h
    const a = await book(db, DAY, '14h', '16h', { name: 'A' })
    expect(a.ok).toBe(true)

    // B seul 15h–17h : accepté (2 personnes de 15h à 16h)
    const b = await book(db, DAY, '15h', '17h', { name: 'B' })
    expect(b.ok).toBe(true)

    // C seul 15h30–16h : refusé (3 personnes à 15h30)
    const c1 = await book(db, DAY, '15h30', '16h', { name: 'C' })
    expect(c1.ok).toBe(false)
    expect(c1.reason).toBe('full')
    expect(c1.slot).toBe(m('15h30'))
    // … avec les plages encore libres pour proposer une alternative
    expect(c1.alternatives).toEqual([
      { start_min: m('14h'), end_min: m('15h') },
      { start_min: m('16h'), end_min: m('20h') },
    ])

    // C seul 16h–17h : accepté (A est parti à 16h, B est seul)
    const c2 = await book(db, DAY, '16h', '17h', { name: 'C' })
    expect(c2.ok).toBe(true)

    // D à deux 18h–19h : accepté…
    const d = await book(db, DAY, '18h', '19h', { name: 'D', people: 2, companion: 'D2' })
    expect(d.ok).toBe(true)
    expect(d.visit.companion_name).toBe('D2')

    // … et plus personne ne peut s’ajouter de 18h à 19h
    for (const [from, to] of [['18h', '18h30'], ['18h30', '19h'], ['17h30', '18h30'], ['18h', '19h'], ['17h', '20h']]) {
      const e = await book(db, DAY, from, to, { name: 'E' })
      expect(e.ok, `${from}–${to} devrait être refusé`).toBe(false)
      expect(e.reason).toBe('full')
    }
    // mais juste avant et juste après, oui
    expect((await book(db, DAY, '17h30', '18h', { name: 'E' })).ok).toBe(true)
    expect((await book(db, DAY, '19h', '19h30', { name: 'F' })).ok).toBe(true)

    const l = Object.fromEntries((await loads()).map((r) => [r.slot, r.load]))
    expect(l[m('14h')]).toBe(1)
    expect(l[m('15h')]).toBe(2)
    expect(l[m('15h30')]).toBe(2)
    expect(l[m('16h')]).toBe(2)
    expect(l[m('17h30')]).toBe(1)
    expect(l[m('18h')]).toBe(2)
    expect(l[m('19h')]).toBe(1)
    expect(l[m('19h30')]).toBe(0)
  })

  it('une visite qui finit à 16h et une qui commence à 16h ne se chevauchent pas', async () => {
    expect((await book(db, DAY, '14h', '16h', { people: 2, companion: 'X2' })).ok).toBe(true)
    expect((await book(db, DAY, '16h', '18h', { people: 2, companion: 'Y2' })).ok).toBe(true)
    expect((await book(db, DAY, '15h30', '16h30', { name: 'Z' })).ok).toBe(false)
  })

  it('une visite à deux occupe les deux places', async () => {
    expect((await book(db, DAY, '14h', '16h', { name: 'A' })).ok).toBe(true)
    const duo = await book(db, DAY, '15h', '16h', { people: 2, companion: 'L' })
    expect(duo.ok).toBe(false)
    expect(duo.reason).toBe('full')
    // les alternatives sont calculées pour deux personnes
    expect(duo.alternatives).toEqual([{ start_min: m('16h'), end_min: m('20h') }])
    expect((await book(db, DAY, '16h', '17h', { people: 2, companion: 'L' })).ok).toBe(true)
  })

  it('on peut venir sur une partie seulement de la visite de quelqu’un', async () => {
    expect((await book(db, DAY, '15h', '17h', { name: 'Manu' })).ok).toBe(true)
    expect((await book(db, DAY, '16h', '17h', { name: 'Léa' })).ok).toBe(true)
    expect((await book(db, DAY, '15h', '15h30', { name: 'Paul' })).ok).toBe(true)
    expect((await book(db, DAY, '15h', '16h', { name: 'Jo' })).ok).toBe(false)
  })

  it('la capacité suit le réglage admin', async () => {
    await db.sql(`update public.settings set capacity = 3`)
    expect((await book(db, DAY, '14h', '16h', { people: 2, companion: 'B' })).ok).toBe(true)
    expect((await book(db, DAY, '15h', '16h')).ok).toBe(true)
    expect((await book(db, DAY, '15h', '16h')).ok).toBe(false)
  })
})

describe('modifier et annuler', () => {
  it('une modification ne se compte pas elle-même', async () => {
    const a = await book(db, DAY, '14h', '16h', { name: 'A', key: KEY_A })
    await book(db, DAY, '15h', '17h', { name: 'B', key: KEY_B })
    // A prolonge jusqu’à 17h : 2 personnes max, accepté
    const up = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: DAY, p_start: m('14h'), p_end: m('17h'),
      p_people: 1, p_name: 'A', p_companion: null,
    })
    expect(up.ok).toBe(true)
    expect(up.visit.end_min).toBe(m('17h'))
    // A passe à deux : refusé de 15h à 17h (B est là)
    const duo = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: DAY, p_start: m('14h'), p_end: m('17h'),
      p_people: 2, p_name: 'A', p_companion: 'A2',
    })
    expect(duo.ok).toBe(false)
    expect(duo.reason).toBe('full')
    expect(duo.alternatives).toEqual([{ start_min: m('14h'), end_min: m('15h') }, { start_min: m('17h'), end_min: m('20h') }])
  })

  it('seul l’appareil qui a réservé peut modifier ou annuler', async () => {
    const a = await book(db, DAY, '14h', '16h', { key: KEY_A })
    const args = { p_id: a.visit.id, p_owner_key: KEY_B, p_day: DAY, p_start: m('14h'), p_end: m('15h'), p_people: 1, p_name: 'X', p_companion: null }
    expect((await db.rpc('update_visit', args)).reason).toBe('forbidden')
    expect((await db.rpc('cancel_visit', { p_id: a.visit.id, p_owner_key: KEY_B })).reason).toBe('forbidden')
    expect((await db.rpc('cancel_visit', { p_id: a.visit.id, p_owner_key: KEY_A })).ok).toBe(true)
    expect(await db.sql('select * from public.visits')).toHaveLength(0)
  })

  it('annuler libère la place', async () => {
    const a = await book(db, DAY, '14h', '16h', { people: 2, companion: 'L' })
    expect((await book(db, DAY, '15h', '16h')).ok).toBe(false)
    await db.rpc('cancel_visit', { p_id: a.visit.id, p_owner_key: KEY_A })
    expect((await book(db, DAY, '15h', '16h')).ok).toBe(true)
  })

  it('changer de jour vérifie la capacité du nouveau jour', async () => {
    const other = '2026-10-21'
    await book(db, other, '14h', '16h', { people: 2, companion: 'X', key: KEY_B })
    const a = await book(db, DAY, '14h', '15h', { key: KEY_A })
    const r = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: other, p_start: m('14h'), p_end: m('15h'),
      p_people: 1, p_name: 'A', p_companion: null,
    })
    expect(r.reason).toBe('full')
    const ok = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: other, p_start: m('16h'), p_end: m('17h'),
      p_people: 1, p_name: 'A', p_companion: null,
    })
    expect(ok.ok).toBe(true)
    expect(ok.visit.day).toBe(other)
  })

  it('my_items retrouve les visites et les mots de l’appareil', async () => {
    const a = await book(db, DAY, '14h', '15h', { key: KEY_A, note: 'Bisous' })
    await book(db, DAY, '15h', '16h', { key: KEY_B })
    const mine = await db.rpc('my_items', { p_keys: ['z'.repeat(43), KEY_A] })
    expect(mine.visits).toEqual([{ id: a.visit.id, key: 1 }])
    expect(mine.notes).toEqual([{ id: a.note_id, key: 1 }])
  })
})

describe('calendrier', () => {
  it('les heures passées ne sont pas réservables, la demi-heure en cours oui', async () => {
    const now = `${DAY} 15:10:00`
    expect((await book(db, DAY, '14h30', '15h30', { now })).reason).toBe('past')
    expect((await book(db, DAY, '15h', '16h', { now })).ok).toBe(true)
    expect((await book(db, '2026-10-19', '15h', '16h', { now })).reason).toBe('past')
  })

  it('une visite commencée peut être prolongée', async () => {
    const a = await book(db, DAY, '14h', '15h30', { now: `${DAY} 13:00:00` })
    db.setNow(`${DAY} 15:10:00`)
    const r = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: DAY, p_start: m('14h'), p_end: m('16h30'),
      p_people: 1, p_name: 'A', p_companion: null,
    })
    expect(r.ok).toBe(true)
    // mais on ne peut pas la déplacer dans le passé
    const r2 = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: DAY, p_start: m('14h30'), p_end: m('16h30'),
      p_people: 1, p_name: 'A', p_companion: null,
    })
    expect(r2.reason).toBe('past')
  })

  it('plage horaire, horizon et durée maximale', async () => {
    expect((await book(db, DAY, '13h30', '14h30')).reason).toBe('outside_hours')
    expect((await book(db, DAY, '19h30', '20h30')).reason).toBe('outside_hours')
    expect((await book(db, DAY, '14h', '14h15' as string)).reason).toBe('invalid')
    // 14 jours visibles : du 19 au 1er novembre inclus
    expect((await book(db, '2026-11-01', '14h', '15h')).ok).toBe(true)
    expect((await book(db, '2026-11-02', '14h', '15h')).reason).toBe('too_far')
    await db.sql(`update public.settings set max_duration_min = 90`)
    expect((await book(db, DAY, '15h', '17h')).reason).toBe('too_long')
    expect((await book(db, DAY, '15h', '16h30')).ok).toBe(true)
  })

  it('changement d’heure (dimanche 25 octobre) : rien ne bouge', async () => {
    const dst = '2026-10-25'
    const r = await book(db, dst, '14h', '16h')
    expect(r.ok).toBe(true)
    expect(r.visit).toMatchObject({ day: dst, start_min: m('14h'), end_min: m('16h') })
    const slots = await loads(dst)
    expect(slots).toHaveLength(12)
    // « maintenant » le 25 à 15h10, heure d’hiver : la tranche de 15h est en cours
    expect((await book(db, dst, '15h', '16h', { now: `${dst} 15:10:00` })).ok).toBe(true)
    expect((await book(db, dst, '14h30', '15h', { now: `${dst} 15:10:00` })).reason).toBe('past')
  })

  it('l’heure de Paris est bien utilisée', async () => {
    const rows = await db.sql<{ d: string }>(
      `select (timestamptz '2026-10-25 00:30:00+00' at time zone 'Europe/Paris')::text as d`,
    )
    expect(rows[0].d).toBe('2026-10-25 02:30:00')
    const rows2 = await db.sql<{ d: string }>(
      `select (timestamptz '2026-10-25 01:30:00+00' at time zone 'Europe/Paris')::text as d`,
    )
    expect(rows2[0].d).toBe('2026-10-25 02:30:00')
  })
})

describe('validation', () => {
  it('prénoms et petit mot', async () => {
    expect((await book(db, DAY, '14h', '15h', { name: '   ' })).reason).toBe('invalid')
    expect((await book(db, DAY, '14h', '15h', { people: 2, companion: ' ' })).reason).toBe('invalid')
    expect((await book(db, DAY, '14h', '15h', { note: 'x'.repeat(141) })).reason).toBe('invalid')
    const ok = await book(db, DAY, '14h', '15h', { name: '  Léa  Martin ', note: '🤍'.repeat(140) })
    expect(ok.ok).toBe(true)
    expect(ok.visit.name).toBe('Léa Martin')
    // seul, le prénom de l’accompagnant est ignoré
    const solo = await book(db, DAY, '15h', '16h', { companion: 'Fantôme' })
    expect(solo.visit.companion_name).toBeNull()
  })

  it('pot de miel : le robot croit avoir réussi, rien n’est enregistré', async () => {
    const r = await book(db, DAY, '14h', '15h', { hp: 'http://spam' })
    expect(r.ok).toBe(true)
    expect(await db.sql('select * from public.visits')).toHaveLength(0)
  })

  it('limite de débit', async () => {
    let refused = 0
    for (let i = 0; i < 65; i++) {
      const day = `2026-10-${String(20 + (i % 10)).padStart(2, '0')}`
      const slot = 840 + 30 * Math.floor(i / 10)
      const r = await db.rpc('book_visit', {
        p_day: day, p_start: slot, p_end: slot + 30, p_people: 1, p_name: 'Bot',
        p_companion: null, p_note: null, p_owner_key: KEY_A, p_hp: null,
      })
      if (r.reason === 'rate_limited') refused++
    }
    expect(refused).toBe(5)
  })
})
