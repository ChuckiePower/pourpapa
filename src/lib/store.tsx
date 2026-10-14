/**
 * Données partagées : dernier planning chargé (gardé pour le hors-ligne),
 * état du réseau, temps réel, et ce qui appartient à cet appareil.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getPlanning, myItems, OfflineError } from './api'
import { getKeys } from './owner'
import { storage } from './storage'
import { getRealtime } from './supabase'
import { parisNow, setClockOffset } from './time'
import { DEFAULT_SETTINGS, type Planning, type Settings, type Visit } from './types'

const CACHE = 'visites.planning.v1'
const MINE_CACHE = 'visites.mine.v1'

type Mine = { visits: Record<string, number>; notes: Record<string, number> }

type Store = {
  planning: Planning | null
  settings: Settings
  status: 'loading' | 'ready' | 'error'
  online: boolean
  lastSync: number | null
  mine: Mine
  refresh: () => Promise<void>
  refreshMine: () => Promise<void>
  /** Mise à jour locale immédiate après une action réussie. */
  upsertVisit: (v: Visit, owned?: { key: number }) => void
  removeVisit: (id: string) => void
  removeNote: (id: string) => void
}

const Ctx = createContext<Store | null>(null)

type Cached = { planning: Planning; at: number }

export function DataProvider({ children }: { children: ReactNode }) {
  const cached = useMemo(() => storage.get<Cached>(CACHE), [])
  const [planning, setPlanning] = useState<Planning | null>(cached?.planning ?? null)
  const [lastSync, setLastSync] = useState<number | null>(cached?.at ?? null)
  const [status, setStatus] = useState<Store['status']>(cached ? 'ready' : 'loading')
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [mine, setMine] = useState<Mine>(() => storage.get<Mine>(MINE_CACHE) ?? { visits: {}, notes: {} })
  const inflight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current
    const p = (async () => {
      try {
        const sent = Date.now()
        const data = await getPlanning()
        const received = Date.now()
        setClockOffset(data.now.epoch_ms - (sent + received) / 2)
        setPlanning(data)
        setLastSync(received)
        setStatus('ready')
        setOnline(true)
        storage.set(CACHE, { planning: data, at: received } satisfies Cached)
      } catch (e) {
        if (e instanceof OfflineError) setOnline(false)
        setStatus((s) => (s === 'loading' ? 'error' : s))
      } finally {
        inflight.current = null
      }
    })()
    inflight.current = p
    return p
  }, [])

  const refreshMine = useCallback(async () => {
    const res = await myItems(getKeys())
    if ('ok' in res && res.ok === false) return
    if (!('visits' in res)) return
    const next: Mine = {
      visits: Object.fromEntries(res.visits.map((x) => [x.id, x.key])),
      notes: Object.fromEntries(res.notes.map((x) => [x.id, x.key])),
    }
    setMine(next)
    storage.set(MINE_CACHE, next)
  }, [])

  // Premier chargement, retour du réseau, retour sur l'onglet, filet de sécurité toutes les minutes.
  useEffect(() => {
    void refresh()
    void refreshMine()
    const onOnline = () => {
      setOnline(true)
      void refresh()
      void refreshMine()
    }
    const onOffline = () => setOnline(false)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [refresh, refreshMine])

  // Temps réel : chaque changement déclenche un rechargement (léger, regroupé).
  useEffect(() => {
    const rt = getRealtime()
    if (!rt) return
    let t: number | undefined
    const bump = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => void refresh(), 250)
    }
    const channel = rt.channel('planning')
    for (const table of ['visits', 'blocks', 'notes', 'settings']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, bump)
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') bump()
    })
    return () => {
      window.clearTimeout(t)
      void rt.removeChannel(channel)
    }
  }, [refresh])

  const upsertVisit = useCallback((v: Visit, owned?: { key: number }) => {
    setPlanning((p) => (p ? { ...p, visits: [...p.visits.filter((x) => x.id !== v.id), v] } : p))
    if (owned) {
      setMine((m) => {
        const next = { ...m, visits: { ...m.visits, [v.id]: owned.key } }
        storage.set(MINE_CACHE, next)
        return next
      })
    }
  }, [])

  const removeVisit = useCallback((id: string) => {
    setPlanning((p) => (p ? { ...p, visits: p.visits.filter((x) => x.id !== id) } : p))
  }, [])

  const removeNote = useCallback((id: string) => {
    setPlanning((p) => (p ? { ...p, notes: p.notes.filter((x) => x.id !== id) } : p))
  }, [])

  const value: Store = {
    planning,
    settings: planning?.settings ?? DEFAULT_SETTINGS,
    status,
    online,
    lastSync,
    mine,
    refresh,
    refreshMine,
    upsertVisit,
    removeVisit,
    removeNote,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('DataProvider manquant')
  return s
}

/** Heure de Paris, rafraîchie toutes les 30 secondes. */
export function useNow() {
  const [now, setNow] = useState(parisNow)
  useEffect(() => {
    const tick = () => setNow(parisNow())
    const t = window.setInterval(tick, 30_000)
    window.addEventListener('visites:clock', tick)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('visites:clock', tick)
    }
  }, [])
  return now
}
