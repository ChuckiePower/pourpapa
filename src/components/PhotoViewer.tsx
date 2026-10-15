import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { photoUrl } from '../lib/photos'
import { capitalize, dayLong, fmtMin, parisParts } from '../lib/time'
import type { Photo } from '../lib/types'
import { cx } from './ui'

const AUTOPLAY_MS = 4500

/**
 * Visionneuse plein écran, dans l'ordre chronologique : on fait défiler les
 * photos du premier jour au dernier (glisser, flèches, ou lecture automatique).
 */
export function PhotoViewer({
  photos,
  index,
  dayNumber,
  onIndex,
  onClose,
  canDelete,
  onDelete,
}: {
  photos: Photo[]
  index: number
  dayNumber: (day: string) => number
  onIndex: (i: number) => void
  onClose: () => void
  canDelete: (p: Photo) => boolean
  onDelete: (p: Photo) => Promise<void>
}) {
  const [playing, setPlaying] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dir, setDir] = useState<'next' | 'prev' | null>(null)
  const touch = useRef<number | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const photo = photos[index]
  const count = photos.length

  const go = (d: 1 | -1) => {
    const n = index + d
    if (n < 0 || n >= count) {
      setPlaying(false)
      return
    }
    setDir(d > 0 ? 'next' : 'prev')
    setConfirm(false)
    onIndex(n)
  }

  // Page derrière inerte, défilement bloqué, clavier.
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    if (root) root.inert = true
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      if (root) root.inert = false
      document.body.style.overflow = prev
      restore?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // Lecture automatique.
  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(() => go(1), AUTOPLAY_MS)
    return () => window.clearTimeout(t)
  })

  // Précharge la suivante.
  useEffect(() => {
    const next = photos[index + 1]
    if (next) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = photoUrl(next.path)
    }
  }, [index, photos])

  if (!photo) return null
  const time = fmtMin(parisParts(new Date(photo.created_at)).min)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photos"
      className="anim-fade fixed inset-0 z-[70] flex flex-col bg-[#0d0b09] text-[#f4eee6]"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (dx < -50) go(1)
        if (dx > 50) go(-1)
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <p className="px-2 text-[15px] tabular text-[#f4eee6]/80" aria-live="polite">
          {index + 1} / {count}
        </p>
        <div className="flex items-center gap-1">
          {count > 1 && (
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-[15px] font-medium hover:bg-white/10"
              aria-pressed={playing}
            >
              {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
              {playing ? 'Pause' : 'Lecture'}
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-12 place-items-center rounded-full hover:bg-white/10"
          >
            <X className="size-6" aria-hidden />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        <img
          key={photo.id}
          src={photoUrl(photo.path)}
          crossOrigin="anonymous"
          alt={photo.caption ?? `Photo de ${photo.author}`}
          width={photo.width}
          height={photo.height}
          className={cx('max-h-full max-w-full rounded-lg object-contain', dir === 'next' ? 'anim-next' : dir === 'prev' ? 'anim-prev' : 'anim-fade')}
        />
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Photo précédente"
          className="absolute left-2 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/35 disabled:opacity-0"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index >= count - 1}
          aria-label="Photo suivante"
          className="absolute right-2 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/35 disabled:opacity-0"
        >
          <ChevronRight className="size-6" aria-hidden />
        </button>
      </div>

      <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {photo.caption && <p className="whitespace-pre-line font-serif text-[21px] leading-snug">{photo.caption}</p>}
        <div className="mt-1 flex min-h-12 items-center justify-between gap-3">
          <p className="text-[14px] text-[#f4eee6]/75">
            Jour {dayNumber(photo.day)} · {capitalize(dayLong(photo.day))} · {photo.author}, {time}
          </p>
          {canDelete(photo) &&
            (confirm ? (
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setConfirm(false)} className="min-h-12 rounded-full px-3 text-[14px] hover:bg-white/10">
                  Garder
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await onDelete(photo)
                    setBusy(false)
                    setConfirm(false)
                  }}
                  className="min-h-12 rounded-full bg-white/15 px-4 text-[14px] font-semibold"
                >
                  Supprimer
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className="min-h-12 shrink-0 rounded-full px-3 text-[14px] text-[#f4eee6]/75 hover:bg-white/10">
                Supprimer
              </button>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
