/**
 * Disposition de la timeline : une colonne par place, chaque visite posée
 * dans une (ou deux) colonne(s), et les espaces libres entre elles.
 */
import { freeAt, freeRanges, SLOT, type SlotState } from './capacity'
import type { Range, Visit } from './types'

/**
 * Attribue des colonnes aux visites d'une journée (partition gloutonne
 * d'intervalles, optimale puisque la capacité est respectée à chaque instant).
 */
export function assignColumns(visits: Visit[], capacity: number): Map<string, number[]> {
  const sorted = [...visits].sort((a, b) => a.start_min - b.start_min || b.people - a.people || a.id.localeCompare(b.id))
  const colEnd = Array<number>(capacity).fill(-1)
  const out = new Map<string, number[]>()
  for (const v of sorted) {
    const freeCols = colEnd.map((end, c) => (end <= v.start_min ? c : -1)).filter((c) => c >= 0)
    let cols: number[]
    if (v.people === 2) {
      // de préférence deux colonnes voisines
      const pair = freeCols.find((c) => freeCols.includes(c + 1))
      cols = pair !== undefined ? [pair, pair + 1] : freeCols.slice(0, 2)
    } else {
      cols = freeCols.slice(0, 1)
    }
    // Capacité dépassée (réglage abaissé après coup) : on superpose plutôt que de cacher.
    if (cols.length < v.people) cols = v.people === 2 ? [0, Math.min(1, capacity - 1)] : [capacity - 1]
    for (const c of cols) colEnd[c] = Math.max(colEnd[c], v.end_min)
    out.set(v.id, [...new Set(cols)])
  }
  return out
}

export type FreeSegment = {
  start_min: number
  end_min: number
  /** Colonnes contiguës couvertes par l'espace libre */
  cols: number[]
  /** Visites présentes à côté (vide si personne n'est là) */
  alongside: Visit[]
  /** Nombre de places réellement libres (limite par jour comprise) */
  places: number
}

export function freeSegments(states: SlotState[], placement: Map<string, number[]>, capacity: number): FreeSegment[] {
  type Row = { slot: number; freeCols: number[]; alongside: Visit[]; places: number; key: string }
  const rows: Row[] = states.map((st) => {
    const occupied = new Set(st.present.flatMap((v) => placement.get(v.id) ?? []))
    const places = freeAt(st, capacity)
    const freeCols = places > 0 ? Array.from({ length: capacity }, (_, c) => c).filter((c) => !occupied.has(c)) : []
    const alongside = freeCols.length ? st.present : []
    return {
      slot: st.slot,
      freeCols,
      alongside,
      places,
      key: `${freeCols.join(',')}|${alongside.map((v) => v.id).join(',')}|${places}`,
    }
  })

  const out: FreeSegment[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    let j = i
    while (j + 1 < rows.length && rows[j + 1].key === r.key) j++
    if (r.freeCols.length) {
      for (const run of contiguousRuns(r.freeCols)) {
        out.push({ start_min: r.slot, end_min: rows[j].slot + SLOT, cols: run, alongside: r.alongside, places: Math.min(run.length, r.places) })
      }
    }
    i = j + 1
  }
  return out
}

function contiguousRuns(cols: number[]): number[][] {
  const runs: number[][] = []
  for (const c of cols) {
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === c - 1) last.push(c)
    else runs.push([c])
  }
  return runs
}

/**
 * Horaires proposés pour « Rejoindre » une visite : ceux de la visite,
 * réduits à la plage où une place reste libre autour de `from`.
 */
export function joinRange(states: SlotState[], visit: Visit, from: number, capacity: number): Range | null {
  const range = freeRanges(states, 1, capacity).find((r) => r.start_min <= from && r.end_min > from)
  if (!range) return null
  const start = Math.max(range.start_min, visit.start_min)
  const end = Math.min(range.end_min, visit.end_min)
  return start < end ? { start_min: start, end_min: end } : null
}
