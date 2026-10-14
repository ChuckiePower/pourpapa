import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { book, createDb, KEY_A, KEY_B, KEY_C, m, type Db } from './helpers'

const DAY = '2026-10-20'
let db: Db

beforeAll(async () => {
  db = await createDb('concurrency')
})
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  await db.reset()
})

function bookArgs(name: string, key: string, from = '15h', to = '16h') {
  return {
    p_day: DAY, p_start: m(from), p_end: m(to), p_people: 1, p_name: name,
    p_companion: null, p_note: null, p_owner_key: key, p_hp: null,
  }
}

describe('réservations simultanées', () => {
  it('deux réservations en même temps sur la dernière place : une seule passe', async () => {
    expect((await book(db, DAY, '14h', '17h', { name: 'Manu' })).ok).toBe(true)

    // Deux transactions ouvertes en parallèle.
    const c1 = await db.pool.connect()
    const c2 = await db.pool.connect()
    try {
      await c1.query('begin')
      await c2.query('begin')
      // T1 réserve et garde sa transaction ouverte (verrou du jour détenu).
      const r1 = await db.rpc('book_visit', bookArgs('Léa', KEY_B), { client: c1 })
      expect(r1.ok).toBe(true)
      // T2 tente la même place : elle attend le verrou…
      let settled = false
      const p2 = db.rpc('book_visit', bookArgs('Paul', KEY_C), { client: c2 }).finally(() => {
        settled = true
      })
      await new Promise((r) => setTimeout(r, 300))
      expect(settled).toBe(false)
      // … puis voit la réservation de T1 une fois celle-ci validée.
      await c1.query('commit')
      const r2 = await p2
      await c2.query('commit')
      expect(r2.ok).toBe(false)
      expect(r2.reason).toBe('full')
    } finally {
      c1.release()
      c2.release()
    }
    const rows = await db.sql<{ name: string }>('select name from public.visits order by name')
    expect(rows.map((r) => r.name)).toEqual(['Léa', 'Manu'])
  })

  it('12 personnes tentent la même demi-heure en même temps : exactement 2 passent', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => db.rpc('book_visit', bookArgs(`P${i}`, KEY_A, '17h', '18h'))),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(results.filter((r) => r.reason === 'full')).toHaveLength(10)
  })

  it('modifications simultanées vers le même créneau : la capacité tient', async () => {
    await book(db, DAY, '18h', '19h', { name: 'Fixe', key: KEY_C })
    const a = await book(db, DAY, '14h', '15h', { name: 'A', key: KEY_A })
    const b = await book(db, DAY, '15h', '16h', { name: 'B', key: KEY_B })
    const move = (id: string, key: string) =>
      db.rpc('update_visit', {
        p_id: id, p_owner_key: key, p_day: DAY, p_start: m('18h'), p_end: m('19h'),
        p_people: 1, p_name: 'X', p_companion: null,
      })
    const [ra, rb] = await Promise.all([move(a.visit.id, KEY_A), move(b.visit.id, KEY_B)])
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1)
  })
})

describe('garanties de la base', () => {
  it('le trigger refuse toute écriture directe qui dépasse la capacité', async () => {
    await book(db, DAY, '14h', '16h', { people: 2, companion: 'L' })
    await expect(
      db.sql(`insert into public.visits (day, start_min, end_min, people, name) values ($1, 900, 930, 1, 'Intrus')`, [DAY]),
    ).rejects.toThrow(/capacité dépassée/)
  })

  it('le rôle anonyme ne peut que lire', async () => {
    await book(db, DAY, '14h', '16h', { note: 'Coucou' })
    const c = await db.pool.connect()
    const asAnon = async (q: string) => {
      await c.query('begin')
      await c.query('set local role anon')
      try {
        return await c.query(q)
      } finally {
        await c.query('rollback')
      }
    }
    try {
      expect((await asAnon('select name, day from public.visits')).rows).toHaveLength(1)
      expect((await asAnon('select body from public.notes')).rows).toHaveLength(1)
      await expect(asAnon(`insert into public.visits (day, start_min, end_min, name) values ('${DAY}', 1080, 1110, 'X')`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`update public.visits set name = 'X'`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`delete from public.visits`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`delete from public.notes`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`update public.settings set capacity = 6`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`insert into public.blocks (day, start_min, end_min) values ('${DAY}', 840, 900)`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`select * from private.visit_owners`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`select * from private.admin`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`select private.set_admin_pin('0000')`)).rejects.toThrow(/permission denied/)
      await expect(asAnon(`select private.purge_old()`)).rejects.toThrow(/permission denied/)
    } finally {
      c.release()
    }
  })
})

describe('petits mots', () => {
  it('survivent à l’annulation, et seul leur auteur peut les supprimer', async () => {
    const a = await book(db, DAY, '14h', '15h', { name: 'Léa', note: '  Pense fort à toi 🤍  ', key: KEY_A })
    expect(a.note_id).toBeTruthy()
    await db.rpc('cancel_visit', { p_id: a.visit.id, p_owner_key: KEY_A })
    const notes = await db.sql<{ body: string; author: string; visit_id: string | null }>('select body, author, visit_id from public.notes')
    expect(notes).toEqual([{ body: 'Pense fort à toi 🤍', author: 'Léa', visit_id: null }])

    expect((await db.rpc('delete_note', { p_id: a.note_id, p_owner_key: KEY_B })).reason).toBe('forbidden')
    expect((await db.rpc('delete_note', { p_id: a.note_id, p_owner_key: KEY_A })).ok).toBe(true)
    expect(await db.sql('select * from public.notes')).toHaveLength(0)
  })
})

describe('admin', () => {
  async function login(pin = '482913') {
    return db.rpc('admin_login', { p_pin: pin })
  }

  it('sans code défini, la connexion est impossible', async () => {
    await db.sql(`update private.admin set pin_hash = null`)
    expect((await login()).reason).toBe('no_pin')
  })

  it('code PIN, session et limite d’essais', async () => {
    await db.sql(`select private.set_admin_pin('482913')`)
    expect((await login('000000')).reason).toBe('wrong_pin')
    const ok = await login()
    expect(ok.ok).toBe(true)
    expect((await db.rpc('admin_check', { p_token: ok.token })).ok).toBe(true)
    expect((await db.rpc('admin_check', { p_token: 'x'.repeat(64) })).ok).toBe(false)

    for (let i = 0; i < 4; i++) await login('111111')
    // 5 échecs : même le bon code est refusé pendant 15 minutes
    expect((await login()).reason).toBe('rate_limited')
  })

  it('bloquer une période signale les visites déjà prévues et empêche de réserver', async () => {
    await db.sql(`select private.set_admin_pin('482913')`)
    const { token } = await login()
    await book(db, DAY, '14h', '15h', { name: 'Manu' })
    await book(db, DAY, '16h', '17h', { name: 'Léa' })
    const r = await db.rpc('admin_block', {
      p_token: token, p_day: DAY, p_start: m('14h30'), p_end: m('16h30'), p_reason: 'Examens',
    })
    expect(r.ok).toBe(true)
    expect(r.affected.map((v: { name: string }) => v.name)).toEqual(['Manu', 'Léa'])

    const refused = await book(db, DAY, '15h', '16h')
    expect(refused.reason).toBe('blocked')
    expect(refused.message).toBe('Examens')
    expect(refused.alternatives).toEqual([{ start_min: m('14h'), end_min: m('14h30') }, { start_min: m('16h30'), end_min: m('20h') }])

    await db.rpc('admin_unblock', { p_token: token, p_id: r.block_id })
    expect((await book(db, DAY, '15h', '16h')).ok).toBe(true)
  })

  it('l’admin peut tout modifier sauf la capacité', async () => {
    await db.sql(`select private.set_admin_pin('482913')`)
    const { token } = await login()
    const a = await book(db, DAY, '14h', '16h', { name: 'Manu', note: 'Coucou' })
    await book(db, DAY, '15h', '16h', { name: 'Léa', key: KEY_B })
    const save = (args: Record<string, unknown>) =>
      db.rpc('admin_save_visit', {
        p_token: token, p_id: a.visit.id, p_day: DAY, p_start: m('14h'), p_end: m('16h'),
        p_people: 1, p_name: 'Manu', p_companion: null, ...args,
      })
    expect((await save({ p_people: 2, p_companion: 'Paul' })).reason).toBe('full')
    expect((await save({ p_end: m('15h'), p_people: 2, p_companion: 'Paul' })).ok).toBe(true)
    // création pour quelqu’un sans téléphone
    const created = await save({ p_id: null, p_start: m('17h'), p_end: m('18h'), p_name: 'Mamie' })
    expect(created.ok).toBe(true)
    expect((await db.rpc('admin_delete_visit', { p_token: token, p_id: created.visit.id })).ok).toBe(true)
    expect((await db.rpc('admin_delete_note', { p_token: token, p_id: a.note_id })).ok).toBe(true)
    // un jeton invalide ne peut rien faire
    expect((await db.rpc('admin_delete_visit', { p_token: 'nope', p_id: a.visit.id })).reason).toBe('unauthorized')
  })

  it('réglages, annonce et consignes', async () => {
    await db.sql(`select private.set_admin_pin('482913')`)
    const { token } = await login()
    const r = await db.rpc('admin_update_settings', {
      p_token: token,
      p_patch: { announcement: 'Papa est fatigué, privilégiez demain', max_duration_min: 120, capacity: 2 },
    })
    expect(r.ok).toBe(true)
    const p = await db.rpc('get_planning', {})
    expect(p.settings.announcement).toBe('Papa est fatigué, privilégiez demain')
    expect(p.settings.max_duration_min).toBe(120)
    expect((await db.rpc('admin_update_settings', { p_token: token, p_patch: { max_duration_min: '' } })).ok).toBe(true)
    expect((await db.rpc('get_planning', {})).settings.max_duration_min).toBeNull()
    expect((await db.rpc('admin_update_settings', { p_token: token, p_patch: { capacity: 99 } })).reason).toBe('invalid')
    expect((await db.rpc('admin_update_settings', { p_token: token, p_patch: { open_min: 1200 } })).reason).toBe('invalid')
  })
})

describe('purge', () => {
  it('les visites passées depuis plus de 30 jours disparaissent', async () => {
    await db.sql(`insert into public.visits (day, start_min, end_min, name) values ('2026-09-01', 840, 900, 'Vieux'), ('2026-10-01', 840, 900, 'Récent')`)
    await book(db, DAY, '14h', '15h')
    const names = (await db.sql<{ name: string }>('select name from public.visits order by day')).map((r) => r.name)
    expect(names).toEqual(['Récent', 'Test'])
  })
})
