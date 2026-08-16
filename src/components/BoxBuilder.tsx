import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Food, type ISODate, type Meal, type Recipe } from '../db/db'
import { logFood, logRecipe, searchLocal } from '../db/ops'
import { loadFoodDb, searchFoodDb } from '../lib/foodDb'
import { saveFood } from '../db/ops'
import {
  DISH_TYPES,
  boxTotals,
  calibratedDensity,
  densityFromPortions,
  finishedWeight,
  guessDensity,
  partError,
  partGrams,
  partIsExact,
  per100,
  type BoxPart,
} from '../lib/recipes'
import { Field, Icon, NumberInput } from './ui'

/**
 * Lunch, the way it is actually assembled: one container, filled by eye with
 * two or three things. The share of the box is the only quantity you can
 * report without a scale, so that is what gets asked for — everything else is
 * derived from it.
 */
export default function BoxBuilder({
  date,
  meal,
  boxMl,
  onBoxMl,
  onDone,
  toast,
}: {
  date: ISODate
  meal: Meal
  boxMl: number
  onBoxMl: (ml: number) => void
  onDone: () => void
  toast: (m: string) => void
}) {
  const [parts, setParts] = useState<BoxPart[]>([])
  const [adding, setAdding] = useState<'food' | 'recipe' | 'drink' | null>(null)
  const [drink, setDrink] = useState<{ name: string; ml: number; per100: BoxPart['per100']; foodId?: number } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)

  const totals = boxTotals(parts, boxMl)
  // How wrong the whole box could be, from the parts still being estimated.
  const error = parts.reduce((t, p) => t + (partError(p, boxMl) * p.per100.kcal) / 100, 0)
  const drinkKcal = drink ? Math.round((drink.per100.kcal * drink.ml) / 100) : 0
  const filled = Math.round(totals.pct)

  const update = (key: string, patch: Partial<BoxPart>) =>
    setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  /** Give the last part whatever is left, which is how a box gets filled. */
  const remaining = Math.max(0, 100 - filled)

  const addPart = (p: Omit<BoxPart, 'key' | 'pct'>) => {
    const pct = parts.length === 0 ? 70 : Math.max(5, remaining)
    setParts((ps) => [...ps, { ...p, key: `${Date.now()}-${ps.length}`, pct }])
    setAdding(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      for (const p of parts) {
        const grams = partGrams(p, boxMl)
        if (grams <= 0) continue
        const label = partIsExact(p)
          ? `1 of ${p.lunches} from the batch (${grams} g)`
          : `${p.pct}% of the box (${grams} g)`
        if (p.recipeId) {
          const recipe = await db.recipes.get(p.recipeId)
          if (recipe) {
            await logRecipe(recipe, grams, date, meal, label)
            continue
          }
        }
        if (p.foodId) await logFood(p.foodId, grams, date, meal, label)
      }
      if (drink && drink.foodId && drink.ml > 0) {
        await logFood(drink.foodId, drink.ml, date, meal, `${drink.ml} ml`)
      }
      toast(`${meal} logged — ${Math.round(totals.kcal) + drinkKcal} kcal`)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  if (adding) {
    return (
      <PartPicker
        mode={adding}
        onClose={() => setAdding(null)}
        onPickRecipe={(r) =>
          addPart({
            name: r.name,
            density: r.density ?? guessDensity(r.name),
            per100: per100(r),
            recipeId: r.id,
            // Offered, not assumed — the batch weight is only exact once you
            // say how many lunches it was split into.
            batchGrams: Math.round(finishedWeight(r)) || undefined,
          })
        }
        onPickFood={async (f) => {
          const id = f.id ?? (await saveFood(f))
          if (adding === 'drink') {
            setDrink({
              name: f.name,
              ml: 250,
              per100: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber },
              foodId: id,
            })
            setAdding(null)
            return
          }
          addPart({
            name: f.name,
            // The food's own volume portion is a density measurement of that
            // exact food; the category is only a family average.
            density: densityFromPortions(f.portions ?? []) ?? guessDensity(f.name),
            measured: !!densityFromPortions(f.portions ?? []),
            per100: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber },
            foodId: id,
          })
        }}
      />
    )
  }

  return (
    <>
      <Field label="Your container" hint="the box you fill, not the food">
        <NumberInput value={boxMl} unit="ml" onChange={(v) => onBoxMl(v ?? 0)} />
      </Field>

      <div className="card tight">
        <div className="card-head">
          <h3>What is in it</h3>
          <span className="tiny muted num">{filled}% filled</span>
        </div>

        {parts.length === 0 && (
          <div className="empty">
            Add the meal prep first, then whatever fills the rest — the rice, the potatoes.
          </div>
        )}

        {parts.map((p) => {
          const grams = partGrams(p, boxMl)
          const exact = partIsExact(p)
          return (
            <div
              key={p.key}
              className="stack tight"
              style={{ paddingBlock: 8, borderBottom: '1px solid var(--grid)' }}
            >
              <div className="row" style={{ gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="item-title truncate">{p.name}</div>
                  <div className="tiny muted num">
                    {exact
                      ? `1 of ${p.lunches} of the batch · ${Math.round((p.per100.kcal * grams) / 100)} kcal · exact`
                      : `${grams} g ±${partError(p, boxMl)} · ${Math.round((p.per100.kcal * grams) / 100)} kcal`}
                  </div>
                </div>
                {!exact && (
                  <div style={{ width: 84, flex: 'none' }}>
                    <NumberInput
                      value={p.pct || undefined}
                      unit="%"
                      onChange={(v) => update(p.key, { pct: v ?? 0 })}
                    />
                  </div>
                )}
                <button
                  className="iconbtn"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                >
                  <Icon.close />
                </button>
              </div>

              {!exact && (
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="tiny muted grow">
                    {p.measured ? 'measured density' : 'estimated density'} {p.density} g/ml · a full
                    box of just this weighs
                  </span>
                  <div style={{ width: 96, flex: 'none' }}>
                    <NumberInput
                      value={Math.round(p.density * boxMl)}
                      unit="g"
                      onChange={(v) => {
                        const d = calibratedDensity(v ?? 0, boxMl)
                        if (d) update(p.key, { density: d, measured: true })
                      }}
                    />
                  </div>
                </div>
              )}

              {p.batchGrams ? (
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="tiny muted grow">the batch filled</span>
                  <div style={{ width: 96, flex: 'none' }}>
                    <NumberInput
                      value={p.lunches}
                      unit="boxes"
                      placeholder="7"
                      onChange={(v) => update(p.key, { lunches: v })}
                    />
                  </div>
                </div>
              ) : null}
              {p.batchGrams && !exact && (
                <div className="tiny muted">
                  {/* The density cancels out of kcal/lunch once the batch is
                      divided by the number of boxes, so this needs no scale
                      and no weighing — only a count you can see. */}
                  Counting the boxes it filled makes this exact — no weighing, and the density
                  stops mattering.
                </div>
              )}

              {/* Density is what turns a share of the box into grams, and it
                  differs enough between rice and stew to matter. */}
              {!exact && (
                <div className="scroll-x">
                  {DISH_TYPES.map((t) => (
                    <button
                      key={t.label}
                      className="chip"
                      aria-pressed={Math.abs(p.density - t.density) < 0.005}
                      onClick={() => update(p.key, { density: t.density })}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="row" style={{ gap: 8, paddingTop: 10 }}>
          <button className="btn sm grow" onClick={() => setAdding('recipe')}>
            <Icon.plus /> Meal prep
          </button>
          <button className="btn sm grow" onClick={() => setAdding('food')}>
            <Icon.plus /> Food
          </button>
        </div>
      </div>

      {filled !== 100 && parts.length > 0 && (
        <div className="tiny muted">
          {filled < 100
            ? `${100 - filled}% of the box unaccounted for — add what else was in it, or raise a share.`
            : `That is ${filled}% of the box. Fine if you heaped it, worth a check otherwise.`}
        </div>
      )}

      <div className="card tight">
        <div className="card-head">
          <h3>Drink</h3>
          {drink ? (
            <button className="btn sm" onClick={() => setDrink(null)}>
              Remove
            </button>
          ) : (
            <button className="btn sm" onClick={() => setAdding('drink')}>
              <Icon.plus /> Add
            </button>
          )}
        </div>
        {drink ? (
          <div className="row" style={{ gap: 8 }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="item-title truncate">{drink.name}</div>
              <div className="tiny muted num">{drinkKcal} kcal</div>
            </div>
            <div style={{ width: 96, flex: 'none' }}>
              <NumberInput
                value={drink.ml || undefined}
                unit="ml"
                onChange={(v) => setDrink({ ...drink, ml: v ?? 0 })}
              />
            </div>
          </div>
        ) : (
          <div className="empty">Water needs no logging. Anything else does.</div>
        )}
      </div>

      <div className="card tight">
        <div className="row between">
          <span className="stat-label">The whole lunch</span>
          <span className="stat-value num">{Math.round(totals.kcal) + drinkKcal} kcal</span>
        </div>
        <div className="row between small num">
          <span>Protein {Math.round(totals.protein + (drink ? (drink.per100.protein * drink.ml) / 100 : 0))} g</span>
          <span>Carbs {Math.round(totals.carbs + (drink ? (drink.per100.carbs * drink.ml) / 100 : 0))} g</span>
          <span>Fat {Math.round(totals.fat + (drink ? (drink.per100.fat * drink.ml) / 100 : 0))} g</span>
        </div>
        <div className="tiny muted num">
          {Math.round(totals.grams)} g of food in the box
          {error >= 1 ? ` · ±${Math.round(error)} kcal from the parts still estimated` : ' · all exact'}
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={saving || (parts.length === 0 && !drink)}
        onClick={save}
      >
        Log {parts.length} item{parts.length === 1 ? '' : 's'}
        {drink ? ' and a drink' : ''}
      </button>
    </>
  )
}

/** Search for one component, from your meal preps or from any food. */
function PartPicker({
  mode,
  onClose,
  onPickRecipe,
  onPickFood,
}: {
  mode: 'food' | 'recipe' | 'drink'
  onClose: () => void
  onPickRecipe: (r: Recipe) => void
  onPickFood: (f: Food) => void
}) {
  const [query, setQuery] = useState('')
  const [bundled, setBundled] = useState<ReturnType<typeof searchFoodDb>>([])
  const entries = useRef<Awaited<ReturnType<typeof loadFoodDb>> | null>(null)

  const recipes = useLiveQuery(() => db.recipes.orderBy('lastUsed').reverse().toArray(), []) ?? []
  const mine = useLiveQuery(() => searchLocal(query, 12), [query]) ?? []

  useEffect(() => {
    void loadFoodDb().then((e) => {
      entries.current = e
      setBundled(searchFoodDb(query, e, 20))
    })
  }, [])
  useEffect(() => {
    if (entries.current) setBundled(searchFoodDb(query, entries.current, 20))
  }, [query])

  const q = query.trim().toLowerCase()
  const shownRecipes = useMemo(
    () => (mode === 'recipe' ? recipes.filter((r) => !q || r.name.toLowerCase().includes(q)) : []),
    [mode, recipes, q],
  )

  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <input
          autoFocus
          className="grow"
          type="search"
          placeholder={mode === 'recipe' ? 'Which meal prep…' : mode === 'drink' ? 'Which drink…' : 'Which food…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" onClick={onClose}>
          Back
        </button>
      </div>

      {mode === 'recipe' && (
        <div className="card tight">
          <h3>Your meal preps</h3>
          {shownRecipes.length === 0 && <div className="empty">Nothing saved under that name.</div>}
          {shownRecipes.map((r) => (
            <button key={r.id} className="item" onClick={() => onPickRecipe(r)}>
              <div className="grow">
                <div className="item-title truncate">{r.name}</div>
                <div className="tiny muted num">{Math.round(per100(r).kcal)} kcal / 100 g</div>
              </div>
              <span className="muted">
                <Icon.chevron />
              </span>
            </button>
          ))}
        </div>
      )}

      {mode !== 'recipe' && (
        <div className="card tight">
          {mine.length > 0 && <h3>Your foods</h3>}
          {mine.map((f) => (
            <button key={f.id} className="item" onClick={() => onPickFood(f)}>
              <div className="grow">
                <div className="item-title truncate">{f.name}</div>
                <div className="tiny muted num">{Math.round(f.kcal)} kcal / 100 g</div>
              </div>
            </button>
          ))}
          {bundled.length > 0 && <h3>Food database</h3>}
          {bundled.slice(0, 12).map((h, i) => (
            <button key={i} className="item" onClick={() => onPickFood(h as unknown as Food)}>
              <div className="grow">
                <div className="item-title truncate">{h.name}</div>
                <div className="tiny muted num">
                  {h.brand ? `${h.brand} · ` : ''}
                  {Math.round(h.kcal)} kcal / 100 g
                </div>
              </div>
            </button>
          ))}
          {query.trim().length >= 2 && mine.length === 0 && bundled.length === 0 && (
            <div className="empty">Nothing matches.</div>
          )}
        </div>
      )}
    </>
  )
}
