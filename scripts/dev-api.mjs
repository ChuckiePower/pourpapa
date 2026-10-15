/**
 * Mini-API locale qui imite Supabase (PostgREST) pour développer et tester
 * sans compte : POST /rest/v1/rpc/<fonction> exécuté avec le rôle `anon`.
 * Pas de temps réel ici (lancer Vite avec VITE_REALTIME=off).
 *
 *   DEV_DATABASE_URL=postgres://dev:dev@127.0.0.1:5432/visites_dev node scripts/dev-api.mjs
 *   DEV_NOW="2026-10-20 15:40:00"  (facultatif : fige l'heure côté base)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

// Stockage des photos imité dans un dossier temporaire.
const PHOTOS_DIR = process.env.DEV_PHOTOS_DIR ?? join(tmpdir(), 'visites-photos')
mkdirSync(PHOTOS_DIR, { recursive: true })
const PHOTO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/

const url = process.env.DEV_DATABASE_URL ?? 'postgres://dev:dev@127.0.0.1:5432/visites_dev'
const port = Number(process.env.DEV_API_PORT ?? 54321)
const pool = new pg.Pool({ connectionString: url })
pool.on('error', (e) => console.error('pg:', e.message))

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version, x-upsert, cache-control',
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      return res.end()
    }
    if (req.url === '/health') {
      res.writeHead(200, cors)
      return res.end('ok')
    }
    const pathname = new URL(req.url, 'http://x').pathname
    const pub = /^\/storage\/v1\/object\/public\/photos\/(.+)$/.exec(pathname)
    if (pub && req.method === 'GET') {
      const file = join(PHOTOS_DIR, pub[1])
      if (!PHOTO_RE.test(pub[1]) || !existsSync(file)) {
        res.writeHead(404, cors)
        return res.end()
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' })
      return res.end(readFileSync(file))
    }
    const up = /^\/storage\/v1\/object\/photos\/(.+)$/.exec(pathname)
    if (up && req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      if (!PHOTO_RE.test(up[1])) {
        res.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ message: 'invalid name' }))
      }
      writeFileSync(join(PHOTOS_DIR, up[1]), Buffer.concat(chunks))
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ Key: `photos/${up[1]}` }))
    }
    if (pathname === '/storage/v1/object/photos' && req.method === 'DELETE') {
      let body = ''
      for await (const c of req) body += c
      for (const p of JSON.parse(body || '{}').prefixes ?? []) if (PHOTO_RE.test(p)) rmSync(join(PHOTOS_DIR, p), { force: true })
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      return res.end('[]')
    }
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(new URL(req.url, 'http://x').pathname)
    if (!m || req.method !== 'POST') {
      res.writeHead(404, { ...cors, 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ message: 'not found' }))
    }
    let body = ''
    for await (const chunk of req) body += chunk
    const args = body ? JSON.parse(body) : {}
    const keys = Object.keys(args).filter((k) => /^p_[a-z_]+$/.test(k))
    const values = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]))
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('set local role anon')
      await client.query(`select set_config('request.headers', $1, true)`, [
        JSON.stringify({ 'x-forwarded-for': req.socket.remoteAddress ?? 'local' }),
      ])
      if (process.env.DEV_NOW) await client.query(`select set_config('visites.now', $1, true)`, [process.env.DEV_NOW])
      const sql = `select public.${m[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`
      const r = await client.query(sql, values)
      await client.query('commit')
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(r.rows[0].r))
    } catch (e) {
      await client.query('rollback').catch(() => {})
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: e.code, message: e.message }))
    } finally {
      client.release()
    }
  })
  .listen(port, () => console.log(`API locale sur http://127.0.0.1:${port}  (base : ${url})`))
