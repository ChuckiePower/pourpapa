import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

/* ---------------------------------------------------------------- Bouton */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent shadow-soft hover:brightness-105 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line shadow-soft hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  quiet: 'text-accent-text hover:bg-accent-soft',
  danger: 'text-accent-text border border-line bg-surface hover:bg-accent-soft',
}

export function Button({
  variant = 'secondary',
  block,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-medium transition-[background-color,filter] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

/* ---------------------------------------------------------------- Puces */

export function Chip({
  selected,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'min-h-12 rounded-xl border px-3.5 text-[15px] font-medium tabular transition-colors duration-150',
        selected
          ? 'border-ink bg-ink text-bg'
          : 'border-line bg-surface text-ink hover:bg-sunken',
        'disabled:border-dashed disabled:bg-transparent disabled:text-muted disabled:line-through disabled:decoration-1',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1 rounded-2xl bg-sunken p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-12 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150',
            value === o.value ? 'bg-surface text-ink shadow-soft' : 'text-muted hover:text-ink',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- Champs */

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold uppercase tracking-wide text-muted">
        {children}
      </label>
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </div>
  )
}

const fieldClass =
  'w-full min-h-12 rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink placeholder:text-muted/70 shadow-soft focus:border-accent focus:outline-none'

export function Input({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className={className}>
      {label && <Label htmlFor={id} hint={hint}>{label}</Label>}
      <input id={id} className={fieldClass} {...rest} />
    </div>
  )
}

export function Select({
  label,
  hint,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className={className}>
      {label && <Label htmlFor={id} hint={hint}>{label}</Label>}
      <div className="relative">
        <select id={id} className={cx(fieldClass, 'appearance-none pr-10 tabular')} {...rest}>
          {children}
        </select>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}

/** Compte les caractères comme Postgres (points de code), pas en UTF-16. */
export function charCount(s: string) {
  return [...s].length
}

export function TextArea({
  label,
  max,
  value,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; max?: number; value: string }) {
  const id = useId()
  const n = charCount(value)
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} hint={max ? <span className={cx('tabular', n > max && 'text-accent-text font-semibold')}>{n}/{max}</span> : undefined}>
          {label}
        </Label>
      )}
      <textarea id={id} value={value} className={cx(fieldClass, 'min-h-24 resize-none py-3 leading-relaxed')} {...rest} />
    </div>
  )
}

/* ---------------------------------------------------------------- Cartes */

export function Card({ className, children, as: As = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' | 'li' }) {
  return <As className={cx('rounded-3xl border border-line bg-surface p-5 shadow-soft', className)}>{children}</As>
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[13px] font-semibold uppercase tracking-wide text-muted', className)}>{children}</p>
}

/* ---------------------------------------------------------------- Feuille (bas d'écran) */

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Le reste de la page devient inerte (clavier, lecteurs d'écran).
    const root = document.getElementById('root')
    if (root) root.inert = true
    const t = window.setTimeout(() => panel.current?.focus(), 20)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])',
        )
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prevOverflow
      if (root) root.inert = false
      document.removeEventListener('keydown', onKey)
      restore.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="anim-fade absolute inset-0 bg-[rgb(20_14_10/0.36)]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-bg shadow-sheet focus:outline-none"
      >
        <div className="flex items-start gap-3 px-5 pb-2 pt-3">
          <div className="min-w-0 flex-1 pt-3">
            <h2 id={titleId} className="text-[24px] font-medium leading-tight">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-2 mt-1 grid size-12 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ---------------------------------------------------------------- Message bref */

const ToastCtx = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null)
  const show = useCallback((text: string) => setMsg({ text, id: Date.now() }), [])
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 2600)
    return () => window.clearTimeout(t)
  }, [msg])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
          {msg && (
            <div key={msg.id} className="anim-rise rounded-2xl bg-ink px-4 py-3 text-[15px] font-medium text-bg shadow-soft">
              {msg.text}
            </div>
          )}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/* ---------------------------------------------------------------- Divers */

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl border border-accent-text/30 bg-accent-soft px-4 py-3 text-[15px] text-ink">
      {children}
    </div>
  )
}

export function Spinner() {
  return <span aria-hidden className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
}
