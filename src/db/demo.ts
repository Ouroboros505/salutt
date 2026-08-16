import { db, saveSettings, type Food } from './db'
import { addDays, todayISO } from '../lib/date'
import { scale } from './ops'

/**
 * Fills the database with a plausible six weeks of history. Dev-only — it is
 * how the screens get looked at without waiting six weeks, and it is never
 * reachable from a production build.
 */
export async function seedDemo(): Promise<void> {
  await db.delete()
  await db.open()

  const foods: Omit<Food, 'id'>[] = [
    ['Oats, rolled', undefined, 379, 13.2, 67.7, 6.5, 10.1, [{ label: '1 serving', grams: 60 }]],
    ['Greek yoghurt 0%', 'Fage', 57, 10.3, 3.6, 0, 0, [{ label: '1 pot', grams: 170 }]],
    ['Banana', undefined, 89, 1.1, 22.8, 0.3, 2.6, [{ label: '1 medium', grams: 118 }]],
    ['Chicken breast, raw', undefined, 120, 22.5, 0, 2.6, 0, [{ label: '1 breast', grams: 174 }]],
    ['White rice, cooked', undefined, 130, 2.7, 28.2, 0.3, 0.4, [{ label: '1 cup', grams: 158 }]],
    ['Black beans, cooked', undefined, 132, 8.9, 23.7, 0.5, 8.7, [{ label: '1 cup', grams: 172 }]],
    ['Olive oil', undefined, 884, 0, 0, 100, 0, [{ label: '1 tbsp', grams: 13.5 }]],
    ['Egg, whole', undefined, 143, 12.6, 0.7, 9.5, 0, [{ label: '1 large', grams: 50 }]],
    ['Whey protein', 'Optimum', 375, 78.1, 9.4, 3.1, 0, [{ label: '1 scoop', grams: 32 }]],
    ['Avocado', undefined, 160, 2, 8.5, 14.7, 6.7, [{ label: '1/2 fruit', grams: 100 }]],
    ['Whole wheat bread', undefined, 247, 13, 41, 3.4, 7, [{ label: '1 slice', grams: 43 }]],
    ['Almonds', undefined, 579, 21.2, 21.6, 49.9, 12.5, [{ label: '1 handful', grams: 28 }]],
  ].map(([name, brand, kcal, protein, carbs, fat, fiber, portions]) => ({
    name: name as string,
    brand: brand as string | undefined,
    kcal: kcal as number,
    protein: protein as number,
    carbs: carbs as number,
    fat: fat as number,
    fiber: fiber as number,
    portions: portions as { label: string; grams: number }[],
    defaultPortion: 0,
    liquid: false,
    source: 'manual' as const,
    favorite: false,
    useCount: 0,
    lastUsed: 0,
    createdAt: Date.now(),
  }))

  const ids = await db.foods.bulkAdd(foods, { allKeys: true })
  const byName = new Map(foods.map((f, i) => [f.name, { id: ids[i], food: f }]))

  // Deterministic pseudo-randomness keeps the demo stable between reloads.
  let seed = 20260815
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

  const DAYS = 44
  const start = addDays(todayISO(), -(DAYS - 1))
  const TRUE_TDEE = 2680
  let weightKg = 88.4

  const plan: [string, string, number][][] = [
    [
      ['Oats, rolled', 'breakfast', 60],
      ['Greek yoghurt 0%', 'breakfast', 170],
      ['Banana', 'breakfast', 118],
    ],
    [
      ['Chicken breast, raw', 'lunch', 200],
      ['White rice, cooked', 'lunch', 200],
      ['Black beans, cooked', 'lunch', 130],
      ['Olive oil', 'lunch', 10],
    ],
    [
      ['Egg, whole', 'dinner', 100],
      ['Whole wheat bread', 'dinner', 86],
      ['Avocado', 'dinner', 80],
    ],
    [
      ['Whey protein', 'snack', 32],
      ['Almonds', 'snack', 28],
    ],
  ]

  for (let d = 0; d < DAYS; d++) {
    const date = addDays(start, d)
    const skip = rand() < 0.12 // a few unlogged days, like real life

    let dayKcal = 0
    if (!skip) {
      for (const meal of plan) {
        for (const [name, mealName, baseGrams] of meal) {
          const rec = byName.get(name)
          if (!rec) continue
          const grams = Math.round(baseGrams * (0.8 + rand() * 0.45))
          const m = scale(rec.food, grams)
          dayKcal += m.kcal
          await db.entries.add({
            date,
            meal: mealName as 'breakfast' | 'lunch' | 'dinner' | 'snack',
            foodId: rec.id,
            name: rec.food.name,
            brand: rec.food.brand,
            grams,
            amountLabel: `${grams} g`,
            ...m,
            createdAt: Date.now(),
          })
        }
      }
    }

    // Weight follows real energy balance, plus daily water noise.
    const intake = skip ? TRUE_TDEE - 350 : dayKcal
    weightKg += (intake - TRUE_TDEE) / 7700
    if (rand() > 0.12) {
      await db.weighIns.add({
        date,
        kg: Math.round((weightKg + (rand() - 0.5) * 1.5) * 10) / 10,
        bodyFatPct: Math.round((22.5 - d * 0.045 + (rand() - 0.5) * 0.6) * 10) / 10,
        source: 'manual',
        createdAt: Date.now(),
      })
    }

    if (d % 4 === 0) {
      await db.workouts.add({
        date,
        kind: d % 8 === 0 ? 'cardio' : 'strength',
        name: d % 8 === 0 ? 'Zone 2 run' : ['Push day', 'Pull day', 'Legs'][(d / 4) % 3 | 0],
        durationMin: 45 + Math.round(rand() * 25),
        sets:
          d % 8 === 0
            ? []
            : [
                { exercise: 'Bench press', reps: 8, weightKg: 60 + d * 0.2 },
                { exercise: 'Bench press', reps: 8, weightKg: 60 + d * 0.2 },
                { exercise: 'Row', reps: 10, weightKg: 50 + d * 0.15 },
              ],
        distanceKm: d % 8 === 0 ? 7.5 : undefined,
        createdAt: Date.now(),
      })
    }

    if (d % 14 === 0) {
      await db.measurements.add({
        date,
        waist: Math.round((96 - d * 0.09) * 10) / 10,
        chest: Math.round((104 - d * 0.03) * 10) / 10,
        neck: 39.5,
        hips: Math.round((102 - d * 0.05) * 10) / 10,
        arm: 35.2,
        thigh: Math.round((60 - d * 0.02) * 10) / 10,
        createdAt: Date.now(),
      })
    }
  }

  // Usage counters are what drive the quick-add chips, so reflect the history.
  for (const [name, rec] of byName) {
    const used = await db.entries.where('foodId').equals(rec.id).count()
    if (used > 0) {
      await db.foods.update(rec.id, {
        useCount: used,
        lastUsed: Date.now() - Math.round(rand() * 2 * 86400000),
        favorite: ['Greek yoghurt 0%', 'Chicken breast, raw'].includes(name),
      })
    }
  }

  await db.mealTemplates.add({
    name: 'Usual breakfast',
    meal: 'breakfast',
    items: plan[0].map(([name, , g]) => ({ foodId: byName.get(name)!.id, grams: g })),
    useCount: 9,
    lastUsed: Date.now(),
    createdAt: Date.now(),
  })

  await saveSettings({
    sex: 'male',
    birthDate: '1996-05-20',
    heightCm: 178,
    activity: 1.375,
    goalKgPerWeek: -0.5,
    goalWeightKg: 80,
    startWeightKg: 88.4,
    proteinGPerKg: 1.8,
    fatPctKcal: 0.28,
    trendHalfLifeDays: 10,
  })
}
