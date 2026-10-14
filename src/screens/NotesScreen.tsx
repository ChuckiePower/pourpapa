import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, cx } from '../components/ui'
import { Link } from '../lib/router'
import { useData, useNow } from '../lib/store'
import { dayRelative, parisParts } from '../lib/time'

/** Les petits mots, en grand, un par un. */
export function NotesScreen() {
  const { planning, settings } = useData()
  const now = useNow()
  const notes = planning?.notes ?? []
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<'next' | 'prev' | null>(null)
  const touch = useRef<number | null>(null)
  const index = Math.min(i, Math.max(0, notes.length - 1))
  const note = notes[index]

  const go = (d: 1 | -1) => {
    const n = index + d
    if (n < 0 || n >= notes.length) return
    setDir(d > 0 ? 'next' : 'prev')
    setI(n)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-[30px] font-medium leading-tight">Mots pour {settings.patient_label}</h2>

      {!note ? (
        <Card className="flex flex-col items-start gap-4">
          <p className="text-[17px] leading-relaxed">Pas encore de petit mot.</p>
          <p className="text-[15px] leading-relaxed text-muted">
            On peut en laisser un en réservant une visite. Ils s'affichent ici, en grand, pour les lui montrer.
          </p>
          <Link to="/" className="inline-flex min-h-12 items-center rounded-2xl border border-line bg-surface px-5 text-[15px] font-medium shadow-soft">
            Voir le planning
          </Link>
        </Card>
      ) : (
        <>
          <div
            className="relative"
            onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touch.current === null) return
              const dx = e.changedTouches[0].clientX - touch.current
              touch.current = null
              if (dx < -50) go(1)
              if (dx > 50) go(-1)
            }}
          >
            <article
              key={note.id}
              aria-live="polite"
              className={cx(
                'flex min-h-[52dvh] flex-col justify-center rounded-[32px] border border-line bg-surface px-7 py-10 shadow-soft',
                dir === 'next' && 'anim-next',
                dir === 'prev' && 'anim-prev',
              )}
            >
              <p className="whitespace-pre-line text-balance font-serif text-[clamp(28px,8vw,40px)] leading-[1.25]">{note.body}</p>
              <p className="mt-8 text-[20px] font-medium">— {note.author}</p>
              <p className="mt-1 text-[15px] text-muted">{dayRelative(parisParts(new Date(note.created_at)).day, now.day)}</p>
            </article>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={index === 0}
              aria-label="Mot précédent"
              className="grid size-14 place-items-center rounded-full border border-line bg-surface shadow-soft disabled:opacity-40"
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <p className="text-[16px] text-muted tabular" aria-live="polite">
              {index + 1} / {notes.length}
            </p>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={index >= notes.length - 1}
              aria-label="Mot suivant"
              className="grid size-14 place-items-center rounded-full border border-line bg-surface shadow-soft disabled:opacity-40"
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
