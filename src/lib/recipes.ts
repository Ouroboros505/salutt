import type { Recipe, RecipeItem } from '../db/db'
import type { Totals } from '../db/ops'

/**
 * Recipe maths.
 *
 * A recipe is ingredients plus the weight of the finished dish. Everything
 * else follows from those two, and the finished weight is the part that has to
 * be measured rather than computed — cooking drives off water, so a tray made
 * from 2.4 kg of ingredients might come out at 1.9 kg, and its food is
 * correspondingly more concentrated per gram.
 */

export function recipeTotals(items: RecipeItem[]): Totals & { grams: number } {
  return items.reduce(
    (t, i) => ({
      grams: t.grams + i.grams,
      kcal: t.kcal + i.kcal,
      protein: t.protein + i.protein,
      carbs: t.carbs + i.carbs,
      fat: t.fat + i.fat,
      fiber: t.fiber + i.fiber,
    }),
    { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  )
}

/** Weight the portions are measured against. */
export function finishedWeight(recipe: Pick<Recipe, 'items' | 'cookedG'>): number {
  return recipe.cookedG > 0 ? recipe.cookedG : recipeTotals(recipe.items).grams
}

/** Macros per 100 g of the finished dish — what a portion is scaled from. */
export function per100(recipe: Pick<Recipe, 'items' | 'cookedG'>): Totals {
  const totals = recipeTotals(recipe.items)
  const weight = finishedWeight(recipe)
  if (weight <= 0) return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  const f = 100 / weight
  return {
    kcal: totals.kcal * f,
    protein: totals.protein * f,
    carbs: totals.carbs * f,
    fat: totals.fat * f,
    fiber: totals.fiber * f,
  }
}

/** Macros for a given weight of the finished dish. */
export function portion(recipe: Pick<Recipe, 'items' | 'cookedG'>, grams: number): Totals {
  const p = per100(recipe)
  const f = grams / 100
  const r = (v: number) => Math.round(v * f * 10) / 10
  return {
    kcal: Math.round(p.kcal * f),
    protein: r(p.protein),
    carbs: r(p.carbs),
    fat: r(p.fat),
    fiber: r(p.fiber),
  }
}

/** Grams in one serving, when the dish was divided into a known number. */
export function servingGrams(recipe: Pick<Recipe, 'items' | 'cookedG' | 'servings'>): number | null {
  if (!recipe.servings || recipe.servings <= 0) return null
  const weight = finishedWeight(recipe)
  return weight > 0 ? Math.round(weight / recipe.servings) : null
}

/**
 * How much weight cooking removed, as a percentage.
 *
 * Shown because an implausible number here is the likeliest mistake in a
 * recipe — entering the raw total as the cooked weight, or mistyping a zero.
 */
export function waterLossPct(recipe: Pick<Recipe, 'items' | 'cookedG'>): number | null {
  const raw = recipeTotals(recipe.items).grams
  if (!recipe.cookedG || raw <= 0) return null
  return ((raw - recipe.cookedG) / raw) * 100
}

/**
 * Typical densities, for estimating a box weight when it was never measured.
 *
 * Real dishes vary by roughly ±15% within any of these categories, which on a
 * 750 ml box is over 100 g — worth around 150 kcal on a single lunch. Useful
 * as a starting point, no substitute for weighing one box once.
 */
export const DISH_TYPES: { label: string; density: number }[] = [
  { label: 'Soup or broth', density: 1.0 },
  { label: 'Stew, chilli, curry', density: 0.95 },
  { label: 'Dense, mince or casserole', density: 1.05 },
  { label: 'Meat and veg, little sauce', density: 0.85 },
  { label: 'Rice or grain based', density: 0.8 },
  { label: 'Pasta dish', density: 0.75 },
  { label: 'Leafy salad', density: 0.35 },
]

export type BoxEstimate = {
  grams: number
  /** Counted boxes are exact; a density is a guess with real error attached. */
  source: 'counted' | 'estimated'
}

/**
 * Grams in one full container.
 *
 * Preferred route needs no weighing at lunchtime and no density at all: the
 * batch was weighed once, and how many boxes it filled is something you know
 * by counting. Falling back to volume × density is offered because the box
 * count is not always known, but it is markedly less accurate.
 */
export function boxWeight(
  recipe: Pick<Recipe, 'items' | 'cookedG' | 'containers' | 'containerMl' | 'density'>,
): BoxEstimate | null {
  if (recipe.containers && recipe.containers > 0) {
    const weight = finishedWeight(recipe)
    if (weight > 0) return { grams: weight / recipe.containers, source: 'counted' }
  }
  if (recipe.density && recipe.containerMl) {
    return { grams: recipe.density * recipe.containerMl, source: 'estimated' }
  }
  return null
}

/** How many boxes the batch should fill, given a density. Lets you check. */
export function estimatedBoxes(
  recipe: Pick<Recipe, 'items' | 'cookedG' | 'containerMl' | 'density'>,
): number | null {
  if (!recipe.density || !recipe.containerMl) return null
  const weight = finishedWeight(recipe)
  if (weight <= 0) return null
  return weight / (recipe.density * recipe.containerMl)
}

export function gramsPerContainer(
  recipe: Pick<Recipe, 'items' | 'cookedG' | 'containers' | 'containerMl' | 'density'>,
): number | null {
  return boxWeight(recipe)?.grams ?? null
}

/**
 * Apparent density, only for sanity-checking the numbers entered.
 *
 * Cooked mixed dishes land near 0.8–1.1 g/ml. Well outside that usually means
 * the cooked weight or the container size is wrong, which is worth saying
 * before every future lunch is logged off a bad figure.
 */
export function containerDensity(
  recipe: Pick<Recipe, 'items' | 'cookedG' | 'containers' | 'containerMl'>,
): number | null {
  const grams = gramsPerContainer(recipe)
  if (grams === null || !recipe.containerMl || recipe.containerMl <= 0) return null
  return grams / recipe.containerMl
}
