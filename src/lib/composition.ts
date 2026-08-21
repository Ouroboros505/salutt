import type { WeighIn } from '../db/db'

/**
 * The scale's derived numbers, and how much to trust their movement.
 *
 * A foot-to-foot bioimpedance scale measures two things — your weight and the
 * electrical resistance of your body — and computes everything else from a
 * model. So these are not ten independent readings; they are two, dressed up.
 * When water shifts (a salty meal, a hard session, the time of day), resistance
 * shifts, and the model reads the change as fat and lean moving. That is the
 * noise, and it swamps a week of real change.
 *
 * Two different errors matter, and they are not the same thing:
 *
 *  - Accuracy — how far the number sits from the truth. Bioimpedance reads body
 *    fat about four points low against a DEXA scan, and over-reads lean mass by
 *    a couple of kilograms. But that offset is roughly constant, so it shifts
 *    the whole line up or down without bending it. It barely touches a trend.
 *
 *  - Precision — how much the number wanders between two mornings with no real
 *    change underneath. This is the one that decides whether a wobble in the
 *    graph means anything, and it is mostly hydration. The `noiseSd` below is a
 *    one-standard-deviation, day-to-day figure for a consumer foot-to-foot
 *    scale, drawn from the bioimpedance reliability literature (≈±1–1.5 points
 *    of body fat, ≈±0.6 kg of lean mass, dominated by water).
 *
 * The band drawn on each chart is ±1 SD of this precision. Read the direction
 * of the line across weeks, not the height of any single dot inside its band.
 */
export interface CompMetric {
  key: keyof WeighIn
  label: string
  unit: string
  group: 'fat' | 'lean' | 'water' | 'derived'
  /** Decimal places to show. */
  dp: number
  /** Day-to-day precision, one standard deviation, in the metric's own unit. */
  noiseSd: number
  /** Which direction is progress on a cut, for colouring the net change. */
  good: 'down' | 'up' | 'none'
  blurb: string
}

export const COMP_METRICS: CompMetric[] = [
  { key: 'bodyFatPct', label: 'Body fat', unit: '%', group: 'fat', dp: 1, noiseSd: 1.3, good: 'down',
    blurb: 'The headline number, and the noisiest — hydration alone moves it ±1–1.5 points.' },
  { key: 'subcutaneousFatPct', label: 'Subcutaneous fat', unit: '%', group: 'fat', dp: 1, noiseSd: 1.0, good: 'down',
    blurb: 'Fat just under the skin — the part you can see and pinch.' },
  { key: 'visceralFat', label: 'Visceral fat', unit: '', group: 'fat', dp: 0, noiseSd: 1.0, good: 'down',
    blurb: 'A whole-number rating, so it only moves in steps of one — very coarse.' },
  { key: 'muscleKg', label: 'Muscle mass', unit: 'kg', group: 'lean', dp: 2, noiseSd: 0.6, good: 'up',
    blurb: 'Water-heavy tissue, so it rises and falls with hydration more than with real muscle.' },
  { key: 'fatFreeKg', label: 'Fat-free mass', unit: 'kg', group: 'lean', dp: 2, noiseSd: 0.6, good: 'up',
    blurb: 'Everything that is not fat. On a cut you want this held, not climbing.' },
  { key: 'skeletalMusclePct', label: 'Skeletal muscle', unit: '%', group: 'lean', dp: 1, noiseSd: 0.7, good: 'up',
    blurb: 'Muscle as a share of body weight — rises just by losing fat around it.' },
  { key: 'proteinPct', label: 'Protein', unit: '%', group: 'lean', dp: 1, noiseSd: 0.3, good: 'up',
    blurb: 'Among the steadier readings, but still derived from the same two measurements.' },
  { key: 'boneKg', label: 'Bone', unit: 'kg', group: 'lean', dp: 2, noiseSd: 0.1, good: 'none',
    blurb: 'Nearly fixed — it should barely move, so treat any drift as noise.' },
  { key: 'waterPct', label: 'Body water', unit: '%', group: 'water', dp: 1, noiseSd: 0.9, good: 'none',
    blurb: 'The thing actually being measured, more or less. Higher after drinking, lower when dry.' },
  { key: 'bmrKcal', label: 'BMR', unit: 'kcal', group: 'derived', dp: 0, noiseSd: 20, good: 'none',
    blurb: 'Computed straight from your mass, so its line just shadows your weight.' },
]

export const GROUP_COLOR: Record<CompMetric['group'], string> = {
  fat: 'var(--series-2)',
  lean: 'var(--series-1)',
  water: 'var(--series-5)',
  derived: 'var(--text-muted)',
}

export interface CompPoint {
  date: string
  value: number
}

/** The readings for one metric within a window, oldest first. */
export function compSeries(weighIns: WeighIn[], key: keyof WeighIn, fromDate: string): CompPoint[] {
  return weighIns
    .filter((w) => w.date >= fromDate && w[key] != null && !w.offProtocol)
    .map((w) => ({ date: w.date, value: w[key] as number }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The smallest change across the window that stands out from the noise.
 *
 * Two readings each carry the same day-to-day error, so their difference has a
 * standard deviation of SD·√2. The 95% "least significant change" — the
 * threshold monitoring studies use before calling a change real rather than
 * noise — is 1.96·SD·√2, about 2.77·SD.
 */
export function leastSignificantChange(sd: number): number {
  return 2.77 * sd
}

export interface CompVerdict {
  first: number
  last: number
  delta: number
  lsc: number
  /** True when the net change across the window clears the noise threshold. */
  signal: boolean
}

export function verdict(points: CompPoint[], sd: number): CompVerdict | null {
  if (points.length < 2) return null
  const first = points[0].value
  const last = points[points.length - 1].value
  const delta = last - first
  const lsc = leastSignificantChange(sd)
  return { first, last, delta, lsc, signal: Math.abs(delta) >= lsc }
}
