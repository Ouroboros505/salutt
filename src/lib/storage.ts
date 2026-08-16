import { db } from '../db/db'

export interface StorageStatus {
  /** True once the browser promises not to evict this data under pressure. */
  persistent: boolean
  /** Whether persistence could even be requested here. */
  supported: boolean
  usageBytes: number | null
  quotaBytes: number | null
  rows: { entries: number; weighIns: number; workouts: number; measurements: number; foods: number }
  daysLogged: number
}

export async function storageStatus(): Promise<StorageStatus> {
  const supported = !!navigator.storage?.persist
  let persistent = false
  if (navigator.storage?.persisted) {
    try {
      persistent = await navigator.storage.persisted()
    } catch {
      persistent = false
    }
  }

  let usageBytes: number | null = null
  let quotaBytes: number | null = null
  if (navigator.storage?.estimate) {
    try {
      const e = await navigator.storage.estimate()
      usageBytes = e.usage ?? null
      quotaBytes = e.quota ?? null
    } catch {
      // Not available everywhere; the row counts below are the real story.
    }
  }

  const [entries, weighIns, workouts, measurements, foods] = await Promise.all([
    db.entries.count(),
    db.weighIns.count(),
    db.workouts.count(),
    db.measurements.count(),
    db.foods.count(),
  ])

  const days = new Set((await db.entries.orderBy('date').keys()) as unknown as string[])

  return {
    persistent,
    supported,
    usageBytes,
    quotaBytes,
    rows: { entries, weighIns, workouts, measurements, foods },
    daysLogged: days.size,
  }
}

/** Asks again for persistent storage; installed apps are usually granted it. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * Whether a backup is overdue.
 *
 * There is no server copy, so the exported file is the only thing standing
 * between a cleared browser and losing the log. Nagging starts only once there
 * is something worth losing.
 */
export function backupOverdue(lastBackup: number | undefined, daysLogged: number): boolean {
  if (daysLogged < 3) return false
  if (!lastBackup) return true
  return Date.now() - lastBackup > 14 * 86400000
}

export function formatBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
