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

/**
 * The Monday that begins the week a date falls in.
 *
 * A rolling seven days and a week are different questions. "Sessions this
 * week" asked on a Monday morning should be about the week that just began,
 * not about the seven days ending today — which still hold most of last week
 * and make a fresh week open with four sessions already on it.
 */
export function startOfWeek(s: ISODate): ISODate {
  const d = fromISODate(s)
  // getDay() is 0 on Sunday, which belongs to the week that started six days
  // earlier rather than the one about to start.
  const back = (d.getDay() + 6) % 7
  return addDays(s, -back)
}
