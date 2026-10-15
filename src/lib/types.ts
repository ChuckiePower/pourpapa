export type Settings = {
  app_name: string
  patient_label: string
  open_min: number
  close_min: number
  /** Personnes en même temps */
  capacity: number
  /** Personnes sur toute la journée (null = pas de limite) */
  per_day: number | null
  max_duration_min: number | null
  days_ahead: number
  announcement: string
  guidelines: string
}

export type Visit = {
  id: string
  /** Date locale (Europe/Paris), AAAA-MM-JJ */
  day: string
  /** Minutes depuis minuit, heure locale */
  start_min: number
  end_min: number
  people: 1 | 2
  name: string
  companion_name: string | null
}

export type Block = {
  id: string
  day: string
  start_min: number
  end_min: number
  reason: string
}

export type Note = {
  id: string
  author: string
  body: string
  created_at: string
}

export type ServerNow = { day: string; min: number; epoch_ms: number }

export type Photo = {
  id: string
  /** Nom du fichier dans le bucket « photos » */
  path: string
  day: string
  author: string
  caption: string | null
  width: number
  height: number
  created_at: string
}

export type Planning = {
  now: ServerNow
  settings: Settings
  visits: Visit[]
  blocks: Block[]
  notes: Note[]
  photos?: Photo[]
}

export type Range = { start_min: number; end_min: number }

export type FailReason =
  | 'invalid'
  | 'outside_hours'
  | 'past'
  | 'too_far'
  | 'too_long'
  | 'blocked'
  | 'full'
  | 'day_full'
  | 'rate_limited'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'no_pin'
  | 'wrong_pin'
  | 'offline'
  | 'error'

export type Fail = {
  ok: false
  reason: FailReason
  message: string
  alternatives?: Range[]
  next_days?: string[]
  slot?: number
}

export type Result<T = object> = ({ ok: true } & T) | Fail

export const DEFAULT_SETTINGS: Settings = {
  app_name: 'Visites',
  patient_label: 'papa',
  open_min: 840,
  close_min: 1200,
  capacity: 2,
  per_day: 2,
  max_duration_min: null,
  days_ahead: 14,
  announcement: '',
  guidelines: '',
}
