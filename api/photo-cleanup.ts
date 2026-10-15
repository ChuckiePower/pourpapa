/**
 * Fonction Vercel (POST /api/photo-cleanup { path }) : efface le fichier
 * d'une photo du stockage Supabase, seulement si plus aucune photo de la base
 * ne l'utilise (la suppression en base, elle, vérifie l'auteur ou l'admin).
 * La clé secrète Supabase reste ici, côté serveur, jamais dans l'app.
 * Volontairement sans aucun import, pour que Vercel l'exécute tel quel.
 */

declare const process: { env: Record<string, string | undefined> }

type Req = AsyncIterable<Uint8Array> & { method?: string; body?: unknown }
type Res = { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }

const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/

function env(names: string[], fallback: RegExp, exclude?: RegExp): string {
  for (const n of names) if (process.env[n]) return process.env[n]!.trim()
  const k = Object.keys(process.env).sort().find((n) => fallback.test(n) && !(exclude && exclude.test(n)) && process.env[n])
  return k ? process.env[k]!.trim() : ''
}

/** Les nouvelles clés (sb_…) ne vont que dans l'en-tête apikey ; les anciennes (JWT) aussi en Bearer. */
function auth(key: string): Record<string, string> {
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }
}

function send(res: Res, status: number, body: object) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')
  let raw = ''
  const dec = new TextDecoder()
  for await (const chunk of req) raw += dec.decode(chunk, { stream: true })
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false })
  let path = ''
  try {
    path = String((await readJson(req)).path ?? '')
  } catch {
    return send(res, 400, { ok: false })
  }
  if (!PATH_RE.test(path)) return send(res, 400, { ok: false, reason: 'invalid' })

  const url = env(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_URL'], /SUPABASE_URL$/).replace(/\/+$/, '')
  const anon = env(
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'],
    /SUPABASE_(PUBLISHABLE|ANON)_KEY$/,
  )
  const secret = env(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'], /SUPABASE_(SERVICE_ROLE|SECRET)_KEY$/, /NEXT_PUBLIC|VITE_/)
  if (!url || !anon || !secret) return send(res, 503, { ok: false, reason: 'not_configured' })

  // Le fichier ne doit plus être utilisé par aucune photo.
  const check = await fetch(`${url}/rest/v1/photos?select=id&path=eq.${path}`, { headers: auth(anon) })
  if (!check.ok) return send(res, 502, { ok: false })
  const rows = (await check.json()) as unknown[]
  if (rows.length) return send(res, 409, { ok: false, reason: 'in_use' })

  const del = await fetch(`${url}/storage/v1/object/photos`, {
    method: 'DELETE',
    headers: { ...auth(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [path] }),
  })
  return send(res, del.ok ? 200 : 502, { ok: del.ok })
}
