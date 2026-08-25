import { db, type Settings, type WeighIn } from '../db/db'
import { todayISO } from './date'
import { ageFrom } from './metrics'
import { bodyComposition } from './bodyComp'
import type { ScaleReading } from './scale'

/**
 * Writes a scale reading to today's weigh-in, deriving body composition when
 * impedance is present.
 *
 * One row per day: a second weighing overwrites rather than duplicating, so
 * saving eagerly costs nothing and there is never a pile of near-identical
 * entries to clean up.
 */
export async function saveReading(
  r: ScaleReading,
  settings: Settings,
  offProtocol = false,
  afterStool?: boolean,
): Promise<number> {
  const comp = r.impedance
    ? bodyComposition(
        r.kg,
        settings.heightCm,
        ageFrom(settings.birthDate),
        settings.sex,
        r.impedance,
        settings.athlete,
      )
    : null

  const date = todayISO()
  const existing = await db.weighIns.where('date').equals(date).first()

  const row: WeighIn & { updatedAt?: number } = {
    ...(existing?.id ? { id: existing.id } : {}),
    offProtocol: offProtocol || undefined,
    afterStool,
    date,
    kg: r.kg,
    impedance: r.impedance,
    source: 'scale',
    createdAt: Date.now(),
    // Stamped here rather than left to the table hook. This is a whole-object
    // put over an existing row, and a reading that reaches the server without
    // a stamp loses every merge it is ever part of.
    updatedAt: Date.now(),
    ...(comp
      ? {
          bodyFatPct: comp.bodyFatPct,
          fatFreeKg: comp.fatFreeKg,
          muscleKg: comp.muscleKg,
          boneKg: comp.boneKg,
          waterPct: comp.waterPct,
          proteinPct: comp.proteinPct,
          visceralFat: comp.visceralFat,
          subcutaneousFatPct: comp.subcutaneousFatPct,
          skeletalMusclePct: comp.skeletalMusclePct,
          bmrKcal: comp.bmrKcal,
        }
      : {}),
  }

  return (await db.weighIns.put(row)) as number
}

/**
 * Picks the frame worth keeping out of the stream a weigh-in produces.
 *
 * The scale sends the settling weight, then a stable weight, then repeats it
 * carrying impedance once the body-composition pass finishes. Keep the first
 * stable frame, but let a later one with impedance replace it.
 */
export function betterReading(prev: ScaleReading | null, next: ScaleReading): ScaleReading | null {
  if (!next.stable) return prev
  if (!prev) return next
  return next.impedance && !prev.impedance ? next : prev
}
