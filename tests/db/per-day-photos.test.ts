import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { book, createDb, KEY_A, KEY_B, m, type Db } from './helpers'

// Mardi 20 octobre 2026 ; « maintenant » = lundi 19 octobre 10h00.
const DAY = '2026-10-20'
let db: Db

beforeAll(async () => {
  db = await createDb('perday')
})
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  await db.reset()
  await db.sql(`update public.settings set per_day = 2`)
})

describe('2 personnes maximum par jour', () => {
  it('deux visites seules à des heures différentes remplissent la journée', async () => {
    expect((await book(db, DAY, '14h', '15h', { name: 'A' })).ok).toBe(true)
    expect((await book(db, DAY, '18h', '19h', { name: 'B' })).ok).toBe(true)
    const c = await book(db, DAY, '16h', '17h', { name: 'C' })
    expect(c.ok).toBe(false)
    expect(c.reason).toBe('day_full')
    expect(c.message).toContain('complet')
    // Jours proches encore libres, pour proposer une alternative
    expect(c.next_days).toEqual(['2026-10-19', '2026-10-21', '2026-10-22', '2026-10-23'])
    expect(c.alternatives).toEqual([])
  })

  it('une visite à deux prend toute la journée', async () => {
    expect((await book(db, DAY, '15h', '16h', { people: 2, companion: 'L' })).ok).toBe(true)
    expect((await book(db, DAY, '18h', '19h')).reason).toBe('day_full')
  })

  it('seul déjà prévu : on ne peut plus venir à deux', async () => {
    expect((await book(db, DAY, '14h', '15h', { name: 'A' })).ok).toBe(true)
    const duo = await book(db, DAY, '17h', '18h', { people: 2, companion: 'L' })
    expect(duo.reason).toBe('day_full')
    expect(duo.message).toContain('une place')
    // mais seul, oui, et même en même temps que A
    expect((await book(db, DAY, '14h', '15h', { name: 'B' })).ok).toBe(true)
  })

  it('modifier l’heure d’une visite sur une journée complète reste possible', async () => {
    const a = await book(db, DAY, '14h', '15h', { name: 'A', key: KEY_A })
    await book(db, DAY, '18h', '19h', { name: 'B', key: KEY_B })
    const up = (people: number, companion: string | null) =>
      db.rpc('update_visit', {
        p_id: a.visit.id, p_owner_key: KEY_A, p_day: DAY, p_start: m('16h'), p_end: m('17h'),
        p_people: people, p_name: 'A', p_companion: companion,
      })
    expect((await up(1, null)).ok).toBe(true)
    expect((await up(2, 'A2')).reason).toBe('day_full')
  })

  it('déplacer une visite vers un jour complet est refusé', async () => {
    await book(db, '2026-10-21', '14h', '15h', { people: 2, companion: 'X', key: KEY_B })
    const a = await book(db, DAY, '14h', '15h', { key: KEY_A })
    const r = await db.rpc('update_visit', {
      p_id: a.visit.id, p_owner_key: KEY_A, p_day: '2026-10-21', p_start: m('16h'), p_end: m('17h'),
      p_people: 1, p_name: 'A', p_companion: null,
    })
    expect(r.reason).toBe('day_full')
  })

  it('les jours proposés évitent les jours complets', async () => {
    await book(db, '2026-10-21', '14h', '15h', { people: 2, companion: 'X' })
    await book(db, DAY, '14h', '15h', { people: 2, companion: 'Y' })
    const r = await book(db, DAY, '16h', '17h')
    expect(r.next_days).toEqual(['2026-10-19', '2026-10-22', '2026-10-23', '2026-10-24'])
  })

  it('10 réservations simultanées sur une journée vide : exactement 2 passent', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.rpc('book_visit', {
          p_day: DAY, p_start: 840 + 30 * i, p_end: 870 + 30 * i, p_people: 1, p_name: `P${i}`,
          p_companion: null, p_note: null, p_owner_key: KEY_A, p_hp: null,
        }),
      ),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(results.filter((r) => r.reason === 'day_full')).toHaveLength(8)
  })

  it('le trigger refuse une 3e personne écrite directement en base', async () => {
    await book(db, DAY, '14h', '15h')
    await book(db, DAY, '18h', '19h')
    await expect(
      db.sql(`insert into public.visits (day, start_min, end_min, people, name) values ($1, 960, 990, 1, 'Intrus')`, [DAY]),
    ).rejects.toThrow(/plus de 2 personnes/)
  })

  it('sans limite par jour, seule la règle « en même temps » s’applique', async () => {
    await db.sql(`update public.settings set per_day = null`)
    await book(db, DAY, '14h', '15h')
    await book(db, DAY, '16h', '17h')
    expect((await book(db, DAY, '18h', '19h')).ok).toBe(true)
  })
})

describe('photos', () => {
  const path = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000.jpg`
  const add = (n: number, opts: { key?: string; caption?: string | null; day?: string | null; author?: string } = {}) =>
    db.rpc('add_photo', {
      p_path: path(n), p_day: opts.day ?? null, p_author: opts.author ?? 'Manu', p_caption: opts.caption ?? null,
      p_width: 1600, p_height: 1200, p_owner_key: opts.key ?? KEY_A,
    })

  it('ajout, légende, jour du jour par défaut, lecture publique', async () => {
    const r = await add(1, { caption: '  Premier sourire 🙂 ' })
    expect(r.ok).toBe(true)
    expect(r.photo).toMatchObject({ day: '2026-10-19', author: 'Manu', caption: 'Premier sourire 🙂', width: 1600 })
    const p = await db.rpc('get_planning', {})
    expect(p.photos).toHaveLength(1)
    expect((await db.rpc('my_items', { p_keys: [KEY_A] })).photos).toEqual([{ id: r.photo.id, key: 0 }])
  })

  it('refuse les noms de fichiers suspects, les dates futures, les doublons', async () => {
    const bad = await db.rpc('add_photo', {
      p_path: '../secret.jpg', p_day: null, p_author: 'X', p_caption: null, p_width: 10, p_height: 10, p_owner_key: KEY_A,
    })
    expect(bad.reason).toBe('invalid')
    expect((await add(2, { day: '2026-10-25' })).reason).toBe('invalid')
    expect((await add(3)).ok).toBe(true)
    expect((await add(3)).reason).toBe('invalid')
  })

  it('le fichier doit exister dans le stockage', async () => {
    await db.sql(`create schema if not exists storage; create table if not exists storage.objects (bucket_id text, name text)`)
    try {
      expect((await add(4)).reason).toBe('invalid')
      await db.sql(`insert into storage.objects values ('photos', $1)`, [path(4)])
      expect((await add(4)).ok).toBe(true)
    } finally {
      await db.sql(`drop schema storage cascade`)
    }
  })

  it('seul l’auteur (ou l’admin) peut supprimer, et récupère le nom du fichier', async () => {
    const r = await add(5, { key: KEY_A })
    expect((await db.rpc('delete_photo', { p_id: r.photo.id, p_owner_key: KEY_B })).reason).toBe('forbidden')
    expect(await db.rpc('delete_photo', { p_id: r.photo.id, p_owner_key: KEY_A })).toEqual({ ok: true, path: path(5) })
    const r2 = await add(6)
    await db.sql(`select private.set_admin_pin('482913')`)
    const { token } = await db.rpc('admin_login', { p_pin: '482913' })
    expect(await db.rpc('admin_delete_photo', { p_token: token, p_id: r2.photo.id })).toEqual({ ok: true, path: path(6) })
  })

  it('le rôle anonyme ne peut pas écrire directement', async () => {
    const c = await db.pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role anon')
      await expect(
        c.query(`insert into public.photos (path, day, author, width, height) values ('${path(7)}', '2026-10-19', 'X', 1, 1)`),
      ).rejects.toThrow(/permission denied/)
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
})
