/**
 * Crée une base locale `visites_dev` avec des données d'exemple
 * (autour du mardi 20 octobre 2026). Code admin : 123456.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

const admin = process.env.TEST_PG_ADMIN_URL ?? 'postgres://dev:dev@127.0.0.1:5432/postgres'
const name = process.env.DEV_DB_NAME ?? 'visites_dev'
const DEV_KEY = 'devkey-manu-0123456789abcdefghijklmnopqrstuv'

// Crée la base si besoin (sans la supprimer : l'API locale peut être connectée).
const c = new pg.Client({ connectionString: admin })
await c.connect()
const exists = await c.query('select 1 from pg_database where datname = $1', [name])
if (!exists.rowCount) await c.query(`create database ${name}`)
for (const role of ['anon', 'authenticated', 'service_role']) {
  await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`)
}
await c.end()

const u = new URL(admin)
u.pathname = `/${name}`
const db = new pg.Client({ connectionString: u.toString() })
await db.connect()
await db.query(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'))
await db.query(`truncate public.visits, public.blocks, public.notes, public.photos, private.rate_events, private.admin_sessions cascade`)
await db.query(`update public.settings set app_name = default, patient_label = default, open_min = default, close_min = default,
  capacity = default, per_day = default, max_duration_min = default, days_ahead = default, guidelines = default`)
// Photos de l'API locale
const photosDir = process.env.DEV_PHOTOS_DIR ?? join(tmpdir(), 'visites-photos')
mkdirSync(photosDir, { recursive: true })
for (const f of readdirSync(photosDir)) rmSync(join(photosDir, f), { force: true })
await db.query(`select private.set_admin_pin('123456')`)
await db.query(`update public.settings set announcement = 'Papa est un peu fatigué en ce moment : privilégiez des visites courtes.'`)

// 2 personnes maximum par jour.
const visits = [
  ['2026-10-20', '14h', '16h', 1, 'Manu', null, true],
  ['2026-10-21', '15h', '16h30', 1, 'Sophie', null],
  ['2026-10-21', '16h', '17h', 1, 'Marc', null],
  ['2026-10-23', '17h30', '19h', 1, 'Claire', null],
  ['2026-10-24', '14h', '15h30', 2, 'Mamie', 'Papi'],
  ['2026-10-25', '15h', '17h', 1, 'Manu', null, true],
  ['2026-10-26', '16h', '18h', 1, 'Léa', null],
]
const toMin = (h) => {
  const [a, b] = h.split('h')
  return Number(a) * 60 + (b ? Number(b) : 0)
}
for (const [day, from, to, people, who, comp, mine] of visits) {
  const r = await db.query(
    `insert into public.visits (day, start_min, end_min, people, name, companion_name) values ($1, $2, $3, $4, $5, $6) returning id`,
    [day, toMin(from), toMin(to), people, who, comp],
  )
  if (mine) {
    await db.query(`insert into private.visit_owners values ($1, private.hash_key($2))`, [r.rows[0].id, DEV_KEY])
  }
}
await db.query(`insert into public.blocks (day, start_min, end_min, reason) values ('2026-10-23', 840, 1020, 'Examens')`)
const notes = [
  ['Léa', 'Courage papa, on pense fort à toi tous les jours ❤️', false],
  ['Sophie', 'Les enfants t’ont fait un dessin, je te l’apporte jeudi.', false],
  ['Manu', 'Le chat va bien. Il dort sur ton pull, évidemment.', true],
]
let t = 0
for (const [author, body, mine] of notes) {
  const r = await db.query(`insert into public.notes (author, body, created_at) values ($1, $2, now() - ($3 || ' hours')::interval) returning id`, [author, body, String(t++ * 5)])
  if (mine) await db.query(`insert into private.note_owners values ($1, private.hash_key($2))`, [r.rows[0].id, DEV_KEY])
}
await db.end()
console.log(`Base ${name} prête. Clé de l'appareil de démo : ${DEV_KEY}`)
