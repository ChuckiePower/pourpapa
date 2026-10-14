/**
 * Miroir côté client de la règle de capacité, pour l'affichage en temps réel
 * (durées désactivées, places libres). La base de données reste seule juge :
 * voir `private.validate_slot` dans supabase/schema.sql.
 */
import type { Block, Range, Settings, Visit } from './types'
import { diffDays } from './time'

export const SLOT = 30

export type SlotState = {
  slot: number
  /** Nombre de personnes présentes */
  load: number
  /** Période bloquée par l'admin */
  block: Block | null
  /** Tranche terminée (la demi-heure en cours reste réservable) */
  past: boolean
  /** Visites présentes sur cette tranche */
  present: Visit[]
}

export type Now = { day: string; min: number }

export function slotStates(
  day: string,
  visits: Visit[],
  blocks: Block[],
  settings: Pick<Settings, 'open_min' | 'close_min'>,
  now: Now,
  excludeId?: string,
): SlotState[] {
  const dayVisits = visits.filter((v) => v.day === day && v.id !== excludeId)
  const dayBlocks = blocks.filter((b) => b.day === day)
  const out: SlotState[] = []
  for (let s = settings.open_min; s < settings.close_min; s += SLOT) {
    const present = dayVisits.filter((v) => v.start_min <= s && v.end_min > s)
    out.push({
      slot: s,
      load: present.reduce((n, v) => n + v.people, 0),
      block: dayBlocks.find((b) => b.start_min <= s && b.end_min > s) ?? null,
      past: day < now.day || (day === now.day && s + SLOT <= now.min),
      present,
    })
  }
  return out
}

export function freeAt(st: SlotState, capacity: number): number {
  if (st.block || st.past) return 0
  return Math.max(0, capacity - st.load)
}

export function fits(
  states: SlotState[],
  start: number,
  end: number,
  people: number,
  capacity: number,
  keepStart?: number,
): boolean {
  if (start >= end) return false
  for (let s = start; s < end; s += SLOT) {
    const st = states.find((x) => x.slot === s)
    if (!st || st.block) return false
    if (st.past && !(keepStart !== undefined && start === keepStart)) return false
    if (st.load + people > capacity) return false
  }
  return true
}

/** Plages contiguës où `people` personnes peuvent venir. */
export function freeRanges(states: SlotState[], people: number, capacity: number): Range[] {
  const out: Range[] = []
  for (const st of states) {
    if (freeAt(st, capacity) >= people) {
      const last = out[out.length - 1]
      if (last && last.end_min === st.slot) last.end_min = st.slot + SLOT
      else out.push({ start_min: st.slot, end_min: st.slot + SLOT })
    }
  }
  return out
}

/** Plages libres regroupées par nombre de places : « 18h–20h · 2 places ». */
export function freeRangesByCount(states: SlotState[], capacity: number): (Range & { free: number })[] {
  const out: (Range & { free: number })[] = []
  for (const st of states) {
    const free = freeAt(st, capacity)
    if (free <= 0) continue
    const last = out[out.length - 1]
    if (last && last.end_min === st.slot && last.free === free) last.end_min = st.slot + SLOT
    else out.push({ start_min: st.slot, end_min: st.slot + SLOT, free })
  }
  return out
}

/** Plus tard possible pour un départ, en partant de `start`. */
export function maxEnd(states: SlotState[], start: number, people: number, capacity: number, keepStart?: number): number {
  let end = start
  while (fits(states, start, end + SLOT, people, capacity, keepStart)) end += SLOT
  return end
}

export type Check =
  | { ok: true }
  | { ok: false; reason: 'past' | 'too_far' | 'too_long' | 'outside_hours' | 'blocked' | 'full' | 'invalid' }

/** Même ordre de vérification que la base. */
export function checkVisit(
  p: { day: string; start: number; end: number; people: number; keepStart?: number },
  states: SlotState[],
  settings: Settings,
  now: Now,
  admin = false,
): Check {
  const { day, start, end, people, keepStart } = p
  if (start % SLOT || end % SLOT || start >= end) return { ok: false, reason: 'invalid' }
  if (start < settings.open_min || end > settings.close_min) return { ok: false, reason: 'outside_hours' }
  if (!admin) {
    if (
      day < now.day ||
      (day === now.day && end <= now.min) ||
      (day === now.day && start + SLOT <= now.min && start !== keepStart)
    )
      return { ok: false, reason: 'past' }
    if (diffDays(day, now.day) > settings.days_ahead - 1) return { ok: false, reason: 'too_far' }
    if (settings.max_duration_min && end - start > settings.max_duration_min) return { ok: false, reason: 'too_long' }
    for (let s = start; s < end; s += SLOT) {
      if (states.find((x) => x.slot === s)?.block) return { ok: false, reason: 'blocked' }
    }
  }
  for (let s = start; s < end; s += SLOT) {
    const st = states.find((x) => x.slot === s)
    if (!st || st.load + people > settings.capacity) return { ok: false, reason: 'full' }
  }
  return { ok: true }
}

/** Taux de remplissage d'une journée (0 à 1). Les périodes bloquées comptent comme pleines. */
export function dayFill(states: SlotState[], capacity: number): number {
  if (!states.length) return 0
  let used = 0
  for (const st of states) used += st.block ? capacity : Math.min(capacity, st.load)
  return used / (capacity * states.length)
}
