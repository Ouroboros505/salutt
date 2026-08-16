/**
 * Body composition derived from weight + bioelectrical impedance.
 *
 * The scale only ever reports two numbers: weight and impedance in ohms.
 * Everything else — body fat, muscle, water, visceral fat — is *derived* by the
 * app, and each vendor pairs its scales with a specific derivation algorithm.
 *
 * This is a faithful port of the algorithm the VeSync app uses for the ESF-551,
 * so Salutt's numbers match what VeSync would have shown for the same reading.
 * Ported from the `etekcity_esf551_ble` project's reverse-engineered
 * implementation: https://github.com/ronnnnnnnnnnnnn/etekcity_esf551_ble
 *
 * Treat the absolute values with suspicion — consumer impedance scales are
 * sensitive to hydration, time of day and foot moisture, and are easily several
 * points off. The *direction over weeks* is the part worth reading.
 */

import { pyRound as round } from './round'

export type Sex = 'male' | 'female'

export interface BodyComposition {
  bmi: number
  bodyFatPct: number
  fatFreeKg: number
  subcutaneousFatPct: number
  visceralFat: number
  waterPct: number
  bmrKcal: number
  skeletalMusclePct: number
  muscleKg: number
  boneKg: number
  proteinPct: number
}

export function bodyComposition(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: Sex,
  impedance: number,
  athlete = false,
): BodyComposition | null {
  if (!(weightKg > 0) || !(heightCm > 0) || !(impedance > 0)) return null

  // Index 0 = male, 1 = female throughout, matching the source algorithm.
  const s = sex === 'male' ? 0 : 1
  const height = heightCm / 100

  // Note the floor: the algorithm feeds this truncated BMI into body fat, so
  // rounding differently here would shift every downstream metric.
  const bmi = Math.floor((weightKg / (height * height)) * 100) / 100

  let bfp =
    [0.103, 0.097][s] * age + [1.524, 1.545][s] * bmi - 500 / impedance - [22, 12.7][s]
  if (athlete) {
    bfp = bfp / [3.5, 3.0][s] + bmi / [3.0, 2.4][s]
  }
  const bodyFatPct = Math.max(5, Math.min(75, Math.floor(bfp * 10) / 10))

  const fatFreeKg = round(weightKg * (1 - bodyFatPct / 100), 2)

  const visceralFat = Math.max(
    1,
    Math.min(
      30,
      Math.trunc(
        [0.8666, 0.8895][s] * bmi +
          [0.0082, 0.0943][s] * bodyFatPct +
          [0.026, -0.0534][s] * (weightKg - fatFreeKg) -
          [14.2692, 16.215][s],
      ),
    ),
  )

  const subcutaneousFatPct = round(
    [0.965, 0.983][s] * bodyFatPct - [0.22, 0.303][s] * visceralFat,
    1,
  )

  // The same small fat-free offset stands in for bone mass in several formulas.
  const ff1 = Math.max(1, [0.05, 0.06][s] * fatFreeKg)

  const waterPct = Math.max(
    10,
    Math.min(80, round(([0.76, 0.73][s] * (fatFreeKg - ff1)) / weightKg * 100, 1)),
  )

  const bmrKcal = Math.max(900, Math.min(2500, Math.trunc(fatFreeKg * 21.6 + 370)))

  const skeletalMusclePct = round(
    ([0.68, 0.62][s] * (fatFreeKg - ff1)) / weightKg * 100,
    1,
  )

  const muscleKg = round(fatFreeKg - ff1, 2)
  const boneKg = Math.max(1, round([0.05, 0.06][s] * fatFreeKg, 2))

  const proteinPct = Math.max(
    5,
    round(100 - [1, 1.05][s] * bodyFatPct - (boneKg / weightKg) * 100 - waterPct, 1),
  )

  return {
    bmi,
    bodyFatPct,
    fatFreeKg,
    subcutaneousFatPct,
    visceralFat,
    waterPct,
    bmrKcal,
    skeletalMusclePct,
    muscleKg,
    boneKg,
    proteinPct,
  }
}

/** Rough interpretation bands for body fat %, for men and women (ACE-style). */
export function bodyFatBand(pct: number, sex: Sex): string {
  const bands: [number, string][] =
    sex === 'male'
      ? [
          [6, 'essential'],
          [14, 'athletic'],
          [18, 'fitness'],
          [25, 'average'],
          [Infinity, 'above average'],
        ]
      : [
          [14, 'essential'],
          [21, 'athletic'],
          [25, 'fitness'],
          [32, 'average'],
          [Infinity, 'above average'],
        ]
  return bands.find(([limit]) => pct < limit)![1]
}
