import { ChevronDown } from 'lucide-react'
import { useData } from '../lib/store'

export function guidelineLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/** Consignes de visite, éditées par l'admin. */
export function Guidelines({ compact }: { compact?: boolean }) {
  const { settings } = useData()
  const lines = guidelineLines(settings.guidelines)
  if (!lines.length) return null

  const list = (
    <ul className="flex flex-col gap-2">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-snug">
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent-text" />
          <span>{l}</span>
        </li>
      ))}
    </ul>
  )

  if (compact) {
    return (
      <details className="group rounded-2xl border border-line bg-surface px-4 shadow-soft">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-medium [&::-webkit-details-marker]:hidden">
          Consignes de visite
          <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="pb-4">{list}</div>
      </details>
    )
  }

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-soft">
      <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">Avant d'entrer</p>
      {list}
    </section>
  )
}
