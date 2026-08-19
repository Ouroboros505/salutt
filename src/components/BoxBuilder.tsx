import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Food, type ISODate, type Meal, type Recipe } from '../db/db'
import { logFood, logRecipe, searchLocal } from '../db/ops'
import { loadFoodDb, searchFoodDb } from '../lib/foodDb'
import { saveFood } from '../db/ops'
import {
  DISH_TYPES,
  HAND_SIZES,
  boxTotals,
  densityFromPortions,
  guessDensity,
  impliedDensity,
  partError,
  partGrams,
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
  // Only shares describe how full the box is. A weighed or eyeballed part
  // says nothing about volume, so counting it would make the reading a lie.
  const shares = parts.filter((p) => p.mode === 'share')
  const settings = useLiveQuery(() => db.settings.get('settings'), [])
  const defaultMode = settings?.boxMode ?? 'share'
  const filled = Math.round(shares.reduce((t, p) => t + p.pct, 0))
  const allShares = shares.length === parts.length

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
        const label =
          p.mode === 'share'
            ? `${p.pct}% of the box (${grams} g)`
            : p.mode === 'weighed'
              ? `${grams} g, weighed`
              : `${grams} g, by eye`
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
            // A recipe settled its density when it was written, from its own
            // ingredients or from a weighing. Asking again here would invite
            // replacing a worked-out number with a guess.
            measured: r.density != null,
            per100: per100(r),
            recipeId: r.id,
            mode: defaultMode,
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
            mode: defaultMode,
          })
        }}
      />
    )
  }

  return (
    <>
      {/* Only volume needs a volume. With everything on the scale the box
          could be any shape at all, and asking its size is a question with no
          bearing on the answer. */}
      {(parts.length === 0 || shares.length > 0) && (
        <Field
          label="Your container"
          hint={shares.length > 0 ? 'the box you fill, not the food' : 'only needed for the parts you estimate by eye'}
        >
          <NumberInput value={boxMl} unit="ml" onChange={(v) => onBoxMl(v ?? 0)} />
        </Field>
      )}

      <div className="card tight">
        <div className="card-head">
          <h3>What is in it</h3>
          <span className="tiny muted num">
            {shares.length > 0 ? `${filled}% by volume` : ''}
            {shares.length > 0 && shares.length !== parts.length ? ' + weighed' : ''}
          </span>
        </div>

        {parts.length === 0 && (
          <div className="empty">
            Add the meal prep first, then whatever fills the rest — the rice, the potatoes.
          </div>
        )}

        {parts.map((p) => {
          const grams = partGrams(p, boxMl)
          const exact = p.mode === 'weighed'
          const actual = impliedDensity(p, boxMl)
          const estimated = Math.round((p.pct / 100) * boxMl * p.density)
          const check =
            actual && estimated > 0
              ? { actual, estimated, pctOff: Math.round((100 * Math.abs(estimated - (p.grams ?? 0))) / (p.grams || 1)) }
              : null
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
                    {grams} g{exact ? '' : ` ±${partError(p, boxMl)}`} ·{' '}
                    {Math.round((p.per100.kcal * grams) / 100)} kcal
                    {p.mode === 'share' ? ` · ${p.density} g/ml${p.measured ? '' : ', a guess'}` : ''}
                  </div>
                </div>
                <div style={{ width: 88, flex: 'none' }}>
                  {p.mode === 'share' ? (
                    <NumberInput
                      value={p.pct || undefined}
                      unit="%"
                      onChange={(v) => update(p.key, { pct: v ?? 0 })}
                    />
                  ) : (
                    <NumberInput
                      value={p.grams || undefined}
                      unit="g"
                      onChange={(v) => update(p.key, { grams: v ?? 0 })}
                    />
                  )}
                </div>
                <button
                  className="iconbtn"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                >
                  <Icon.close />
                </button>
              </div>

              {/* Three ways to say how much, because the right one depends on
                  what happened: the box for a normal day, the scale when you
                  want to know, a hand for anything that came from elsewhere. */}
              <div className="scroll-x">
                {(
                  [
                    ['share', 'Share of the box'],
                    ['weighed', 'Weighed'],
                    ['hand', 'By eye'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    className="chip"
                    aria-pressed={p.mode === mode}
                    onClick={() => {
                      void db.settings.update('settings', { boxMode: mode })
                      update(p.key, {
                        mode,
                        grams: p.grams ?? (partGrams(p, boxMl) || undefined),
                      })
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Only worth asking when nothing better is known: a recipe
                  carries its own density and a food with a volume portion has
                  one measured, so both are left alone. */}
              {p.mode === 'share' && !p.measured && (
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

              {p.mode === 'hand' && (
                <div className="scroll-x">
                  {HAND_SIZES.map((h) => (
                    <button
                      key={h.label}
                      className="chip"
                      aria-pressed={p.grams === h.grams}
                      onClick={() => update(p.key, { grams: h.grams })}
                    >
                      {h.label} <span className="muted num">{h.grams} g</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Weighing a share is the only way to find out whether the
                  density behind the estimate fits your cooking. */}
              {p.mode === 'weighed' && p.grams ? (
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="tiny muted grow">
                    it filled roughly this much of the box — fill it in and the density estimate
                    gets checked against the scale
                  </span>
                  <div style={{ width: 80, flex: 'none' }}>
                    <NumberInput
                      value={p.pct || undefined}
                      unit="%"
                      onChange={(v) => update(p.key, { pct: v ?? 0 })}
                    />
                  </div>
                </div>
              ) : null}
              {check && (
                <div className="tiny" style={{ color: 'var(--serious)' }}>
                  {check.pctOff <= 8
                    ? `The ${p.density} g/ml estimate was right — ${p.pct}% would have been ${check.estimated} g, you measured ${p.grams}.`
                    : `${p.pct}% at ${p.density} g/ml predicted ${check.estimated} g, but it weighs ${p.grams} — ${check.pctOff}% out. The real density is ${check.actual} g/ml.`}{' '}
                  <button
                    className="btn sm"
                    onClick={() => update(p.key, { density: check.actual, measured: true })}
                  >
                    Use {check.actual}
                  </button>
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

      {filled !== 100 && shares.length > 0 && allShares && (
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
