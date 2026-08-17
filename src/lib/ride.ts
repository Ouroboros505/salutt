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
