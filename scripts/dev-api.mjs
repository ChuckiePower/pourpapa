/**
 * Mini-API locale qui imite Supabase (PostgREST) pour développer et tester
 * sans compte : POST /rest/v1/rpc/<fonction> exécuté avec le rôle `anon`.
 * Pas de temps réel ici (lancer Vite avec VITE_REALTIME=off).
 *
 *   DEV_DATABASE_URL=postgres://dev:dev@127.0.0.1:5432/visites_dev node scripts/dev-api.mjs
 *   DEV_NOW="2026-10-20 15:40:00"  (facultatif : fige l'heure côté base)
 */
import http from 'node:http'
import pg from 'pg'

const url = process.env.DEV_DATABASE_URL ?? 'postgres://dev:dev@127.0.0.1:5432/visites_dev'
const port = Number(process.env.DEV_API_PORT ?? 54321)
const pool = new pg.Pool({ connectionString: url })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version',
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      return res.end()
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
