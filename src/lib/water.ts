import { db, type ISODate, type Settings } from '../db/db'

/** The bottle he refills, when settings have not said otherwise. */
export const DEFAULT_BOTTLE_ML = 591

export function bottleMlOf(settings: Pick<Settings, 'bottleMl'>): number {
  return settings.bottleMl ?? DEFAULT_BOTTLE_ML
}

/**
 * One tap, one bottle — and a negative delta takes one back.
 *
 * Shared between the Today tile and the button that floats over a session,
 * so the two can never disagree about what a tap is worth or which row it
 * lands in. Written as an upsert rather than an add so repeated taps do not
 * litter the table with a row each, and floored at zero so an over-eager
 * undo cannot leave the day owing water.
 */
export async function addBottle(date: ISODate, delta = 1): Promise<number> {
  const existing = await db.water.where('date').equals(date).first()
  const next = Math.max(0, (existing?.bottles ?? 0) + delta)
  if (existing?.id != null) await db.water.update(existing.id, { bottles: next, updatedAt: Date.now() })
  else await db.water.add({ date, bottles: next, createdAt: Date.now(), updatedAt: Date.now() })
  return next
}

/** "1.8 L" past a litre, "591 ml" below it. */
export function formatWater(bottles: number, bottleMl: number): { value: string; unit: string } {
  const ml = bottles * bottleMl
  return ml >= 1000 ? { value: (ml / 1000).toFixed(1), unit: 'L' } : { value: String(ml), unit: 'ml' }
}
