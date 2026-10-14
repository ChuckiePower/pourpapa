import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Les tests de base tournent sur un vrai Postgres. Par défaut :
 * postgres://dev:dev@127.0.0.1:5432/postgres (voir README).
 * Une base jetable est créée pour chaque fichier de test.
 */
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://dev:dev@127.0.0.1:5432/postgres'
const SCHEMA = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8')

export const KEY_A = 'a'.repeat(43)
export const KEY_B = 'b'.repeat(43)
export const KEY_C = 'c'.repeat(43)

export type Db = {
  pool: pg.Pool
  /** Appelle une fonction RPC comme le ferait l'API (rôle anon). */
  rpc: <T = any>(fn: string, args?: Record<string, unknown>, opts?: { now?: string; client?: pg.PoolClient }) => Promise<T>
  sql: <T = any>(text: string, params?: unknown[]) => Promise<T[]>
  reset: () => Promise<void>
  close: () => Promise<void>
  now: string
  setNow: (now: string) => void
}

export async function createDb(name: string): Promise<Db> {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  const dbName = `visites_test_${name}_${process.pid}`
  await admin.query(`drop database if exists ${dbName}`)
  await admin.query(`create database ${dbName}`)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.query(
      `do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`,
    )
  }
  await admin.end()

  const url = new URL(ADMIN_URL)
  url.pathname = `/${dbName}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 20 })
  await pool.query(SCHEMA)

  const db: Db = {
    pool,
    now: '2026-10-19 10:00:00',
    setNow(now) {
      db.now = now
    },
    async rpc(fn, args = {}, opts = {}) {
      const client = opts.client ?? (await pool.connect())
      const keys = Object.keys(args)
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
      try {
        if (!opts.client) await client.query('begin')
        await client.query('set local role anon')
        await client.query(`select set_config('visites.now', $1, true)`, [opts.now ?? db.now])
        const res = await client.query(`select public.${fn}(${named}) as r`, keys.map((k) => args[k]))
        if (!opts.client) await client.query('commit')
        return res.rows[0].r
      } catch (e) {
        if (!opts.client) await client.query('rollback')
        throw e
      } finally {
        if (!opts.client) client.release()
      }
    },
    async sql(text, params = []) {
      const res = await pool.query(text, params)
      return res.rows
    },
    async reset() {
      await pool.query(`
        truncate public.visits, public.blocks, public.notes, private.rate_events, private.admin_sessions cascade;
        update public.settings set open_min = 840, close_min = 1200, capacity = 2,
          max_duration_min = null, days_ahead = 14, announcement = '';
      `)
      db.now = '2026-10-19 10:00:00'
    },
    async close() {
      await pool.end()
      const a = new pg.Client({ connectionString: ADMIN_URL })
      await a.connect()
      await a.query(`drop database if exists ${dbName} with (force)`)
      await a.end()
    },
  }
  return db
}

/** "15h30" -> 930 */
export function m(h: string): number {
  const [hh, mm] = h.split('h')
  return Number(hh) * 60 + (mm ? Number(mm) : 0)
}

export function book(
  db: Db,
  day: string,
  from: string,
  to: string,
  opts: { name?: string; people?: 1 | 2; companion?: string | null; note?: string | null; key?: string; hp?: string; now?: string } = {},
) {
  return db.rpc('book_visit', {
    p_day: day,
    p_start: m(from),
    p_end: m(to),
    p_people: opts.people ?? 1,
    p_name: opts.name ?? 'Test',
    p_companion: opts.companion ?? null,
    p_note: opts.note ?? null,
    p_owner_key: opts.key ?? KEY_A,
    p_hp: opts.hp ?? null,
  }, { now: opts.now })
}
