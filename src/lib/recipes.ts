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
/**
 * How the pot was run, and what fraction of the raw weight that boils away.
 *
 * Only evaporation counts. Water the meat gives up does not leave a covered
 * pot — it ends up in the sauce and is still in the box at lunchtime — which
 * is why these are far smaller than the yield tables for a roasted joint.
 */
export const COOK_STYLES: { label: string; loss: number }[] = [
  { label: 'Lid on the whole time', loss: 0.08 },
  { label: 'Lid off some of the time', loss: 0.2 },
  { label: 'Reduced right down', loss: 0.35 },
  { label: 'Nothing cooked off', loss: 0 },
]

export function finishedWeight(recipe: Pick<Recipe, 'items' | 'cookedG' | 'cookLossPct'>): number {
  if (recipe.cookedG > 0) return recipe.cookedG
  const raw = recipeTotals(recipe.items).grams
  // Nothing weighed: take the raw total less whatever evaporated.
  const loss = Math.min(0.6, Math.max(0, (recipe.cookLossPct ?? 0) / 100))
  return raw * (1 - loss)
}

/** Macros per 100 g of the finished dish — what a portion is scaled from. */
export function per100(recipe: Pick<Recipe, 'items' | 'cookedG' | 'cookLossPct'>): Totals {
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
export function portion(recipe: Pick<Recipe, 'items' | 'cookedG' | 'cookLossPct'>, grams: number): Totals {
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
 * Densities measured, not guessed.
 *
 * Derived from 3,860 cup-weight measurements in USDA's portion data: a food
 * that records "1 cup = 240 g" is stating a density of 240/236.6 g/ml. Each
 * figure is the median for its category, and `spread` is the interquartile
 * half-width — how much real dishes of that kind actually vary.
 *
 * Checking this mattered. Two earlier estimates were badly wrong: cooked pasta
 * in sauce is dense (1.05), not loose (0.75), and chunky meat and veg is far
 * airier (0.57) than the 0.85 assumed. On a 750 ml box those were errors of
 * 29% and 49% — several hundred calories a lunch, every day of the week.
 */
export const DISH_TYPES: { label: string; density: number; spread: number }[] = [
  { label: 'Pasta dish', density: 1.05, spread: 0.05 },
  { label: 'Soup or broth', density: 1.04, spread: 0.02 },
  { label: 'Stew, chilli, curry', density: 1.03, spread: 0.11 },
  { label: 'Dense, mince or casserole', density: 0.95, spread: 0.2 },
  { label: 'Rice or grain based', density: 0.84, spread: 0.19 },
  { label: 'Beans or legumes', density: 0.76, spread: 0.11 },
  { label: 'Chunky meat and veg', density: 0.57, spread: 0.19 },
  { label: 'Leafy salad', density: 0.38, spread: 0.12 },
]

/** The measured variability of whichever category a density came from. */
export function spreadFor(density: number | undefined): number {
  if (!density) return 0.15
  const match = DISH_TYPES.find((t) => Math.abs(t.density - density) < 0.005)
  return match?.spread ?? 0.15
}

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

/* ------------------------------------------------------------------ the box */

/**
 * A lunch box is rarely one dish. Ours is usually a block of whatever was
 * meal-prepped filling most of it and a starch filling the rest, and the two
 * have quite different densities — 70% of a 750 ml box in stew weighs half as
 * much again as the same volume of rice. Splitting the box by eye is easy;
 * converting each share to grams is not, so that is done here.
 */
export type BoxPart = {
  key: string
  name: string
  /** Share of the container, 0-100. */
  pct: number
  /** g per ml for this component specifically. */
  density: number
  per100: Totals
  recipeId?: number
  foodId?: number
  /** True when the density came from a measurement, not a family average. */
  measured?: boolean
  /**
   * Volume × density is a real estimate with real error. When a batch was
   * weighed and you know how many lunches it was split into, division gives
   * the exact weight instead — no density, no guessing at how full the box is.
   */
  batchGrams?: number
  lunches?: number
}

/** Grams of one component, from its share of the box. */
export function partGrams(part: Pick<BoxPart, 'pct' | 'density' | 'batchGrams' | 'lunches'>, boxMl: number): number {
  if (part.batchGrams && part.lunches && part.lunches > 0) {
    return Math.round(part.batchGrams / part.lunches)
  }
  if (!(boxMl > 0) || !(part.density > 0)) return 0
  return Math.round((part.pct / 100) * boxMl * part.density)
}

/** Whether a part's weight is divided from a weighed batch or estimated. */
export function partIsExact(part: Pick<BoxPart, 'batchGrams' | 'lunches'>): boolean {
  return !!(part.batchGrams && part.lunches && part.lunches > 0)
}

/** The grams either side of a part's estimate, from its category spread. */
export function partError(part: BoxPart, boxMl: number): number {
  if (partIsExact(part)) return 0
  return Math.round(partGrams(part, boxMl) * spreadFor(part.density))
}

/**
 * A starting density from the name, so the common cases need no thought.
 * Everything here is a measured category density, not a guess at the food.
 */
export function guessDensity(name: string): number {
  const n = name.toLowerCase()
  const rules: [RegExp, number][] = [
    [/pasta|noodle|spaghetti|macaroni|penne|fusilli|lasagn/, 1.05],
    [/soup|broth|stock|conso/, 1.04],
    [/stew|chill?i|curry|sauce|braise|ragu|goulash/, 1.03],
    [/mince|casserole|shepherd|bolognese|meatloaf|mash/, 0.95],
    [/rice|quinoa|couscous|bulgur|barley|grain|oat|farro|millet/, 0.84],
    [/bean|lentil|chickpea|pea|legume|dal|dhal/, 0.76],
    [/salad|lettuce|spinach|greens|rocket|arugula|kale/, 0.38],
    [/chicken|beef|pork|turkey|fish|salmon|shrimp|meat|veg|broccoli|carrot/, 0.57],
  ]
  for (const [re, d] of rules) if (re.test(n)) return d
  // Cooked mixed dishes cluster here when nothing else matches.
  return 0.95
}

export function boxTotals(parts: BoxPart[], boxMl: number): Totals & { grams: number; pct: number } {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, grams: 0, pct: 0 }
  for (const p of parts) {
    const g = partGrams(p, boxMl)
    const f = g / 100
    out.kcal += p.per100.kcal * f
    out.protein += p.per100.protein * f
    out.carbs += p.per100.carbs * f
    out.fat += p.per100.fat * f
    out.fiber += p.per100.fiber * f
    out.grams += g
    out.pct += p.pct
  }
  return out
}

/* ------------------------------------------------- density from ingredients */

const ML_PER: Record<string, number> = {
  cup: 236.588,
  tbsp: 14.787,
  tablespoon: 14.787,
  tsp: 4.929,
  teaspoon: 4.929,
  'fl oz': 29.574,
  floz: 29.574,
  ml: 1,
  liter: 1000,
  litre: 1000,
  quart: 946.35,
  pint: 473.18,
}

const VOLUME_LABEL = /^([\d.]*)\s*(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|fl ozs?|flozs?|ml|liters?|litres?|quarts?|pints?)\b/i

/**
 * Packed density of a single ingredient, from a measured volume portion.
 *
 * A cup is a fixed volume, so a USDA cup weight is a density measurement -
 * and it is the *packed* density, air gaps included, which is exactly what a
 * container of it weighs. Far better than assigning the whole dish to a
 * category by eye. Weight-based portions (oz, lb, "1 breast") say nothing
 * about volume and are skipped.
 */
export function densityFromPortions(portions: { label: string; grams: number }[]): number | null {
  for (const p of portions) {
    const m = VOLUME_LABEL.exec(p.label.trim())
    if (!m) continue
    // USDA labels many portions as a bare "cup", meaning one of them.
    const count = m[1] ? parseFloat(m[1]) : 1
    const unit = m[2].toLowerCase().replace(/s$/, '')
    const ml = count * (ML_PER[unit] ?? ML_PER[unit.replace(/s$/, '')] ?? 0)
    if (!(ml > 0) || !(p.grams > 0)) continue
    const d = p.grams / ml
    // Outside this range it is a mislabelled portion, not a food.
    if (d > 0.05 && d < 2) return d
  }
  return null
}

/**
 * Why a recipe's density is not summed from its ingredients.
 *
 * It was tried. Per-ingredient figures from the database are *packed*
 * densities — a cup of diced pork is 0.57 g/ml because half of it is air.
 * Adding those volumes counts the gaps as real volume, but in anything with
 * a sauce the liquid fills them, so the sum reads a third low: 0.67 g/ml
 * against the 0.94-1.08 that USDA measures for chilli, curry and chunky
 * soup. On 70% of a 750 ml box that is a 265 g error, worth some 400 kcal.
 *
 * So a dish keeps its measured category density, which was taken from whole
 * cooked dishes and already includes the packing. The way past the estimate
 * is not a cleverer model but a single weighing — see calibratedDensity.
 */
export function calibratedDensity(fullBoxGrams: number, boxMl: number): number | null {
  if (!(fullBoxGrams > 0) || !(boxMl > 0)) return null
  const d = fullBoxGrams / boxMl
  return d > 0.2 && d < 1.6 ? Math.round(d * 1000) / 1000 : null
}
