import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Food, type ISODate, type PlannedMeal, type Recipe } from '../db/db'
import { plannedTotals, quickFoods, scale, searchLocal, ZERO, type Totals } from '../db/ops'
import { formatShort } from '../lib/date'
import { per100, portion as recipePortion, servingGrams } from '../lib/recipes'
import { Icon, Meter, NumberInput, Sheet } from './ui'

/**
 * The rest of the day, tried out before it is eaten.
 *
 * The remaining-calories figure answers "how much room is left", which on a
 * normal day is the whole question. On a tight or unusual day the question
 * is different: given what is left, what should the next thing be? Answering
 * that by logging a food, reading the numbers, and deleting it again is the
 * kind of workaround that teaches people not to bother.
 *
 * So this is a scratchpad. Foods added here are held in component state and
 * nowhere else: nothing is written, nothing survives the sheet closing, and
 * the day's real totals are never touched. That is the whole contract, and it
 * is what lets the panel be tried freely — a plan you can undo by closing it
 * costs nothing to make.
 *
 * It reads the same tables the real picker does — foods with their portions,
 * meal preps, saved meals, and anything weighed for later — so whatever can
 * be logged can be planned, from the same data.
 */

type Pick = { key: number; name: string; label: string; t: Totals }

const add = (a: Totals, b: Totals): Totals => ({
  kcal: a.kcal + b.kcal,
  protein: a.protein + b.protein,
  carbs: a.carbs + b.carbs,
  fat: a.fat + b.fat,
  fiber: a.fiber + b.fiber,
})

type Stage = { kind: 'search' } | { kind: 'food'; food: Food } | { kind: 'recipe'; recipe: Recipe }

export default function WhatIf({
  eaten,
  planned: waiting = [],
  date,
  targets,
  targetsFor,
  fibreGoal,
  fibreCeiling,
  onClose,
}: {
  /** What has actually been logged today. Read here, never written. */
  eaten: Totals
  /** Weighed already and waiting to be eaten: the likeliest next thing. */
  planned?: PlannedMeal[]
  /** The day being planned, so a carried-over weighing can say it is older. */
  date: ISODate
  targets: { kcal: number; protein: number; carbs: number; fat: number }
  /**
   * The target the day would have at a given intake.
   *
   * Not a constant: 10% of everything eaten is spent digesting it, so planned
   * food raises expenditure and the target with it. Asking for the target at
   * the planned intake is what keeps this sheet honest against the Today
   * screen once the food is actually logged.
   */
  targetsFor?: (intakeKcal: number) => { kcal: number; protein: number; carbs: number; fat: number }
  fibreGoal: number
  fibreCeiling: number
  onClose: () => void
}) {
  const [picks, setPicks] = useState<Pick[]>([])
  const [stage, setStage] = useState<Stage>({ kind: 'search' })
  const [query, setQuery] = useState('')
  const [foods, setFoods] = useState<Food[]>([])
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) ?? []
  // Saved meals are lists of food ids; total them here so a tap adds the lot.
  const templates =
    useLiveQuery(async () => {
      const ts = await db.mealTemplates.toArray()
      const foods = await db.foods.toArray()
      const byId = new Map(foods.map((f) => [f.id!, f]))
      return ts
        .map((t) => {
          const parts = t.items.map((i) => ({ f: byId.get(i.foodId), grams: i.grams })).filter((x) => x.f)
          const total = parts.reduce((s, x) => add(s, scale(x.f!, x.grams)), { ...ZERO })
          return { id: t.id!, name: t.name, meal: t.meal, total, count: parts.length, lastUsed: t.lastUsed ?? 0 }
        })
        .filter((t) => t.count > 0)
        .sort((a, b) => b.lastUsed - a.lastUsed)
    }, []) ?? []

  // The same search the real picker uses, minus the remote lookups: a food
  // that is not in the database yet is not something to plan a day around.
  useEffect(() => {
    let live = true
    const q = query.trim()
    ;(q ? searchLocal(q, 20) : quickFoods(10)).then((r) => live && setFoods(r))
    return () => {
      live = false
    }
  }, [query])

  const q = query.trim().toLowerCase()
  const matchingRecipes = useMemo(
    () => (q ? recipes.filter((r) => r.name.toLowerCase().includes(q)) : recipes).slice(0, q ? 6 : 4),
    [q, recipes],
  )
  const matchingTemplates = useMemo(
    () => (q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates).slice(0, q ? 6 : 4),
    [q, templates],
  )

  const plannedT = picks.reduce((s, p) => add(s, p.t), { ...ZERO })
  const after = add(eaten, plannedT)
  // The target as it would stand once the planned food is eaten, digestion
  // included. With nothing planned this is exactly the Today figure.
  const goal = targetsFor ? targetsFor(after.kcal) : targets
  const left = goal.kcal - after.kcal
  const targetMoved = Math.round(goal.kcal) - Math.round(targets.kcal)

  const addPick = (p: Omit<Pick, 'key'>) => {
    setPicks((ps) => [...ps, { ...p, key: Date.now() + Math.random() }])
    setStage({ kind: 'search' })
    setQuery('')
  }

  const rows = [
    { label: 'Protein', color: 'var(--series-1)', now: eaten.protein, then: after.protein, goal: goal.protein },
    { label: 'Carbs', color: 'var(--series-2)', now: eaten.carbs, then: after.carbs, goal: goal.carbs },
    { label: 'Fat', color: 'var(--series-3)', now: eaten.fat, then: after.fat, goal: goal.fat },
    {
      label: 'Fibre',
      color: after.fiber > fibreCeiling ? 'var(--warning)' : 'var(--series-5)',
      now: eaten.fiber,
      then: after.fiber,
      goal: fibreGoal,
    },
  ]

  // What the plan still leaves wanting, in the order he would act on it.
  const short: string[] = []
  if (after.protein < goal.protein - 2) short.push(`${Math.round(goal.protein - after.protein)} g protein`)
  if (after.fiber < fibreGoal - 2) short.push(`${Math.round(fibreGoal - after.fiber)} g fibre`)

  return (
    <Sheet
      title={stage.kind === 'search' ? 'What if…' : stage.kind === 'food' ? stage.food.name : stage.recipe.name}
      onClose={stage.kind === 'search' ? onClose : () => setStage({ kind: 'search' })}
    >
      {stage.kind === 'search' && (
        <>
          {/* ------------------------------------------------ the answer */}
          <div className="card tight stack tight">
            <div className="row between" style={{ alignItems: 'flex-end' }}>
              <div>
                <div className="stat-label">{left >= 0 ? 'Would leave' : 'Would go over by'}</div>
                <div className="stat-value num" style={{ color: left < 0 ? 'var(--critical)' : undefined }}>
                  {Math.abs(Math.round(left)).toLocaleString()} <span className="small secondary">kcal</span>
                </div>
              </div>
              <div className="tiny muted num" style={{ textAlign: 'right' }}>
                {Math.round(eaten.kcal).toLocaleString()} eaten
                {picks.length > 0 && <> + {Math.round(plannedT.kcal).toLocaleString()} planned</>}
                <br />
                of {Math.round(goal.kcal).toLocaleString()}
              </div>
            </div>
            <Meter value={after.kcal} max={goal.kcal} color={left < 0 ? 'var(--critical)' : undefined} />

            {rows.map((r) => (
              <div key={r.label} className="stack" style={{ gap: 3 }}>
                <div className="row between small num">
                  <span className="row" style={{ gap: 6 }}>
                    <span className="swatch" style={{ background: r.color }} />
                    <span className="secondary">{r.label}</span>
                  </span>
                  <span>
                    {picks.length > 0 && <span className="muted">{Math.round(r.now)} → </span>}
                    <strong>{Math.round(r.then)}</strong>
                    <span className="muted"> / {r.goal} g</span>
                  </span>
                </div>
                <Meter value={r.then} max={r.goal} color={r.color} />
              </div>
            ))}

            {targetMoved !== 0 && (
              <div className="tiny muted num">
                Target {Math.round(targets.kcal).toLocaleString()} →{' '}
                {Math.round(goal.kcal).toLocaleString()} — digesting the extra food burns some
                of it.
              </div>
            )}
            {short.length > 0 && (
              <div className="tiny muted">Still short: {short.join(' · ')}</div>
            )}
            {after.fiber > fibreCeiling && (
              <div className="tiny" style={{ color: 'var(--warning)' }}>
                That is past {fibreCeiling} g of fibre — expect it to cost some comfort.
              </div>
            )}
          </div>

          {/* ------------------------------------------------ the plan */}
          {picks.length > 0 && (
            <div className="stack tight">
              {picks.map((p) => (
                <div key={p.key} className="row between small">
                  <span className="grow">
                    {p.name} <span className="muted">{p.label}</span>
                  </span>
                  <span className="num secondary">{p.t.kcal} kcal</span>
                  <button
                    className="iconbtn"
                    aria-label={`Take ${p.name} out of the plan`}
                    onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))}
                  >
                    <Icon.close />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="tiny muted">
            Nothing here is logged. Close the sheet and the plan is gone.
          </div>

          {/* ------------------------------------------------ the search */}
          <div style={{ position: 'relative' }}>
            <input
              type="search"
              placeholder="Try adding…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
            <span style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <Icon.search />
            </span>
          </div>

          {/* Only what is still waiting: the row is deleted the moment it is
              eaten, so anything already logged has left this list. Shown even
              when empty, because "nothing weighed" is itself the answer and
              its absence made the reusable list below look like this one. */}
          {!q && (
            <div className="stack tight">
              <div className="stat-label">Weighed this morning</div>
              {waiting.length === 0 && (
                <div className="tiny muted">Nothing weighed and still waiting to be eaten.</div>
              )}
              {waiting.map((w) => {
                const t = plannedTotals(w)
                return (
                  <button
                    key={w.id}
                    className="btn block"
                    onClick={() =>
                      addPick({ name: w.items.map((i) => i.name).join(', '), label: `${w.meal}, ${Math.round(t.grams)} g as weighed`, t })
                    }
                  >
                    <span className="grow" style={{ textAlign: 'left' }}>
                      {w.meal}
                      {w.date !== date && (
                        <span className="tiny" style={{ color: 'var(--warning)' }}>
                          {' '}
                          · weighed {formatShort(w.date)}
                        </span>
                      )}
                      <span className="muted"> · {w.items.map((i) => i.name).join(', ')}</span>
                    </span>
                    <span className="muted num small">{Math.round(t.kcal)} kcal</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Reusable, not day-specific — the same wording Today uses, so
              these read as a shortcut rather than as something logged today. */}
          {matchingTemplates.length > 0 && (
            <div className="stack tight">
              <div className="stat-label">Quick add</div>
              {matchingTemplates.map((t) => (
                <button
                  key={t.id}
                  className="btn block"
                  onClick={() => addPick({ name: t.name, label: 'as saved', t: t.total })}
                >
                  <span className="grow" style={{ textAlign: 'left' }}>{t.name}</span>
                  <span className="muted num small">{Math.round(t.total.kcal)} kcal</span>
                </button>
              ))}
            </div>
          )}

          {matchingRecipes.length > 0 && (
            <div className="stack tight">
              <div className="stat-label">Your meal preps</div>
              {matchingRecipes.map((r) => (
                <button key={r.id} className="btn block" onClick={() => setStage({ kind: 'recipe', recipe: r })}>
                  <span className="grow" style={{ textAlign: 'left' }}>{r.name}</span>
                  <span className="muted num small">{Math.round(per100(r).kcal)} kcal / 100 g</span>
                </button>
              ))}
            </div>
          )}

          <div className="stack tight">
            {!q && foods.length > 0 && <div className="stat-label">Usual suspects</div>}
            {foods.map((f) => (
              <button key={f.id} className="btn block" onClick={() => setStage({ kind: 'food', food: f })}>
                <span className="grow" style={{ textAlign: 'left' }}>
                  {f.name}
                  {f.brand && <span className="muted"> · {f.brand}</span>}
                </span>
                <span className="muted num small">
                  {f.kcal} kcal / 100 {f.liquid ? 'ml' : 'g'}
                </span>
              </button>
            ))}
            {q && foods.length === 0 && matchingRecipes.length === 0 && matchingTemplates.length === 0 && (
              <div className="tiny muted">Nothing by that name in your foods.</div>
            )}
          </div>
        </>
      )}

      {stage.kind === 'food' && <FoodAmount food={stage.food} onPick={addPick} />}
      {stage.kind === 'recipe' && <RecipeAmount recipe={stage.recipe} onPick={addPick} />}
    </Sheet>
  )
}

/** The same portion chips the real picker offers, ending in a plan rather than a log. */
function FoodAmount({ food, onPick }: { food: Food; onPick: (p: Omit<Pick, 'key'>) => void }) {
  const hasPortions = food.portions.length > 0
  const [portion, setPortion] = useState<number>(hasPortions ? Math.max(0, food.defaultPortion) : -1)
  const [qty, setQty] = useState<number | undefined>(portion >= 0 ? 1 : 100)
  const unit = food.liquid ? 'ml' : 'g'

  const grams = portion >= 0 ? (qty ?? 0) * food.portions[portion].grams : (qty ?? 0)
  const t = scale(food, grams)
  const label =
    portion >= 0 ? `${qty ?? 0} × ${food.portions[portion].label} (${Math.round(grams)} ${unit})` : `${Math.round(grams)} ${unit}`

  const choose = (i: number) => {
    setPortion(i)
    setQty(i >= 0 ? 1 : 100)
  }

  return (
    <>
      <div className="scroll-x">
        {food.portions.map((p, i) => (
          <button key={i} className="chip" aria-pressed={portion === i} onClick={() => choose(i)}>
            {p.label} <span className="muted num">{p.grams} {unit}</span>
          </button>
        ))}
        <button className="chip" aria-pressed={portion === -1} onClick={() => choose(-1)}>
          {food.liquid ? 'Millilitres' : 'Grams'}
        </button>
      </div>
      <NumberInput
        value={qty}
        onChange={setQty}
        unit={portion >= 0 ? '×' : unit}
        autoFocus
        placeholder={portion >= 0 ? '1' : '100'}
      />
      <Preview t={t} />
      <button className="btn primary block" disabled={grams <= 0} onClick={() => onPick({ name: food.name, label, t })}>
        Add to the plan
      </button>
    </>
  )
}

function RecipeAmount({ recipe, onPick }: { recipe: Recipe; onPick: (p: Omit<Pick, 'key'>) => void }) {
  const serving = servingGrams(recipe)
  const [byServing, setByServing] = useState(serving != null)
  const [qty, setQty] = useState<number | undefined>(serving != null ? 1 : 100)
  const grams = byServing && serving != null ? (qty ?? 0) * serving : (qty ?? 0)
  const t = recipePortion(recipe, grams)
  const label = byServing && serving != null ? `${qty ?? 0} portion${(qty ?? 0) === 1 ? '' : 's'} (${Math.round(grams)} g)` : `${Math.round(grams)} g`

  return (
    <>
      <div className="scroll-x">
        {serving != null && (
          <button className="chip" aria-pressed={byServing} onClick={() => { setByServing(true); setQty(1) }}>
            1 portion <span className="muted num">{Math.round(serving)} g</span>
          </button>
        )}
        <button className="chip" aria-pressed={!byServing} onClick={() => { setByServing(false); setQty(100) }}>
          Grams
        </button>
      </div>
      <NumberInput value={qty} onChange={setQty} unit={byServing ? '×' : 'g'} autoFocus />
      <Preview t={t} />
      <button className="btn primary block" disabled={grams <= 0} onClick={() => onPick({ name: recipe.name, label, t })}>
        Add to the plan
      </button>
    </>
  )
}

function Preview({ t }: { t: Totals }) {
  return (
    <div className="row between small num secondary" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span>
        <strong>{t.kcal}</strong> kcal
      </span>
      <span>P {t.protein}</span>
      <span>C {t.carbs}</span>
      <span>F {t.fat}</span>
      <span>Fibre {t.fiber}</span>
    </div>
  )
}
