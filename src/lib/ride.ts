/**
 * Riding as transport.
 *
 * Getting everywhere by bike is not a workout in the sense of a session you
 * decided to do, but it is a large part of a day's movement — twenty minutes
 * each way is a fifth of a day's calories — and it varies: some days campus,
 * some days nothing, some days across town to a friend's.
 *
 * The calories are shown but never added to the day's target. The target comes
 * from intake measured against the weight trend, and that measurement was
 * taken while all this riding was already happening, so adding it back would
 * count it twice and quietly cancel the deficit.
 */

/** Metabolic equivalents, from the Compendium of Physical Activities. */
export const RIDE_EFFORTS: { label: string; hint: string; met: number }[] = [
  { label: 'Easy', hint: 'flat, unhurried, in normal clothes', met: 5.8 },
  { label: 'Normal', hint: 'getting somewhere, a bit of effort', met: 8.5 },
  { label: 'Hard', hint: 'hills, hurrying, or loaded with shopping', met: 10.5 },
]

/**
 * Speed bands for cycling, which is what the Compendium actually measures.
 *
 * Given a distance and a time, the effort stops being a judgement: air
 * resistance rises with the cube of speed, so how fast you went determines
 * the cost far more reliably than how hard it felt. "Easy" and "hard" are
 * guesses about your own exertion; 21 km/h is a fact.
 */
const SPEED_BANDS: { maxKmh: number; met: number }[] = [
  { maxKmh: 16, met: 4 },
  { maxKmh: 19, met: 6.8 },
  { maxKmh: 22, met: 8 },
  { maxKmh: 25, met: 10 },
  { maxKmh: 30, met: 12 },
  { maxKmh: Infinity, met: 15.8 },
]

/**
 * A knobbly-tyred bike on rough ground costs more than the same speed on a
 * road bike, and commuting speed is dragged down by junctions and lights
 * without the effort falling to match. Both push the same way.
 */
export const TERRAIN_BUMP = 1.15

/**
 * Commuting has its own value in the Compendium — 6.8, self-selected pace —
 * and pointedly it is not derived from speed. Average speed across a town ride
 * includes the time spent standing at lights, when the clock runs and the legs
 * do not, so it reads far too low: 4.3 km in 20 minutes averages 12.9 km/h and
 * lands in the leisure band, which is not what riding up a hill between
 * junctions costs.
 */
export const COMMUTE_MET = 6.8

export type RideStyle = 'commute' | 'steady'

export function metFromSpeed(
  km: number,
  minutes: number,
  style: RideStyle = 'commute',
  roughGround = true,
): { kmh: number; met: number; fromSpeed: boolean } | null {
  if (!(km > 0) || !(minutes > 0)) return null
  const kmh = (km / minutes) * 60
  // Outside this range it is a typo, not a bike ride.
  if (kmh < 3 || kmh > 60) return null

  // A ride with no stops is measured by its speed; a stop-start one cannot be.
  const band = SPEED_BANDS.find((b) => kmh <= b.maxKmh)!
  const base = style === 'steady' ? band.met : Math.max(COMMUTE_MET, band.met)
  const met = roughGround ? base * TERRAIN_BUMP : base
  return {
    kmh: Math.round(kmh * 10) / 10,
    met: Math.round(met * 10) / 10,
    fromSpeed: style === 'steady' || band.met > COMMUTE_MET,
  }
}

/**
 * A MET is a multiple of resting metabolism, and resting is about
 * 3.5 ml of oxygen per kg per minute, which is 5 kcal per litre — so the
 * conversion is met × 3.5 × kg / 200 kcal a minute.
 */
export function rideKcal(met: number, kg: number, minutes: number): number {
  if (!(kg > 0) || !(minutes > 0)) return 0
  return Math.round((met * 3.5 * kg * minutes) / 200)
}

/** Places worth a button, because they are where the riding actually goes. */
export const RIDE_PLACES = ['Campus', 'Work', 'Groceries', 'Gym', "Friend's", 'Errands']
