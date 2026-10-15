/**
 * Photos : compressées sur le téléphone (1600 px, JPEG, métadonnées et
 * position GPS supprimées), envoyées dans le stockage Supabase, puis
 * enregistrées en base avec leur légende.
 */
import { headers, SUPABASE_URL } from './supabase'

const MAX_SIDE = 1600
const QUALITY = 0.82

export function photoUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/photos/${path}`
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Réduit la photo et la réencode en JPEG (l'orientation est appliquée par le navigateur). */
export async function compressPhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', QUALITY),
    )
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Envoie le fichier dans le bucket « photos » et renvoie son nom. */
export async function uploadPhoto(blob: Blob): Promise<string> {
  const path = `${uuid()}.jpg`
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': 'max-age=31536000' },
    body: blob,
  })
  if (!res.ok) throw new Error(`upload ${res.status}`)
  return path
}

/** Après suppression en base, efface aussi le fichier (fonction Vercel). Sans conséquence si indisponible. */
export function cleanupPhotoFile(path: string | null | undefined) {
  if (!path) return
  void fetch('/api/photo-cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    keepalive: true,
  }).catch(() => {})
}
