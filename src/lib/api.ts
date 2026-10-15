/**
 * Appels aux fonctions serveur. Aucune écriture directe dans les tables :
 * tout passe par les fonctions Postgres (voir supabase/schema.sql).
 */
import { db } from './supabase'
import type { Fail, Photo, Planning, Range, Result, Settings, Visit } from './types'

const OFFLINE: Fail = {
  ok: false,
  reason: 'offline',
  message: 'Pas de réseau pour le moment. Réessaie dès que la connexion revient.',
}

export class OfflineError extends Error {}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  if (!db) return { ok: false, reason: 'error', message: "L'application n'est pas encore reliée à sa base de données." }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE
  try {
    const { data, error } = await db.rpc(fn, args)
    if (error) {
      if (/fetch|network|load failed/i.test(error.message)) return OFFLINE
      console.error(fn, error)
      return { ok: false, reason: 'error', message: 'Le serveur a eu un souci. Réessaie dans un instant.' }
    }
    return data as Result<T>
  } catch {
    return OFFLINE
  }
}

export async function getPlanning(): Promise<Planning> {
  if (!db) throw new Error('not configured')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError()
  try {
    const { data, error } = await db.rpc('get_planning', {})
    if (error) {
      if (/fetch|network|load failed/i.test(error.message)) throw new OfflineError()
      throw new Error(error.message)
    }
    return data as Planning
  } catch (e) {
    if (e instanceof Error && !(e instanceof OfflineError) && !/fetch|network|load failed/i.test(e.message)) throw e
    throw new OfflineError()
  }
}

export type VisitInput = {
  day: string
  start: number
  end: number
  people: 1 | 2
  name: string
  companion: string | null
}

export function bookVisit(v: VisitInput & { note: string | null; key: string; hp: string }) {
  return call<{ visit: Visit; note_id: string | null }>('book_visit', {
    p_day: v.day,
    p_start: v.start,
    p_end: v.end,
    p_people: v.people,
    p_name: v.name,
    p_companion: v.people === 2 ? v.companion : null,
    p_note: v.note,
    p_owner_key: v.key,
    p_hp: v.hp,
  })
}

export function updateVisit(id: string, key: string, v: VisitInput) {
  return call<{ visit: Visit }>('update_visit', {
    p_id: id,
    p_owner_key: key,
    p_day: v.day,
    p_start: v.start,
    p_end: v.end,
    p_people: v.people,
    p_name: v.name,
    p_companion: v.people === 2 ? v.companion : null,
  })
}

export function cancelVisit(id: string, key: string) {
  return call('cancel_visit', { p_id: id, p_owner_key: key })
}

export function deleteNote(id: string, key: string) {
  return call('delete_note', { p_id: id, p_owner_key: key })
}

type Owned = { id: string; key: number }[]

export function myItems(keys: string[]) {
  return call<never>('my_items', { p_keys: keys }) as unknown as Promise<
    { visits: Owned; notes: Owned; photos?: Owned } | Fail
  >
}

export function addPhoto(p: { path: string; day: string; author: string; caption: string | null; width: number; height: number; key: string }) {
  return call<{ photo: Photo }>('add_photo', {
    p_path: p.path, p_day: p.day, p_author: p.author, p_caption: p.caption,
    p_width: p.width, p_height: p.height, p_owner_key: p.key,
  })
}

export function deletePhoto(id: string, key: string) {
  return call<{ path: string }>('delete_photo', { p_id: id, p_owner_key: key })
}

/* ---------- Admin ---------- */

export function adminLogin(pin: string) {
  return call<{ token: string }>('admin_login', { p_pin: pin })
}
export function adminCheck(token: string) {
  return call<object>('admin_check', { p_token: token })
}
export function adminLogout(token: string) {
  return call('admin_logout', { p_token: token })
}
export function adminSetPin(token: string, pin: string) {
  return call<{ token: string }>('admin_set_pin', { p_token: token, p_new_pin: pin })
}
export function adminBlock(token: string, b: { day: string; start: number; end: number; reason: string }) {
  return call<{ block_id: string; affected: Visit[] }>('admin_block', {
    p_token: token, p_day: b.day, p_start: b.start, p_end: b.end, p_reason: b.reason,
  })
}
export function adminUnblock(token: string, id: string) {
  return call('admin_unblock', { p_token: token, p_id: id })
}
export function adminSaveVisit(token: string, id: string | null, v: VisitInput) {
  return call<{ visit: Visit }>('admin_save_visit', {
    p_token: token, p_id: id, p_day: v.day, p_start: v.start, p_end: v.end,
    p_people: v.people, p_name: v.name, p_companion: v.people === 2 ? v.companion : null,
  })
}
export function adminDeleteVisit(token: string, id: string) {
  return call('admin_delete_visit', { p_token: token, p_id: id })
}
export function adminDeletePhoto(token: string, id: string) {
  return call<{ path: string | null }>('admin_delete_photo', { p_token: token, p_id: id })
}
export function adminDeleteNote(token: string, id: string) {
  return call('admin_delete_note', { p_token: token, p_id: id })
}
export function adminUpdateSettings(token: string, patch: Partial<Settings>) {
  return call('admin_update_settings', { p_token: token, p_patch: patch })
}

export type { Range }
