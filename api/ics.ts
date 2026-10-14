/**
 * Fonction Vercel : renvoie un fichier .ics. Sur iPhone, c'est la seule façon
 * fiable d'ouvrir « Ajouter au calendrier » depuis Safari.
 * Aucune donnée n'est lue ni stockée : tout vient des paramètres de l'URL.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildIcs, validIcsInput } from '../src/lib/ics'

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const input = validIcsInput(Object.fromEntries(url.searchParams))
  if (!input) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Paramètres invalides')
    return
  }
  const apple = /iPhone|iPad|iPod|Macintosh/.test(req.headers['user-agent'] ?? '')
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `${apple ? 'inline' : 'attachment'}; filename="visite.ics"`)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.end(buildIcs(input))
}
