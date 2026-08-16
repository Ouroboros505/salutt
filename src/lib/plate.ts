import type { Totals } from '../db/ops'

/**
 * Logging a meal nobody weighed.
 *
 * A plate at a party, a work tray, a restaurant order: no recipe, no scale,
 * and no chance of one. What is available is the plate itself and a hand to
 * compare it against, which is enough — a palm of chicken is 100 g whoever
 * cooked it, and the error that leaves is far smaller than the error of not
 * logging the meal at all.
 *
 * Everything here is a generic stand-in, not the actual dish. That is the
 * point: the estimate is honest about being an estimate, and reports the range
 * rather than a figure that pretends to precision it has not got.
 */

export interface HandSize {
  label: string
  hint: string
  grams: number
}

export interface PlateChoice {
  label: string
  /** Per 100 g, from USDA generics for the commonest version of the thing. */
  per100: Totals
}

export interface PlateCategory {
  key: string
  label: string
  sizes: HandSize[]
  choices: PlateChoice[]
}

const t = (kcal: number, protein: number, carbs: number, fat: number, fiber: number): Totals => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber,
})

/**
 * Hand measures, in cooked grams.
 *
 * These are the standard portion heuristics dietitians use, and they scale
 * with the person: a bigger hand goes with a bigger body and a bigger
 * requirement, which is exactly the correlation you want in a rule of thumb.
 */
const MEAT_SIZES: HandSize[] = [
  { label: 'A deck of cards', hint: 'a small piece', grams: 85 },
  { label: 'Your palm', hint: 'no fingers, ~1.5 cm thick', grams: 100 },
  { label: 'Two palms', hint: 'a generous helping', grams: 200 },
]

const STARCH_SIZES: HandSize[] = [
  { label: 'A few forkfuls', hint: 'you barely touched it', grams: 40 },
  { label: 'A cupped hand', hint: 'a normal scoop', grams: 100 },
  { label: 'Two cupped hands', hint: 'a full side', grams: 200 },
]

const VEG_SIZES: HandSize[] = [
  { label: 'A serving spoon', hint: 'one scoop', grams: 70 },
  { label: 'A closed fist', hint: 'a proper portion', grams: 150 },
  { label: 'Half the plate', hint: 'piled up', grams: 250 },
]

const EXTRA_SIZES: HandSize[] = [
  { label: 'A thumb', hint: 'a little', grams: 15 },
  { label: 'Two thumbs', hint: 'a fair amount', grams: 30 },
  { label: 'Covered in it', hint: 'sauced or fried', grams: 60 },
]

export const PLATE: PlateCategory[] = [
  {
    key: 'protein',
    label: 'Meat or fish',
    sizes: MEAT_SIZES,
    choices: [
      { label: 'Chicken, lean', per100: t(165, 31, 0, 3.6, 0) },
      { label: 'Chicken, with skin', per100: t(232, 23.3, 0, 14.7, 0) },
      { label: 'Beef or pork', per100: t(240, 25.8, 0, 14.3, 0) },
      { label: 'Fish', per100: t(206, 22.1, 0, 12.4, 0) },
      { label: 'Beans or lentils', per100: t(132, 8.9, 23.7, 0.5, 8.7) },
    ],
  },
  {
    key: 'starch',
    label: 'Rice, potato, bread',
    sizes: STARCH_SIZES,
    choices: [
      { label: 'Rice', per100: t(130, 2.7, 28.2, 0.3, 0.4) },
      { label: 'Pasta', per100: t(158, 5.8, 30.9, 0.9, 1.8) },
      { label: 'Potato', per100: t(86, 1.7, 20, 0.1, 1.8) },
      { label: 'Bread', per100: t(270, 9.4, 49.2, 3.6, 2.3) },
      { label: 'Chips or fries', per100: t(312, 3.4, 41, 15, 3.8) },
    ],
  },
  {
    key: 'veg',
    label: 'Vegetables',
    sizes: VEG_SIZES,
    choices: [
      { label: 'Cooked vegetables', per100: t(65, 2.9, 13.1, 0.1, 4.4) },
      { label: 'Salad leaves', per100: t(17, 1.2, 3.2, 0.3, 1.8) },
    ],
  },
  {
    key: 'extra',
    label: 'Cheese, sauce, dressing',
    sizes: EXTRA_SIZES,
    choices: [
      { label: 'Cheese', per100: t(408, 23.3, 2.4, 34, 0) },
      { label: 'Creamy sauce or dressing', per100: t(350, 1.5, 6, 36, 0) },
      { label: 'Tomato or stock sauce', per100: t(70, 1.6, 9, 3, 1.2) },
    ],
  },
]

export interface PlateItem {
  key: string
  label: string
  grams: number
  per100: Totals
}

/**
 * Anything cooked for a crowd is cooked in fat, and it is the line people
 * leave out. A teaspoon is 40 kcal — usually more than the rice someone
 * skipped to be virtuous.
 */
export const OIL_PER100 = t(884, 0, 0, 100, 0)
export const OIL_GRAMS = 5

export function plateTotals(items: PlateItem[], oiled: boolean): Totals {
  const all = oiled ? [...items, { key: 'oil', label: 'Cooked in oil', grams: OIL_GRAMS, per100: OIL_PER100 }] : items
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  for (const i of all) {
    const f = i.grams / 100
    out.kcal += i.per100.kcal * f
    out.protein += i.per100.protein * f
    out.carbs += i.per100.carbs * f
    out.fat += i.per100.fat * f
    out.fiber += i.per100.fiber * f
  }
  return out
}

/**
 * How wrong this could be.
 *
 * Judging a portion by eye lands within about 30% for someone paying
 * attention, and the generic stand-in adds a little on top. Saying so is
 * worth more than a decimal place: it tells you when a meal is worth a second
 * thought and when it is inside the noise of the day.
 */
export function plateError(items: PlateItem[], oiled: boolean): number {
  return Math.round(plateTotals(items, oiled).kcal * 0.3)
}
