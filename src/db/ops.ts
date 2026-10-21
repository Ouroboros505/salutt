import { db, type Entry, type Food, type ISODate, type Meal, type MealTemplate, type PlannedItem, type PlannedMeal, type Recipe } from './db'
import type { FoodHit } from '../lib/foodApi'
import { per100 } from '../lib/recipes'

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

/**
 * Logs a weight of a finished meal prep as a single entry.
 *
 * One line, not one per ingredient: you ate a portion of chilli, not 140 g of
 * onion. Macros are snapshotted here as everywhere else, so editing the recipe
 * later never rewrites what you already ate.
 */
export async function logRecipe(
  recipe: Recipe,
  grams: number,
  date: ISODate,
  meal: Meal,
  amountLabel: string,
): Promise<void> {
  const p = per100(recipe)
  const f = grams / 100
  const r = (v: number) => Math.round(v * f * 10) / 10

  await db.transaction('rw', db.entries, db.recipes, async () => {
    await db.entries.add({
      date,
      meal,
      recipeId: recipe.id,
      name: recipe.name,
      grams,
      amountLabel,
      kcal: Math.round(p.kcal * f),
      protein: r(p.protein),
      carbs: r(p.carbs),
      fat: r(p.fat),
      fiber: r(p.fiber),
      createdAt: Date.now(),
    })
    if (recipe.id) {
      await db.recipes.update(recipe.id, {
        useCount: (recipe.useCount ?? 0) + 1,
        lastUsed: Date.now(),
      })
    }
  })
}

/** Re-logs a whole saved meal in one tap. */
export async function logTemplate(template: MealTemplate, date: ISODate, meal?: Meal): Promise<number> {
  let logged = 0
  for (const item of template.items) {
    if (item.recipeId != null) {
      const recipe = await db.recipes.get(item.recipeId)
      if (!recipe) continue
      await logRecipe(recipe, item.grams, date, meal ?? template.meal, `${item.grams} g`)
    } else {
      const food = item.foodId != null ? await db.foods.get(item.foodId) : undefined
      if (!food) continue
      await logFood(food.id!, item.grams, date, meal ?? template.meal, `${item.grams} g`)
    }
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

/** The sections of one particular day, with what each came to. */
export async function mealsOn(date: ISODate): Promise<PastMeal[]> {
  const rows = (await db.entries.where('date').equals(date).toArray()).sort(
    (a, b) => a.createdAt - b.createdAt,
  )
  const out = new Map<string, PastMeal>()
  for (const e of rows) {
    const key = e.meal.trim().toLowerCase()
    if (!key) continue
    const seen = out.get(key) ?? { meal: e.meal, date, items: 0, kcal: 0 }
    seen.items += 1
    seen.kcal += e.kcal
    out.set(key, seen)
  }
  return [...out.values()]
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

export interface PastMeal {
  meal: Meal
  date: ISODate
  items: number
  kcal: number
}

/**
 * Meals you have eaten before, one entry per name, most recent first.
 *
 * Repeating a meal is the common case — the same prepped lunch, the same
 * breakfast — so it should be reachable without rebuilding it item by item.
 */
export async function pastMeals(before: ISODate, limit = 10): Promise<PastMeal[]> {
  const rows = await db.entries.where('date').below(before).toArray()
  const latest = new Map<string, PastMeal>()

  for (const e of rows) {
    const key = e.meal.trim().toLowerCase()
    if (!key) continue
    const seen = latest.get(key)
    // Keep only the most recent day each name was used, and total that day.
    if (!seen || e.date > seen.date) {
      latest.set(key, { meal: e.meal, date: e.date, items: 0, kcal: 0 })
    }
  }
  for (const e of rows) {
    const entry = latest.get(e.meal.trim().toLowerCase())
    if (entry && entry.date === e.date) {
      entry.items += 1
      entry.kcal += e.kcal
    }
  }

  return [...latest.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
}

/** Copies one meal from a past day onto another, optionally under a new name. */
export async function repeatMeal(
  past: PastMeal,
  to: ISODate,
  rename?: Meal,
): Promise<number> {
  const src = (await db.entries.where('date').equals(past.date).toArray())
    .filter((e) => e.meal.trim().toLowerCase() === past.meal.trim().toLowerCase())
    .sort((a, b) => a.createdAt - b.createdAt)
  if (!src.length) return 0

  const now = Date.now()
  await db.entries.bulkAdd(
    src.map(({ id: _id, ...e }, i) => ({
      ...e,
      date: to,
      meal: rename?.trim() || e.meal,
      createdAt: now + i,
    })),
  )
  return src.length
}

/** Macros per 100 g of a finished recipe — the same maths the recipe screen uses. */
function per100Of(rec: Recipe): { kcal: number; protein: number; carbs: number; fat: number; fiber: number } {
  const t = per100(rec)
  return { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, fiber: t.fiber }
}

/**
 * Repairs any weighed-meal item whose nutrition has gone stale or zero.
 *
 * A planned meal is staging for a future log, not history, so its items should
 * reflect the current food and recipe definitions. This recomputes any item
 * that references a food or recipe from that source at its chosen grams —
 * catching a value that drifted to zero however it got there, and refreshing
 * one whose food was corrected since. Items with no reference (a one-off typed
 * by hand) are left exactly as they are. Returns whether anything changed, so
 * a caller saves only when it must.
 */
export async function healPlannedItems(
  items: PlannedItem[],
): Promise<{ items: PlannedItem[]; changed: boolean }> {
  let changed = false
  const out: PlannedItem[] = []
  for (const it of items) {
    let per100: PlannedItem['per100'] | null = null
    if (it.foodId != null) {
      const food = await db.foods.get(it.foodId)
      if (food)
        per100 = { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber }
    } else if (it.recipeId != null) {
      const rec = await db.recipes.get(it.recipeId)
      if (rec) per100 = per100Of(rec)
    }
    if (!per100) {
      out.push(it)
      continue
    }
    const f = (it.grams ?? 0) / 100
    const round1 = (v: number) => Math.round(v * f * 10) / 10
    const fixed: PlannedItem = {
      ...it,
      per100,
      kcal: Math.round(per100.kcal * f),
      protein: round1(per100.protein),
      carbs: round1(per100.carbs),
      fat: round1(per100.fat),
      fiber: round1(per100.fiber),
    }
    if (fixed.kcal !== it.kcal || fixed.protein !== it.protein || !it.per100) changed = true
    out.push(fixed)
  }
  return { items: out, changed }
}

/**
 * Eats a meal that was weighed earlier.
 *
 * The planned row is removed in the same transaction that writes the entries,
 * so the list empties itself as the day is eaten and a meal can never be
 * logged twice from it.
 */
export async function logPlanned(planned: PlannedMeal, to?: ISODate): Promise<number> {
  const when = to ?? planned.date
  const now = Date.now()
  // A box eaten straight from a notification never passes through the editor,
  // so heal it here too: whatever it holds, the day gets the real numbers.
  const { items } = await healPlannedItems(planned.items)
  await db.transaction('rw', db.entries, db.foods, db.plannedMeals, async () => {
    await db.entries.bulkAdd(
      items.map((it, i) => ({
        date: when,
        meal: planned.meal,
        foodId: it.foodId,
        recipeId: it.recipeId,
        name: it.name,
        brand: it.brand,
        grams: it.grams,
        amountLabel: it.amountLabel,
        kcal: it.kcal,
        protein: it.protein,
        carbs: it.carbs,
        fat: it.fat,
        fiber: it.fiber,
        createdAt: now + i,
      })),
    )
    for (const it of items) {
      if (!it.foodId) continue
      const food = await db.foods.get(it.foodId)
      if (food) await db.foods.update(it.foodId, { useCount: (food.useCount ?? 0) + 1, lastUsed: now })
    }
    if (planned.id != null) await db.plannedMeals.delete(planned.id)
  })
  return items.length
}

/** What a weighed-ahead meal comes to, for the list. */
export function plannedTotals(p: PlannedMeal): Totals & { grams: number } {
  return p.items.reduce(
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

/** Removes a whole section of a day. */
export async function deleteMeal(date: ISODate, meal: Meal): Promise<number> {
  const rows = (await db.entries.where('date').equals(date).toArray()).filter(
    (e) => e.meal === meal,
  )
  await db.entries.bulkDelete(rows.map((e) => e.id!))
  return rows.length
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
