import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, MEAL_SUGGESTIONS, type Food, type ISODate, type Meal, type Recipe } from '../db/db'
import { logFood, logRecipe, quickFoods, saveFood, scale, searchLocal } from '../db/ops'
import { boxWeight, finishedWeight, per100, servingGrams } from '../lib/recipes'
import { lookupBarcode, searchRemote, type FoodHit } from '../lib/foodApi'
import { loadFoodDb, searchFoodDb } from '../lib/foodDb'
import { Field, Icon, NumberInput, Sheet } from '../components/ui'
import BarcodeScanner from './BarcodeScanner'


type Stage =
  | { kind: 'search' }
  | { kind: 'portion'; food: Food }
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'create'; name: string }

export default function AddFood({
  date,
  meal,
  mealsToday = [],
  onClose,
  toast,
}: {
  date: ISODate
  meal: Meal
  /** Sections already open today, offered before the generic suggestions. */
  mealsToday?: Meal[]
  onClose: () => void
  toast: (m: string) => void
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'search' })
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<FoodHit[]>([])
  const [bundled, setBundled] = useState<FoodHit[]>([])
  const [dbReady, setDbReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const settings = useLiveQuery(() => db.settings.get('settings'), [])

  // The bundled database is a static file; pull it in once when the sheet opens
  // so the first search is already instant.
  const entries = useRef<Awaited<ReturnType<typeof loadFoodDb>> | null>(null)
  useEffect(() => {
    let alive = true
    loadFoodDb()
      .then((e) => {
        if (!alive) return
        entries.current = e
        setDbReady(true)
      })
      .catch(() => setDbReady(false))
    return () => {
      alive = false
    }
  }, [])
  const local = useLiveQuery(() => searchLocal(query), [query]) ?? []
  // Your own meal preps come before anything else: if you cooked it, it is far
  // more likely to be what you are logging than a database entry of the same name.
  const recipes = useLiveQuery(() => db.recipes.orderBy('lastUsed').reverse().toArray(), []) ?? []
  const q = query.trim().toLowerCase()
  const matchingRecipes = recipes.filter((r) => !q || r.name.toLowerCase().includes(q))
  const recents = useLiveQuery(() => quickFoods(20), []) ?? []

  // The bundled database is in memory, so it can answer on every keystroke.
  useEffect(() => {
    if (!entries.current) return
    setBundled(searchFoodDb(query, entries.current, 30))
  }, [query, dbReady])

  // Remote lookup is debounced and abortable so fast typing does not queue up
  // requests or let a stale response overwrite a newer one.
  const abort = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setRemote([])
      setBusy(false)
      return
    }
    setBusy(true)
    const t = window.setTimeout(async () => {
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      try {
        setRemote(await searchRemote(q, settings?.usdaApiKey, ctrl.signal))
        setError(null)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Search failed — offline?')
      } finally {
        if (!ctrl.signal.aborted) setBusy(false)
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [query, settings?.usdaApiKey])

  useEffect(() => () => abort.current?.abort(), [])

  const openHit = async (hit: FoodHit) => {
    const id = await saveFood(hit)
    const food = await db.foods.get(id)
    if (food) setStage({ kind: 'portion', food })
  }

  const onScan = async (code: string) => {
    setScanning(false)
    setBusy(true)
    try {
      const existing = await db.foods.where('barcode').equals(code).first()
      if (existing) {
        setStage({ kind: 'portion', food: existing })
        return
      }
      const hit = await lookupBarcode(code)
      if (hit) await openHit(hit)
      else {
        setQuery('')
        setError(`Barcode ${code} is not in Open Food Facts — add it as a new food.`)
        setStage({ kind: 'create', name: '' })
      }
    } catch {
      setError('Lookup failed — offline?')
    } finally {
      setBusy(false)
    }
  }

  const title =
    stage.kind === 'portion'
      ? stage.food.name
      : stage.kind === 'recipe'
        ? stage.recipe.name
        : stage.kind === 'create'
          ? 'New food'
          : `Add to ${meal}`

  if (scanning) return <BarcodeScanner onDetect={onScan} onClose={() => setScanning(false)} />

  return (
    <Sheet
      title={title}
      onClose={stage.kind === 'search' ? onClose : () => setStage({ kind: 'search' })}
    >
      {stage.kind === 'search' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <div className="grow" style={{ position: 'relative' }}>
              <input
                autoFocus
                type="search"
                placeholder="Search foods…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 36 }}
              />
              <span
                style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}
              >
                <Icon.search />
              </span>
            </div>
            <button className="btn" onClick={() => setScanning(true)} aria-label="Scan barcode">
              <Icon.barcode />
            </button>
          </div>

          {error && <div className="tiny" style={{ color: 'var(--critical)' }}>{error}</div>}

          {matchingRecipes.length > 0 && (
            <Section title="Your meal preps">
              {matchingRecipes.map((r) => {
                const serving = servingGrams(r)
                return (
                  <button
                    key={r.id}
                    className="item"
                    onClick={() => setStage({ kind: 'recipe', recipe: r })}
                  >
                    <div className="grow">
                      <div className="item-title truncate">{r.name}</div>
                      <div className="tiny muted truncate num">
                        {Math.round(per100(r).kcal)} kcal / 100 g
                        {serving ? ` · portion ${serving} g` : ` · ${Math.round(finishedWeight(r))} g made`}
                      </div>
                    </div>
                    <span className="muted">
                      <Icon.chevron />
                    </span>
                  </button>
                )
              })}
            </Section>
          )}

          {query.trim() === '' && recents.length > 0 && (
            <Section title="Your usual">
              {recents.map((f) => (
                <FoodRow key={f.id} food={f} onPick={() => setStage({ kind: 'portion', food: f })} />
              ))}
            </Section>
          )}

          {local.length > 0 && (
            <Section title="Your foods">
              {local.map((f) => (
                <FoodRow key={f.id} food={f} onPick={() => setStage({ kind: 'portion', food: f })} />
              ))}
            </Section>
          )}

          {query.trim().length >= 2 && bundled.length > 0 && (
            <Section title="Food database">
              {bundled.map((h, i) => (
                <HitRow key={`b${i}`} hit={h} onPick={() => openHit(h)} />
              ))}
            </Section>
          )}

          {query.trim().length >= 2 && (
            <Section title={busy ? 'Searching online…' : 'Online'}>
              {remote.map((h, i) => (
                <HitRow key={`${h.sourceId}-${i}`} hit={h} onPick={() => openHit(h)} />
              ))}
              {!busy && remote.length === 0 && (
                <div className="empty">
                  {bundled.length
                    ? 'Nothing extra online'
                    : 'No matches online — Open Food Facts search is often unavailable'}
                </div>
              )}
            </Section>
          )}

          {query.trim() !== '' && (
            <button className="btn block" onClick={() => setStage({ kind: 'create', name: query.trim() })}>
              <Icon.plus /> Create “{query.trim()}” myself
            </button>
          )}
        </>
      )}

      {stage.kind === 'portion' && (
        <PortionStep
          food={stage.food}
          date={date}
          meal={meal}
          mealsToday={mealsToday}
          onDone={(msg) => {
            toast(msg)
            onClose()
          }}
        />
      )}

      {stage.kind === 'recipe' && (
        <RecipePortion
          recipe={stage.recipe}
          date={date}
          meal={meal}
          mealsToday={mealsToday}
          onDone={(msg) => {
            toast(msg)
            onClose()
          }}
        />
      )}

      {stage.kind === 'create' && (
        <CreateFood
          initialName={stage.name}
          onCreated={(food) => setStage({ kind: 'portion', food })}
        />
      )}
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card tight">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  )
}

function FoodRow({ food, onPick }: { food: Food; onPick: () => void }) {
  const p = food.portions[food.defaultPortion] ?? food.portions[0]
  return (
    <button className="item" onClick={onPick}>
      <div className="grow">
        <div className="item-title truncate">{food.name}</div>
        <div className="tiny muted truncate">
          {food.brand ? `${food.brand} · ` : ''}
          {p
            ? `${Math.round((food.kcal * p.grams) / 100)} kcal per ${p.label} · ${Math.round(food.kcal)} /100 g`
            : `${Math.round(food.kcal)} kcal / 100 g`}
        </div>
      </div>
      {food.favorite && <span style={{ color: 'var(--series-4)' }}>★</span>}
      <span className="muted">
        <Icon.chevron />
      </span>
    </button>
  )
}

function HitRow({ hit, onPick }: { hit: FoodHit; onPick: () => void }) {
  const p = hit.portions[0]
  return (
    <button className="item" onClick={onPick}>
      <div className="grow">
        <div className="item-title truncate">{hit.name}</div>
        <div className="tiny muted truncate">
          {hit.brand ? `${hit.brand} · ` : ''}
          {/* Per serving first when there is one — that is the number on the
              packet, and the one worth recognising. */}
          {p
            ? `${Math.round((hit.kcal * p.grams) / 100)} kcal per ${p.label} · ${Math.round(hit.kcal)} /100 g`
            : `${Math.round(hit.kcal)} kcal / 100 g`}
        </div>
      </div>
      <span className="muted">
        <Icon.chevron />
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------- portion */

/** Quantity mode for "the serving printed on the packet". */
const SERVING = -2

function PortionStep({
  food,
  date,
  meal,
  mealsToday,
  onDone,
}: {
  food: Food
  date: ISODate
  meal: Meal
  mealsToday: Meal[]
  onDone: (msg: string) => void
}) {
  // -1 is the "grams" option, SERVING the packet-serving one; anything else
  // indexes food.portions.
  const [portion, setPortion] = useState(food.defaultPortion ?? -1)
  const [qty, setQty] = useState(portion >= 0 ? '1' : '100')
  const [targetMeal, setTargetMeal] = useState<Meal>(meal)
  const [fav, setFav] = useState(food.favorite)
  const [remember, setRemember] = useState('')
  /**
   * The nutrition here is per 100 g, but a packet states its numbers per
   * serving and tells you what that serving weighs. Reading that one number
   * off the packet is far less work than weighing anything, so it can be
   * typed in directly — and it is kept afterwards, so a food only ever has
   * to be told once.
   */
  const [servingG, setServingG] = useState<number | undefined>(undefined)

  const grams = useMemo(() => {
    const q = parseFloat(qty) || 0
    if (portion === SERVING) return q * (servingG ?? 0)
    return portion >= 0 ? q * food.portions[portion].grams : q
  }, [qty, portion, servingG, food.portions])

  const macros = scale(food, grams)
  const servingLabel = `1 serving (${servingG ?? 0} g)`
  const label =
    portion === SERVING
      ? `${qty} × serving (${Math.round(grams)} g)`
      : portion >= 0
        ? `${qty} × ${food.portions[portion].label}`
        : `${grams} g`

  const choose = (i: number) => {
    setPortion(i)
    setQty(i >= 0 || i === SERVING ? '1' : '100')
  }

  return (
    <>
      <div className="scroll-x">
        {food.portions.map((p, i) => (
          <button key={i} className="chip" aria-pressed={portion === i} onClick={() => choose(i)}>
            {p.label} <span className="muted num">{p.grams} g</span>
          </button>
        ))}
        <button className="chip" aria-pressed={portion === SERVING} onClick={() => choose(SERVING)}>
          Serving on the packet
        </button>
        <button className="chip" aria-pressed={portion === -1} onClick={() => choose(-1)}>
          Grams
        </button>
      </div>

      {portion === SERVING && (
        <Field label="Serving size" hint="the grams printed on the packet">
          <NumberInput value={servingG} unit="g" autoFocus placeholder="24" onChange={setServingG} />
        </Field>
      )}

      <Field
        label={
          portion === SERVING
            ? 'How many servings'
            : portion >= 0
              ? `How many (${food.portions[portion].label})`
              : 'Grams'
        }
      >
        <input
          type="number"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </Field>

      {portion === SERVING && grams > 0 && (
        <div className="tiny muted">
          {qty} × {servingG} g = {Math.round(grams)} g. Saved with this food, so next time it is
          just a button.
        </div>
      )}

      {/* Most packaged foods arrive from the database with no household
          measure, so the same weight gets typed in every single time. Naming it
          once turns it into a one-tap chip from then on. */}
      {portion === -1 && grams > 0 && (
        <Field label={`Remember ${grams} g as…`} hint="Optional — becomes a button next time">
          <input
            value={remember}
            onChange={(e) => setRemember(e.target.value)}
            placeholder="1 patty, 1 slice, half a tin…"
            autoCapitalize="none"
          />
        </Field>
      )}

      <div className="card tight">
        <div className="row between">
          <span className="stat-label">Calories</span>
          <span className="stat-value num">{macros.kcal}</span>
        </div>
        <div className="row between small num">
          <span>
            <span className="swatch" style={{ background: 'var(--series-1)', display: 'inline-block', marginRight: 5 }} />
            Protein {macros.protein} g
          </span>
          <span>
            <span className="swatch" style={{ background: 'var(--series-2)', display: 'inline-block', marginRight: 5 }} />
            Carbs {macros.carbs} g
          </span>
          <span>
            <span className="swatch" style={{ background: 'var(--series-3)', display: 'inline-block', marginRight: 5 }} />
            Fat {macros.fat} g
          </span>
        </div>
      </div>

      <Field label="Meal">
        <div className="scroll-x">
          {[
            ...mealsToday,
            ...MEAL_SUGGESTIONS.filter(
              (sug) => !mealsToday.some((m) => m.toLowerCase() === sug.toLowerCase()),
            ),
          ].map((m) => (
            <button key={m} className="chip" aria-pressed={targetMeal === m} onClick={() => setTargetMeal(m)}>
              {m}
            </button>
          ))}
        </div>
      </Field>

      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn"
          aria-pressed={fav}
          onClick={async () => {
            setFav(!fav)
            await db.foods.update(food.id!, { favorite: !fav })
          }}
          aria-label="Favourite"
        >
          <span style={{ color: fav ? 'var(--series-4)' : 'var(--text-muted)' }}>★</span>
        </button>
        <button
          className="btn primary grow"
          disabled={grams <= 0}
          onClick={async () => {
            const named = remember.trim()
            if (portion === SERVING && servingG) {
              // Keep the serving, so the packet only ever gets read once.
              const already = food.portions.findIndex((p) => p.grams === servingG)
              const portions =
                already >= 0 ? food.portions : [...food.portions, { label: servingLabel, grams: servingG }]
              const idx = already >= 0 ? already : portions.length - 1
              await db.foods.update(food.id!, { portions, defaultPortion: idx })
              await logFood(food.id!, grams, date, targetMeal, label)
            } else if (portion === -1 && named && grams > 0) {
              const portions = [...food.portions, { label: named, grams }]
              await db.foods.update(food.id!, { portions, defaultPortion: portions.length - 1 })
              await logFood(food.id!, grams, date, targetMeal, `1 × ${named}`)
            } else {
              // Remember the portion actually used, so next time it is preselected.
              if (portion !== food.defaultPortion) {
                await db.foods.update(food.id!, { defaultPortion: portion })
              }
              await logFood(food.id!, grams, date, targetMeal, label)
            }
            onDone(`${food.name} logged`)
          }}
        >
          Log {macros.kcal} kcal
        </button>
      </div>
    </>
  )
}

/** Logging a serving of something you cooked. */
function RecipePortion({
  recipe,
  date,
  meal,
  mealsToday,
  onDone,
}: {
  recipe: Recipe
  date: ISODate
  meal: Meal
  mealsToday: Meal[]
  onDone: (msg: string) => void
}) {
  const serving = servingGrams(recipe)
  const box = boxWeight(recipe)
  const boxGrams = box?.grams ?? null

  type Mode = 'container' | 'serving' | 'grams'
  const [mode, setMode] = useState<Mode>(
    boxGrams != null ? 'container' : serving != null ? 'serving' : 'grams',
  )
  const [qty, setQty] = useState(boxGrams != null ? '100' : '1')
  const [targetMeal, setTargetMeal] = useState<Meal>(meal)

  const n = parseFloat(qty) || 0
  const grams =
    mode === 'container' && boxGrams != null
      ? (n / 100) * boxGrams
      : mode === 'serving' && serving != null
        ? n * serving
        : n
  const p = per100(recipe)
  const f = grams / 100
  const kcal = Math.round(p.kcal * f)

  const choose = (next: Mode) => {
    setMode(next)
    setQty(next === 'container' ? '100' : next === 'serving' ? '1' : String(Math.round(boxGrams ?? serving ?? 200)))
  }

  return (
    <>
      {(serving != null || boxGrams != null) && (
        <div className="scroll-x">
          {boxGrams != null && (
            <button className="chip" aria-pressed={mode === 'container'} onClick={() => choose('container')}>
              % of a box <span className="muted num">{Math.round(boxGrams)} g full</span>
            </button>
          )}
          {serving != null && (
            <button className="chip" aria-pressed={mode === 'serving'} onClick={() => choose('serving')}>
              Portions <span className="muted num">{serving} g</span>
            </button>
          )}
          <button className="chip" aria-pressed={mode === 'grams'} onClick={() => choose('grams')}>
            Grams
          </button>
        </div>
      )}

      {mode === 'container' && boxGrams != null && (
        <div className="scroll-x">
          {[100, 75, 70, 60, 50, 33, 25].map((pct) => (
            <button key={pct} className="chip" aria-pressed={qty === String(pct)} onClick={() => setQty(String(pct))}>
              {pct}%
            </button>
          ))}
        </div>
      )}

      <Field
        label={
          mode === 'container'
            ? 'How full was the box (%)'
            : mode === 'serving'
              ? 'How many portions'
              : 'Grams of the finished dish'
        }
        hint={
          mode === 'container' && boxGrams != null
            ? `A full box is ${box?.source === 'counted' ? '' : 'roughly '}${Math.round(boxGrams)} g${box?.source === 'estimated' ? ' — estimated from volume' : ''}`
            : `Made ${Math.round(finishedWeight(recipe))} g in total`
        }
      >
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </Field>

      <div className="card tight">
        <div className="row between">
          <span className="stat-label">Calories</span>
          <span className="stat-value num">{kcal}</span>
        </div>
        <div className="row between small num">
          <span>Protein {(p.protein * f).toFixed(0)} g</span>
          <span>Carbs {(p.carbs * f).toFixed(0)} g</span>
          <span>Fat {(p.fat * f).toFixed(0)} g</span>
        </div>
      </div>

      <Field label="Meal">
        <div className="scroll-x">
          {[
            ...mealsToday,
            ...MEAL_SUGGESTIONS.filter(
              (sug) => !mealsToday.some((m) => m.toLowerCase() === sug.toLowerCase()),
            ),
          ].map((m) => (
            <button key={m} className="chip" aria-pressed={targetMeal === m} onClick={() => setTargetMeal(m)}>
              {m}
            </button>
          ))}
        </div>
      </Field>

      <button
        className="btn primary block"
        disabled={grams <= 0}
        onClick={async () => {
          const label =
            mode === 'container'
              ? `${qty}% of a box (${Math.round(grams)} g)`
              : mode === 'serving' && serving
                ? `${qty} × portion (${Math.round(grams)} g)`
                : `${Math.round(grams)} g`
          await logRecipe(recipe, grams, date, targetMeal, label)
          onDone(`${recipe.name} logged`)
        }}
      >
        Log {kcal} kcal
      </button>
    </>
  )
}

/* ---------------------------------------------------------------- create */

export function CreateFood({
  initialName,
  onCreated,
}: {
  initialName: string
  onCreated: (food: Food) => void
}) {
  /**
   * Packets state their numbers per serving — 24 g of chia, 64 g of hash
   * brown — while everything here is stored per 100 g so portions can scale.
   * Making you do that division by hand for every product is the sort of
   * friction that stops a log being kept, so the form takes the label as
   * written and converts.
   */
  const [perServing, setPerServing] = useState(true)
  const [name, setName] = useState(initialName)
  const [brand, setBrand] = useState('')
  const [servingG, setServingG] = useState<number | undefined>(undefined)
  const [servingLabel, setServingLabel] = useState('')
  const [v, setV] = useState<Record<string, number | undefined>>({})

  const set = (k: string) => (x: number | undefined) => setV({ ...v, [k]: x })
  const basis = perServing ? servingG : 100
  const ready = name.trim() !== '' && !!v.kcal && !!basis && basis > 0

  // What gets stored, whichever way the numbers were typed in.
  const to100 = (x: number | undefined) =>
    !x || !basis ? 0 : Math.round((x * 100) / basis * 100) / 100

  return (
    <>
      <div className="scroll-x">
        <button className="chip" aria-pressed={perServing} onClick={() => setPerServing(true)}>
          Numbers per serving
        </button>
        <button className="chip" aria-pressed={!perServing} onClick={() => setPerServing(false)}>
          Per 100 g
        </button>
      </div>

      <div className="tiny muted">
        {perServing
          ? 'Copy the label exactly as printed — serving size first, then the numbers for that serving.'
          : 'For values already given per 100 g.'}
      </div>

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chia seeds"
        />
      </Field>
      <Field label="Brand (optional)">
        <input value={brand} onChange={(e) => setBrand(e.target.value)} />
      </Field>

      {perServing && (
        <div className="grid-2">
          <Field label="Serving size">
            <NumberInput value={servingG} unit="g" placeholder="24" onChange={setServingG} />
          </Field>
          <Field label="Called" hint="optional">
            <input
              value={servingLabel}
              onChange={(e) => setServingLabel(e.target.value)}
              placeholder="1 tbsp, 1 patty…"
            />
          </Field>
        </div>
      )}

      <div className="grid-2">
        <Field label="Calories">
          <NumberInput value={v.kcal} unit="kcal" onChange={set('kcal')} />
        </Field>
        <Field label="Protein">
          <NumberInput value={v.protein} unit="g" onChange={set('protein')} />
        </Field>
        <Field label="Carbs">
          <NumberInput value={v.carbs} unit="g" onChange={set('carbs')} />
        </Field>
        <Field label="Fat">
          <NumberInput value={v.fat} unit="g" onChange={set('fat')} />
        </Field>
        <Field label="Fibre">
          <NumberInput value={v.fiber} unit="g" onChange={set('fiber')} />
        </Field>
      </div>

      {perServing && basis && basis > 0 && v.kcal ? (
        <div className="card tight">
          <div className="tiny muted">Stored as, per 100 g</div>
          <div className="small num">
            {to100(v.kcal)} kcal · P {to100(v.protein)} C {to100(v.carbs)} F {to100(v.fat)}
          </div>
        </div>
      ) : null}

      <button
        className="btn primary block"
        disabled={!ready}
        onClick={async () => {
          const portions =
            perServing && servingG
              ? [{ label: servingLabel.trim() || `1 serving (${servingG} g)`, grams: servingG }]
              : []
          const id = await db.foods.add({
            name: name.trim(),
            brand: brand.trim() || undefined,
            kcal: to100(v.kcal),
            protein: to100(v.protein),
            carbs: to100(v.carbs),
            fat: to100(v.fat),
            fiber: to100(v.fiber),
            portions,
            defaultPortion: portions.length ? 0 : -1,
            liquid: false,
            source: 'manual',
            favorite: false,
            useCount: 0,
            lastUsed: 0,
            createdAt: Date.now(),
          })
          const food = await db.foods.get(id)
          if (food) onCreated(food)
        }}
      >
        {perServing && !basis ? 'Enter the serving size first' : 'Save food'}
      </button>
    </>
  )
}
