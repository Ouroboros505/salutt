import type { Food } from '../db/db'

/**
 * Which foods earn a star.
 *
 * Protein per 100 kcal, and nothing else. It reads oddly next to the usual
 * per-100-g habit, but per 100 g answers "how concentrated is this", which is
 * not the question a cut asks. The question is what a gram of protein costs in
 * energy, because energy is the thing in short supply and protein is the thing
 * that has to be hit anyway. A pot of yoghurt and a can of whey water look
 * nothing alike per gram and are near twins per calorie.
 *
 * Pure protein is 25 g per 100 kcal, so the scale has a ceiling and 15 sits at
 * three fifths of it. Chicken breast is 18.8, ordinary Greek yoghurt 17.6, a
 * protein bar 8.8. Drawing the line at 15 keeps the badge on the handful of
 * foods that genuinely make the day's protein cheap, which is the only reason
 * to mark anything: a star on everything marks nothing.
 *
 * Deliberately not a judgement of whether a food is good. Salmon misses on
 * this measure and is still worth eating for its fats; the melon misses by
 * miles and is the best thing in the fridge at ten at night. The badge answers
 * one question, and the wording in the tooltip says which.
 */
export const STANDOUT_PROTEIN_PER_100_KCAL = 15

/** Grams of protein per 100 kcal, or null when there is no energy to divide by. */
export function proteinPer100Kcal(food: Pick<Food, 'kcal' | 'protein'>): number | null {
  // Creatine and the like are logged at zero energy; the ratio is meaningless
  // rather than infinite, and a near-zero denominator makes noise look stellar.
  if (!(food.kcal >= 10)) return null
  return (food.protein / food.kcal) * 100
}

export function isStandoutProtein(food: Pick<Food, 'kcal' | 'protein'>): boolean {
  const d = proteinPer100Kcal(food)
  return d !== null && d >= STANDOUT_PROTEIN_PER_100_KCAL
}

/** What the star says when you hold it. */
export function standoutLabel(food: Pick<Food, 'kcal' | 'protein'>): string {
  const d = proteinPer100Kcal(food)
  return d === null ? '' : `${d.toFixed(1)} g of protein per 100 kcal — among the best you have`
}
