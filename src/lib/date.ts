import type { ISODate } from '../db/db'

/** Local calendar day as 'YYYY-MM-DD' — never UTC, or days flip at 7pm. */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = fromISODate(b).getTime() - fromISODate(a).getTime()
  return Math.round(ms / 86400000)
}

export function formatDay(s: ISODate): string {
  const today = todayISO()
  if (s === today) return 'Today'
  if (s === addDays(today, -1)) return 'Yesterday'
  if (s === addDays(today, 1)) return 'Tomorrow'
  const d = fromISODate(s)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatShort(s: ISODate): string {
  return fromISODate(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
