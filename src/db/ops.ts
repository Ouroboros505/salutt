import { db, type Entry, type Food, type ISODate, type Meal, type MealTemplate } from './db'
import type { FoodHit } from '../lib/foodApi'

export interface Totals {
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
}

export const ZERO: Totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }

export function sum(entries: Entry[]): Totals {
  return entries.reduce<Totals>(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      protein: t.protein + e.protein,
      carbs: t.carbs + e.carbs,
      fat: t.fat + e.fat,
      fiber: t.fiber + e.fiber,
    }),
    { ...ZERO },
  )
}

/** Scales a food's per-100 g macros to an actual portion. */
export function scale(food: Pick<Food, 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber'>, grams: number): Totals {
  const f = grams / 100
  const r = (v: number) => Math.round(v * f * 10) / 10
  return {
    kcal: Math.round(food.kcal * f),
    protein: r(food.protein),
    carbs: r(food.carbs),
    fat: r(food.fat),
    fiber: r(food.fiber),
  }
}

/** Saves an external search hit locally, reusing an existing row when it matches. */
export async function saveFood(hit: FoodHit): Promise<number> {
  if (hit.barcode) {
    const existing = await db.foods.where('barcode').equals(hit.barcode).first()
    if (existing?.id) return existing.id
  }
  const dupe = await db.foods
    .filter((f) => f.name.toLowerCase() === hit.name.toLowerCase() && (f.brand ?? '') === (hit.brand ?? ''))
    .first()
  if (dupe?.id) return dupe.id

  return db.foods.add({
    ...hit,
    favorite: false,
    useCount: 0,
    lastUsed: 0,
    createdAt: Date.now(),
  })
}

export async function logFood(
  foodId: number,
  grams: number,
  date: ISODate,
  meal: Meal,
  amountLabel: string,
): Promise<void> {
  const food = await db.foods.get(foodId)
  if (!food) throw new Error('Food not found')
  const macros = scale(food, grams)

  await db.transaction('rw', db.entries, db.foods, async () => {
    await db.entries.add({
      date,
      meal,
      foodId,
      name: food.name,
      brand: food.brand,
      grams,
      amountLabel,
      ...macros,
      createdAt: Date.now(),
    })
    // Usage counters drive the quick-add list, which is what makes logging fast.
    await db.foods.update(foodId, { useCount: (food.useCount ?? 0) + 1, lastUsed: Date.now() })
  })
}

/** Re-logs a whole saved meal in one tap. */
export async function logTemplate(template: MealTemplate, date: ISODate, meal?: Meal): Promise<number> {
  let logged = 0
  for (const item of template.items) {
    const food = await db.foods.get(item.foodId)
    if (!food) continue
    await logFood(item.foodId, item.grams, date, meal ?? template.meal, `${item.grams} g`)
    logged++
  }
  if (template.id) {
    await db.mealTemplates.update(template.id, {
      useCount: (template.useCount ?? 0) + 1,
      lastUsed: Date.now(),
    })
  }
  return logged
}

/** Copies every entry of one meal from one day to another. */
export async function copyMeal(from: ISODate, to: ISODate, meal: Meal): Promise<number> {
  const src = await db.entries.where('[date+meal]').equals([from, meal]).toArray()
  if (!src.length) return 0
  await db.entries.bulkAdd(
    src.map(({ id: _id, ...e }) => ({ ...e, date: to, createdAt: Date.now() })),
  )
  return src.length
}

/**
 * Copies a whole day, meal names and all.
 *
 * Repeating yesterday wholesale is the single fastest way to log a day that
 * looks like the last one, which for anyone meal-prepping is most days.
 * Ordering is preserved so the sections come back in the same sequence.
 */
export async function copyDay(from: ISODate, to: ISODate): Promise<number> {
  const src = (await db.entries.where('date').equals(from).toArray()).sort(
    (a, b) => a.createdAt - b.createdAt,
  )
  if (!src.length) return 0
  const now = Date.now()
  await db.entries.bulkAdd(
    src.map(({ id: _id, ...e }, i) => ({ ...e, date: to, createdAt: now + i })),
  )
  return src.length
}

/** The most recent day before `before` that has anything logged. */
export async function lastLoggedDay(before: ISODate): Promise<ISODate | null> {
  const rows = await db.entries.where('date').below(before).toArray()
  if (!rows.length) return null
  return rows.reduce((best, e) => (e.date > best ? e.date : best), rows[0].date)
}

/**
 * The names you actually use for sections of the day, best first.
 *
 * Naming a meal freely is only pleasant if you are not retyping "Meal prep
 * lunch" every day — so the suggestions come from your own history, ranked the
 * same way the quick-add foods are: how often, and how recently.
 */
export async function recentMealNames(limit = 8): Promise<Meal[]> {
  const rows = await db.entries.orderBy('createdAt').reverse().limit(600).toArray()
  const now = Date.now()
  const stats = new Map<string, { count: number; last: number }>()

  for (const e of rows) {
    const key = e.meal.trim()
    if (!key) continue
    const prev = stats.get(key) ?? { count: 0, last: 0 }
    stats.set(key, { count: prev.count + 1, last: Math.max(prev.last, e.createdAt) })
  }

  return [...stats.entries()]
    .map(([name, { count, last }]) => {
      const days = (now - last) / 86400000
      return { name, score: Math.log1p(count) * 1.5 + Math.exp(-days / 14) * 3 }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.name)
}

/**
 * Foods worth showing as one-tap buttons: recently used first, then the ones
 * used most often. In practice a handful of these cover most days.
 */
export async function quickFoods(limit = 12): Promise<Food[]> {
  const all = await db.foods.toArray()
  const now = Date.now()
  return all
    .filter((f) => f.useCount > 0 || f.favorite)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)

  function score(f: Food): number {
    const days = f.lastUsed ? (now - f.lastUsed) / 86400000 : 999
    const recency = Math.exp(-days / 14)
    return (f.favorite ? 3 : 0) + Math.log1p(f.useCount) * 1.5 + recency * 3
  }
}

/** Local-first food search — your own library always answers instantly. */
export async function searchLocal(query: string, limit = 25): Promise<Food[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const all = await db.foods.toArray()
  return all
    .map((f) => {
      const name = f.name.toLowerCase()
      const brand = (f.brand ?? '').toLowerCase()
      let s = 0
      if (name.startsWith(q)) s = 100
      else if (name.includes(q)) s = 60
      else if (brand.includes(q)) s = 30
      if (!s) return null
      return { f, s: s + Math.log1p(f.useCount) * 4 + (f.favorite ? 5 : 0) }
    })
    .filter((x): x is { f: Food; s: number } => x !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.f)
}
