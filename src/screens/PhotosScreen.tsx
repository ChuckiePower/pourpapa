import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Play } from 'lucide-react'
import { PhotoViewer } from '../components/PhotoViewer'
import { Button, Card, charCount, ErrorNote, Input, Select, Sheet, Spinner, TextArea, useToast } from '../components/ui'
import * as api from '../lib/api'
import { getKeys, primaryKey, saveName, savedName } from '../lib/owner'
import { cleanupPhotoFile, compressPhoto, photoUrl, uploadPhoto } from '../lib/photos'
import { useData, useNow } from '../lib/store'
import { addDays, capitalize, dayLong, dayRelative, diffDays, fmtMin, parisParts } from '../lib/time'
import type { Photo } from '../lib/types'

/** Les photos des visites, jour après jour. */
export function PhotosScreen() {
  const { planning, mine, online, removePhoto } = useData()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [viewer, setViewer] = useState<number | null>(null)

  const photos = planning?.photos ?? []
  // Ordre chronologique pour la visionneuse, plus récent d'abord pour la page.
  const chrono = useMemo(
    () => [...photos].sort((a, b) => a.day.localeCompare(b.day) || a.created_at.localeCompare(b.created_at)),
    [photos],
  )
  const firstDay = chrono[0]?.day
  const dayNumber = (day: string) => (firstDay ? diffDays(day, firstDay) + 1 : 1)
  const groups = useMemo(() => {
    const m = new Map<string, Photo[]>()
    for (const p of [...chrono].reverse()) m.set(p.day, [...(m.get(p.day) ?? []), p])
    return [...m.entries()]
  }, [chrono])

  const keys = getKeys()

  async function remove(p: Photo) {
    const key = keys[mine.photos[p.id]]
    if (!key) return
    const r = await api.deletePhoto(p.id, key)
    if (!r.ok) return toast(r.message)
    removePhoto(p.id)
    cleanupPhotoFile(r.path)
    toast('Photo supprimée')
    setViewer((i) => {
      if (i === null) return null
      const left = chrono.length - 1
      return left <= 0 ? null : Math.min(i, left - 1)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[30px] font-medium leading-tight">Photos</h2>
        <p className="mt-1 text-[15px] text-muted">Les moments des visites, jour après jour.</p>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          block
          icon={<Camera className="size-5" aria-hidden />}
          disabled={!online}
          onClick={() => input.current?.click()}
        >
          Ajouter une photo
        </Button>
        {chrono.length > 1 && (
          <Button variant="quiet" block icon={<Play className="size-5" aria-hidden />} onClick={() => setViewer(0)}>
            Tout faire défiler depuis le jour 1
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choisir une photo"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) setFile(f)
        }}
      />
      {!online && <p className="text-[14px] text-muted">Hors ligne : l'ajout de photos reviendra avec le réseau.</p>}

      {groups.length === 0 ? (
        <Card className="flex flex-col gap-2">
          <p className="text-[17px] leading-relaxed">Pas encore de photo.</p>
          <p className="text-[15px] leading-relaxed text-muted">
            Pendant une visite, prends un moment en photo : elle s'ajoute ici, jour après jour. À la fin, on pourra tout
            faire défiler depuis le premier jour.
          </p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-8">
          {groups.map(([day, list]) => (
            <li key={day} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] font-semibold text-accent-text tabular">
                  Jour {dayNumber(day)}
                </span>
                <h3 className="text-[20px] font-medium">{capitalize(dayLong(day))}</h3>
              </div>
              <ul className="flex flex-col gap-4">
                {list.map((p) => (
                  <li key={p.id}>
                    <figure>
                      <button
                        type="button"
                        onClick={() => setViewer(chrono.findIndex((x) => x.id === p.id))}
                        className="block w-full overflow-hidden rounded-3xl bg-sunken"
                        style={{ aspectRatio: `${p.width} / ${p.height}`, maxHeight: '75dvh' }}
                        aria-label={`Agrandir la photo de ${p.author}${p.caption ? ` : ${p.caption}` : ''}`}
                      >
                        <img
                          src={photoUrl(p.path)}
                          crossOrigin="anonymous"
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={p.width}
                          height={p.height}
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <figcaption className="mt-2 px-1">
                        {p.caption && <p className="whitespace-pre-line font-serif text-[18px] leading-snug">{p.caption}</p>}
                        <p className="mt-0.5 text-[14px] text-muted">
                          {p.author}, {fmtMin(parisParts(new Date(p.created_at)).min)}
                        </p>
                      </figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      <AddPhotoSheet file={file} onClose={() => setFile(null)} />

      {viewer !== null && chrono[viewer] && (
        <PhotoViewer
          photos={chrono}
          index={viewer}
          dayNumber={dayNumber}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          canDelete={(p) => p.id in mine.photos}
          onDelete={remove}
        />
      )}
    </div>
  )
}

function AddPhotoSheet({ file, onClose }: { file: File | null; onClose: () => void }) {
  const { upsertPhoto, online, refresh } = useData()
  const now = useNow()
  const toast = useToast()
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [name, setName] = useState(savedName())
  const [day, setDay] = useState(now.day)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    setCaption('')
    setDay(now.day)
    setError(null)
    return () => URL.revokeObjectURL(url)
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = Array.from({ length: 7 }, (_, i) => addDays(now.day, -i))
  const tooLong = charCount(caption) > 140
  const canSubmit = !!file && online && !busy && name.trim().length > 0 && !tooLong

  async function submit() {
    if (!file || !canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const { blob, width, height } = await compressPhoto(file)
      const path = await uploadPhoto(blob)
      const r = await api.addPhoto({
        path, day, author: name.trim(), caption: caption.trim() || null, width, height, key: primaryKey(),
      })
      if (!r.ok) {
        setError(r.message)
        cleanupPhotoFile(path)
        return
      }
      saveName(name)
      upsertPhoto(r.photo, { key: 0 })
      void refresh()
      toast('Photo ajoutée')
      onClose()
    } catch {
      setError(navigator.onLine ? "La photo n'a pas pu être envoyée. Réessaie." : 'Pas de réseau pour le moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={!!file} onClose={() => !busy && onClose()} title="Nouvelle photo">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {preview && (
          <img src={preview} alt="Aperçu de la photo" className="max-h-[42dvh] w-full rounded-3xl bg-sunken object-contain" />
        )}
        <TextArea
          label="Légende"
          max={140}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Facultatif. Un mot sur ce moment."
          rows={2}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="given-name" />
          <Select label="Jour" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {capitalize(dayRelative(d, now.day))}
              </option>
            ))}
          </Select>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" block disabled={!canSubmit} className="min-h-14 text-[17px]">
          {busy && <Spinner />} {busy ? 'Envoi…' : 'Ajouter la photo'}
        </Button>
      </form>
    </Sheet>
  )
}
