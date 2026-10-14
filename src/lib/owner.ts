/**
 * « Mes visites » sans compte : chaque appareil garde une clé secrète.
 * La base n'en connaît que l'empreinte (sha256). Le lien de modification
 * transporte la clé dans le fragment (#), jamais envoyé au serveur.
 */
import { storage } from './storage'

const KEYS = 'visites.keys'
const NAME = 'visites.name'
const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/

function randomKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function getKeys(): string[] {
  let keys = (storage.get<string[]>(KEYS) ?? []).filter((k) => KEY_RE.test(k))
  if (!keys.length) {
    keys = [randomKey()]
    storage.set(KEYS, keys)
  }
  return keys
}

export function primaryKey(): string {
  return getKeys()[0]
}

/** Ajoute les clés d'un lien de modification ; elles deviennent prioritaires. */
export function importKeys(raw: string): number {
  const incoming = raw.split('.').filter((k) => KEY_RE.test(k))
  if (!incoming.length) return 0
  const keys = [...new Set([...incoming, ...getKeys()])].slice(0, 6)
  storage.set(KEYS, keys)
  return incoming.length
}

export function modificationLink(): string {
  return `${location.origin}/m#${getKeys().join('.')}`
}

export function savedName(): string {
  return storage.get<string>(NAME) ?? ''
}

export function saveName(name: string) {
  if (name.trim()) storage.set(NAME, name.trim())
}
