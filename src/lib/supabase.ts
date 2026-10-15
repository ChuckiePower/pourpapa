/**
 * Accès à Supabase avec seulement les deux briques utiles (appels de
 * fonctions et temps réel) : le client complet pèse trois fois plus lourd,
 * ce qui compte sur le réseau de l'hôpital. Configuration calquée sur
 * celle de @supabase/supabase-js.
 */
import { PostgrestClient } from '@supabase/postgrest-js'
import { RealtimeClient } from '@supabase/realtime-js'

export const SUPABASE_URL = __SUPABASE_URL__.replace(/\/+$/, '')
const URL_ = SUPABASE_URL
const KEY = __SUPABASE_KEY__

export const configured = Boolean(URL_ && KEY)

export const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

export const db = configured ? new PostgrestClient(`${URL_}/rest/v1`, { headers }) : null

let realtime: RealtimeClient | null = null

export function getRealtime(): RealtimeClient | null {
  if (!configured || !__REALTIME__) return null
  if (!realtime) {
    realtime = new RealtimeClient(`${URL_.replace(/^http/, 'ws')}/realtime/v1`, {
      params: { apikey: KEY },
      accessToken: async () => KEY,
    })
  }
  return realtime
}
