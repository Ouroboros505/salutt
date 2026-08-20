/**
 * A ride in progress, held as a start time rather than a running clock.
 *
 * The whole point is to survive the phone being locked and pocketed and the
 * app being killed by the OS mid-ride. A counter would die with the app; a
 * stored start timestamp does not, because the elapsed time is two clock
 * readings subtracted when you come back, never a tally kept while away. So
 * everything here is a plain value in localStorage and nothing runs in the
 * background.
 */
export interface LiveRide {
  startedAt: number
  place?: string
  routeId?: number
  km?: number
  climbM?: number
  loadKg?: number
}

const KEY = 'salutt:live-ride'

export function getLiveRide(): LiveRide | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as LiveRide
    return typeof r.startedAt === 'number' ? r : null
  } catch {
    return null
  }
}

export function setLiveRide(r: LiveRide): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r))
  } catch {
    /* storage full or blocked; the ride just cannot be timed this once */
  }
}

export function clearLiveRide(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear is fine */
  }
}

/** Whole minutes since the ride started — at least 1, from the clock. */
export function liveMinutes(r: LiveRide, now: number): number {
  return Math.max(1, Math.round((now - r.startedAt) / 60000))
}
