import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, MEAL_SUGGESTIONS, type Food, type ISODate, type PlannedItem, type PlannedMeal } from '../db/db'
import { healPlannedItems, scale } from '../db/ops'
import { per100 } from '../lib/recipes'
import { Field, Icon, NumberInput, Sheet } from './ui'

/**
 * Weighing a meal before eating it.
 *
 * Deliberately not the logging sheet with a flag on it. That sheet's whole job
 * is to put something into today, and threading "except this time do not" down
 * through the portion step, the box builder and the plate would put the
 * ordinary path at risk to serve the rare one.
 *
 * What is wanted here is also narrower: things already weighed. There is no
 * guessing a portion by eye, because a scale was in hand a moment ago — so the
 * grams field leads and the household portions are only shortcuts to it.
 */
export default function PlanMeal({
  date,
  existing,
  onClose,
  toast,
}: {
  date: ISODate
  existing?: PlannedMeal
  onClose: () => void
  toast: (m: string) => void
}) {
  const [meal, setMeal] = useState(existing?.meal ?? '')
  const [items, setItems] = useState<PlannedItem[]>(existing?.items ?? [])
  const [query, setQuery] = useState('')

  // Anything already saved is healed on open: an item that drifted to zero, or
  // was frozen empty by an older build, comes back the moment the box is
  // looked at, rather than waiting to be noticed.
  useEffect(() => {
    if (!existing?.items?.length) return
    let alive = true
    void healPlannedItems(existing.items).then(({ items: healed, changed }) => {
      if (alive && changed) setItems(healed)
    })
    return () => {
      alive = false
    }
  }, [existing?.id])

  const foods = useLiveQuery(() => db.foods.toArray(), []) ?? []
  const recipes = useLiveQuery(() => db.recipes.orderBy('lastUsed').reverse().toArray(), []) ?? []
  const templates = useLiveQuery(() => db.mealTemplates.orderBy('lastUsed').reverse().toArray(), []) ?? []

  // Deliberately his library only — the whole bundled database was noise when
  // weighing a meal he eats every week. New foods are created in the Foods tab.
  const q = query.trim().toLowerCase()
  const myTemplates = q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates.slice(0, 4)
  const mine = q
    ? foods
        .filter((f) => f.name.toLowerCase().includes(q) || (f.brand ?? '').toLowerCase().includes(q))
        .slice(0, 12)
    : []
  const myRecipes = q ? recipes.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 4) : []

  /** Same item at a new weight; macros are a snapshot per gram, so they scale. */
  const rescale = (it: PlannedItem, grams: number): PlannedItem => {
    // From the fixed per-100 if we have it; only otherwise from the snapshot,
    // which cannot recover once it is zero.
    const basis =
      it.per100 ??
      (it.grams > 0
        ? {
            kcal: (it.kcal / it.grams) * 100,
            protein: (it.protein / it.grams) * 100,
            carbs: (it.carbs / it.grams) * 100,
            fat: (it.fat / it.grams) * 100,
            fiber: (it.fiber / it.grams) * 100,
          }
        : { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
    const f = grams / 100
    const r = (v: number) => Math.round(v * f * 10) / 10
    return {
      ...it,
      grams,
      kcal: Math.round(basis.kcal * f),
      protein: r(basis.protein),
      carbs: r(basis.carbs),
      fat: r(basis.fat),
      fiber: r(basis.fiber),
      per100: basis,
    }
  }

  /** Drops every item of a saved meal in, each priced from its current food. */
  const addTemplate = async (t: (typeof templates)[number]) => {
    const added: PlannedItem[] = []
    for (const ti of t.items) {
      const food = await db.foods.get(ti.foodId)
      if (!food) continue
      added.push({
        foodId: food.id,
        name: food.name,
        brand: food.brand,
        grams: ti.grams,
        amountLabel: `${ti.grams} g`,
        ...scale(food, ti.grams),
        per100: { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber },
      })
    }
    setItems((xs) => [...xs, ...added])
    setQuery('')
    toast(`${t.name} — ${added.length} item${added.length === 1 ? '' : 's'} added`)
  }

  const addFood = (food: Food, grams: number, label: string) =>
    setItems((xs) => [
      ...xs,
      {
        foodId: food.id,
        name: food.name,
        brand: food.brand,
        grams,
        amountLabel: label,
        ...scale(food, grams),
        per100: { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber },
      },
    ])

  const totals = items.reduce(
    (t, i) => ({
      kcal: t.kcal + i.kcal,
      protein: t.protein + i.protein,
      fat: t.fat + i.fat,
      fiber: t.fiber + i.fiber,
      grams: t.grams + i.grams,
    }),
    { kcal: 0, protein: 0, fat: 0, fiber: 0, grams: 0 },
  )

  const [picking, setPicking] = useState<Food | null>(null)
  const [pickingRecipe, setPickingRecipe] = useState<{ name: string; recipeId?: number; p: ReturnType<typeof per100> } | null>(null)

  return (
    <Sheet title={existing ? 'Edit weighed meal' : 'Weigh a meal for later'} onClose={onClose}>
      <Field label="What is it" hint="Whatever you will call it when you eat it.">
        <input
          autoFocus
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          placeholder="Fruit box, deli box, nuts…"
        />
      </Field>
      {meal.trim() === '' && (
        <div className="scroll-x">
          {MEAL_SUGGESTIONS.map((m) => (
            <button key={m} className="chip" onClick={() => setMeal(m)}>
              {m}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="card tight">
          {items.map((it, idx) => (
            <div className="row" key={idx} style={{ gap: 8 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small truncate">{it.name}</div>
                <div className="tiny muted num truncate">
                  {it.kcal} kcal · P{it.protein} · F{it.fat} · fib{it.fiber}
                </div>
              </div>
              {/* Weight editable in place. Everything on the row scales with
                  it — the snapshot was per those grams, so a factor rescales
                  it, meal prep and plain food alike. */}
              <div style={{ width: 92, flex: 'none' }}>
                <NumberInput
                  value={it.grams || undefined}
                  unit="g"
                  onChange={(v) => setItems((xs) => xs.map((x, j) => (j === idx ? rescale(x, v ?? 0) : x)))}
                />
              </div>
              <button
                className="iconbtn"
                aria-label={`Remove ${it.name}`}
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))}
              >
                <Icon.close />
              </button>
            </div>
          ))}
          <div className="row between small num">
            <span className="muted">
              {items.length} items · {Math.round(totals.grams)} g
            </span>
            <span>{Math.round(totals.kcal)} kcal</span>
          </div>
          <div className="row between tiny muted num">
            <span>everything below counts toward the day when you eat it</span>
            <span>
              P{Math.round(totals.protein * 10) / 10} · F{Math.round(totals.fat * 10) / 10} · fibre{' '}
              {Math.round(totals.fiber * 10) / 10}
            </span>
          </div>
        </div>
      )}

      {pickingRecipe ? (
        <RecipeGramsStep
          name={pickingRecipe.name}
          p={pickingRecipe.p}
          onCancel={() => setPickingRecipe(null)}
          onAdd={(g) => {
            const rec = pickingRecipe
            const fac = g / 100
            const r = (v: number) => Math.round(v * fac * 10) / 10
            setItems((xs) => [
              ...xs,
              {
                recipeId: rec.recipeId,
                name: rec.name,
                grams: g,
                amountLabel: `${g} g`,
                kcal: Math.round(rec.p.kcal * fac),
                protein: r(rec.p.protein),
                carbs: r(rec.p.carbs),
                fat: r(rec.p.fat),
                fiber: r(rec.p.fiber),
                per100: {
                  kcal: rec.p.kcal,
                  protein: rec.p.protein,
                  carbs: rec.p.carbs,
                  fat: rec.p.fat,
                  fiber: rec.p.fiber,
                },
              },
            ])
            setPickingRecipe(null)
          }}
        />
      ) : picking ? (
        <GramsStep
          food={picking}
          onCancel={() => setPicking(null)}
          onAdd={(g, label) => {
            addFood(picking, g, label)
            setPicking(null)
            setQuery('')
          }}
        />
      ) : (
        <>
          <Field label="Add what you weighed">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a food or a meal prep…"
            />
          </Field>

          {myTemplates.length > 0 && (
            <div className="stack tight">
              <div className="tiny muted">Saved meals — tap to drop the whole thing in</div>
              {myTemplates.map((t) => (
                <button key={`t${t.id}`} className="item" onClick={() => void addTemplate(t)}>
                  <div className="grow">
                    <div className="item-title truncate">{t.name}</div>
                    <div className="tiny muted truncate num">
                      saved meal · {t.items.length} item{t.items.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="muted">
                    <Icon.plus />
                  </span>
                </button>
              ))}
            </div>
          )}

          {myRecipes.map((r) => {
            const p = per100(r)
            return (
              <button
                key={`r${r.id}`}
                className="item"
                onClick={() => {
                  setPickingRecipe({ name: r.name, recipeId: r.id, p })
                  setQuery('')
                }}
              >
                <div className="grow">
                  <div className="item-title truncate">{r.name}</div>
                  <div className="tiny muted truncate num">meal prep · {Math.round(p.kcal)} kcal/100 g</div>
                </div>
                <span className="muted">
                  <Icon.plus />
                </span>
              </button>
            )
          })}

          {mine.map((f) => (
            <button key={f.id} className="item" onClick={() => setPicking(f)}>
              <div className="grow">
                <div className="item-title truncate">{f.name}</div>
                <div className="tiny muted truncate num">
                  {f.brand ? `${f.brand} · ` : ''}
                  {Math.round(f.kcal)} kcal/100 {f.liquid ? 'ml' : 'g'}
                </div>
              </div>
              <span className="muted">
                <Icon.plus />
              </span>
            </button>
          ))}

        </>
      )}

      <button
        className="btn primary block"
        disabled={meal.trim() === '' || items.length === 0}
        onClick={async () => {
          const row = {
            date,
            meal: meal.trim(),
            items,
            createdAt: existing?.createdAt ?? Date.now(),
          }
          if (existing?.id != null) await db.plannedMeals.update(existing.id, row)
          else await db.plannedMeals.add(row)
          toast(`${meal.trim()} weighed — ${Math.round(totals.kcal)} kcal waiting`)
          onClose()
        }}
      >
        {existing ? 'Save changes' : 'Save for later'} · {Math.round(totals.kcal)} kcal
      </button>
    </Sheet>
  )
}

/** Grams for a meal prep, priced from its own per-100. */
function RecipeGramsStep({
  name,
  p,
  onAdd,
  onCancel,
}: {
  name: string
  p: ReturnType<typeof per100>
  onAdd: (grams: number) => void
  onCancel: () => void
}) {
  const [grams, setGrams] = useState<number | undefined>(undefined)
  const f = (grams ?? 0) / 100
  return (
    <div className="card tight">
      <div className="row between">
        <strong className="small">{name}</strong>
        <button className="iconbtn" aria-label="Cancel" onClick={onCancel}>
          <Icon.close />
        </button>
      </div>
      <Field label="Weighed (g)" hint={`${Math.round(p.kcal)} kcal per 100 g`}>
        <NumberInput autoFocus value={grams} unit="g" onChange={setGrams} />
      </Field>
      <div className="tiny muted num">
        {grams ? `${Math.round(p.kcal * f)} kcal · P${Math.round(p.protein * f * 10) / 10}` : 'Put the scale reading in.'}
      </div>
      <button className="btn block" disabled={!grams} onClick={() => onAdd(grams!)}>
        <Icon.plus /> Add
      </button>
    </div>
  )
}

/** Grams first, portions as shortcuts — the scale has already answered. */
function GramsStep({
  food,
  onAdd,
  onCancel,
}: {
  food: Food
  onAdd: (grams: number, label: string) => void
  onCancel: () => void
}) {
  const [grams, setGrams] = useState<number | undefined>(undefined)
  const unit = food.liquid ? 'ml' : 'g'
  return (
    <div className="card tight">
      <div className="row between">
        <strong className="small">{food.name}</strong>
        <button className="iconbtn" aria-label="Cancel" onClick={onCancel}>
          <Icon.close />
        </button>
      </div>
      <Field label={`Weighed (${unit})`}>
        <NumberInput autoFocus value={grams} unit={unit} onChange={setGrams} />
      </Field>
      {food.portions.length > 0 && (
        <div className="scroll-x">
          {food.portions.map((p, i) => (
            <button key={i} className="chip" onClick={() => setGrams(p.grams)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="tiny muted num">
        {grams ? `${scale(food, grams).kcal} kcal · P${scale(food, grams).protein}` : 'Put the scale reading in.'}
      </div>
      <button
        className="btn block"
        disabled={!grams}
        onClick={() => onAdd(grams!, `${grams} ${unit}`)}
      >
        <Icon.plus /> Add
      </button>
    </div>
  )
}
