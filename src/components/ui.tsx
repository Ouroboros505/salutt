import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ---------------------------------------------------------------- icons */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const svg = (path: ReactNode, size = 20) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...S} aria-hidden="true">
    {path}
  </svg>
)

export const Icon = {
  today: () => svg(<><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M9.5 19.5V14h5v5.5" /></>),
  food: () => svg(<><path d="M4 4v6a3 3 0 0 0 3 3v7" /><path d="M7 4v5" /><path d="M10 4v5" /><path d="M17.5 4c-1.5 2-2 4-2 6.5 0 1.7.7 2.5 2 2.5v7" /></>),
  body: () => svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M12 8.5v3.5" /><path d="M8.5 8.5v2" /><path d="M15.5 8.5v2" /><circle cx="12" cy="15" r="1.2" /></>),
  train: () => svg(<><path d="M6.5 8v8" /><path d="M17.5 8v8" /><path d="M3.5 10v4" /><path d="M20.5 10v4" /><path d="M6.5 12h11" /></>),
  chart: () => svg(<><path d="M4 19.5V4.5" /><path d="M4 19.5h16" /><path d="M7.5 16l3.5-4.5 3 2.5L20 7" /></>),
  plus: () => svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  close: () => svg(<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>),
  search: () => svg(<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>),
  barcode: () => svg(<><path d="M4 6v12" /><path d="M7.5 6v12" /><path d="M11 6v12" /><path d="M14.5 6v12" /><path d="M17 6v12" /><path d="M20 6v12" /></>),
  trash: () => svg(<><path d="M4.5 6.5h15" /><path d="M9 6.5V4.5h6v2" /><path d="M6.5 6.5 7.5 20h9l1-13.5" /></>),
  gear: () => svg(<><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.5 1.5M7.5 16.5 6 18M18 18l-1.5-1.5M7.5 7.5 6 6" /></>),
  chevron: () => svg(<path d="m9 5 7 7-7 7" />),
  left: () => svg(<path d="m15 5-7 7 7 7" />),
  star: () => svg(<path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z" />),
  check: () => svg(<path d="m5 12.5 4.5 4.5L19 7" />),
  bluetooth: () => svg(<><path d="M7 8.5 17 15.5 12 19V5l5 3.5L7 15.5" /></>),
  edit: () => svg(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m14.5 5.5 4 4" /></>),
}

/* ---------------------------------------------------------------- sheet */

export function Sheet({
  title,
  onClose,
  children,
  action,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  action?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    // Freeze the page behind the sheet so scroll does not chain through.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="sheet-head">
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon.close />
          </button>
          <h2 className="grow truncate">{title}</h2>
          {action}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- inputs */

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="tiny muted">{hint}</div>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="scroll-x" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          className="chip"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Autofocuses on mount — used for the food search box so typing starts at once. */
export function AutoFocus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('input')?.focus()
  }, [])
  return <div ref={ref}>{children}</div>
}

/* ---------------------------------------------------------------- meters */

export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="meter">
      <span style={{ width: `${pct}%`, background: color ?? 'var(--accent)' }} />
    </div>
  )
}

/**
 * A number field that behaves.
 *
 * Two problems with binding a number straight to an input. Clearing it yields
 * 0, which renders as "0", so the next keystroke gives "064" — the zero cannot
 * be deleted. And a bare box gives no clue whether it wants grams, millilitres
 * or a count.
 *
 * So the text is held as text while being edited and only converted on the way
 * out, and the unit is shown inside the field.
 */
export function NumberInput({
  value,
  onChange,
  unit,
  placeholder,
  step,
  autoFocus,
  selectOnFocus = true,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  unit?: string
  placeholder?: string
  step?: string
  autoFocus?: boolean
  selectOnFocus?: boolean
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [editing, setEditing] = useState(false)

  // While typing, the text is the truth; otherwise follow the value in.
  useEffect(() => {
    if (!editing) setText(value === undefined ? '' : String(value))
  }, [value, editing])

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        step={step}
        onFocus={(e) => {
          setEditing(true)
          if (selectOnFocus) e.target.select()
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          // Digits, one separator, optional minus — anything else is a typo.
          const next = e.target.value.replace(/[^0-9.,-]/g, '')
          setText(next)
          const parsed = parseFloat(next.replace(',', '.'))
          onChange(next.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed)
        }}
        style={unit ? { paddingRight: 34 } : undefined}
      />
      {unit && (
        <span
          className="tiny muted"
          style={{
            position: 'absolute',
            right: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
        >
          {unit}
        </span>
      )}
    </div>
  )
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
