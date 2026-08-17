import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, MEAL_SUGGESTIONS, type Entry, type ISODate, type Meal, type Settings } from '../db/db'
import {
  copyDay,
  deleteMeal,
  lastLoggedDay,
  logFood,
  logTemplate,
  pastMeals,
  quickFoods,
  recentMealNames,
  repeatMeal,
  sum,
  ZERO,
  type PastMeal,
} from '../db/ops'
import { addDays, formatDay, todayISO } from '../lib/date'
import {
  adaptiveTDEE,
  computeTargets,
  dayEnergy,
  gramsFromKcal,
  progressSoFar,
  usualActivity,
  weightTrend,
} from '../lib/metrics'
import { Icon, Meter, Sheet } from '../components/ui'
import AddFood from '../components/AddFood'

/** Legacy rows used fixed lowercase keys; show them with proper names. */
const LEGACY: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}
const label = (meal: Meal) => LEGACY[meal] ?? meal

export default function Today({
  settings,
  date,
  setDate,
  toast,
  launch,
  onLaunchHandled,
}: {
  settings: Settings
  date: ISODate
  setDate: (d: ISODate) => void
  toast: (m: string) => void
  launch?: 'food' | null
  onLaunchHandled?: () => void
}) {
  const [adding, setAdding] = useState<Meal | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [saving, setSaving] = useState<{ meal: Meal; items: Entry[] } | null>(null)
  const [naming, setNaming] = useState(false)
  const [renaming, setRenaming] = useState<Meal | null>(null)

  // Offered whenever the day is empty: repeating a previous day wholesale is
  // the fastest way to log one that looks the same, which for meal prep is
  // most of them.
  const previousDay = useLiveQuery(() => lastLoggedDay(date), [date])
  // Names you have used before, so a personal vocabulary builds up instead of
  // being retyped.
  const knownMeals = useLiveQuery(() => recentMealNames(), []) ?? []
  const previousMeals = useLiveQuery(() => pastMeals(date), [date]) ?? []


  const entries = useLiveQuery(() => db.entries.where('date').equals(date).toArray(), [date]) ?? []
  const weighIns = useLiveQuery(() => db.weighIns.toArray(), []) ?? []
  const allEntries = useLiveQuery(() => db.entries.toArray(), []) ?? []
  const quick = useLiveQuery(() => quickFoods(10), [entries.length]) ?? []
  const templates =
    useLiveQuery(() => db.mealTemplates.orderBy('lastUsed').reverse().limit(6).toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.where('date').equals(date).toArray(), [date]) ?? []


  const trend = weightTrend(weighIns, settings.trendHalfLifeDays)
  const currentKg = trend.length ? trend[trend.length - 1].trend : null

  const totals = entries.length ? sum(entries) : { ...ZERO }

  // Today's expenditure, computed from what is known and anchored to what was
  // measured, rather than an average day's figure applied to every day.
  const allWorkouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []
  const adaptive = adaptiveTDEE(allEntries, trend)
  const todayActivity = workouts.reduce((t, w) => t + (w.kcal ?? 0), 0)
  const usual = usualActivity(allWorkouts, date)
  const meanIntake = adaptive?.meanIntake ?? null
  const maintenance = adaptive && adaptive.confidence !== 'low' ? adaptive.kcal : null
  // Computed whenever there is a weight, whether or not it is trusted enough
  // to move the target — seeing the day's arithmetic is the point of it.
  const energy = currentKg
    ? dayEnergy(settings, currentKg, totals.kcal, todayActivity, maintenance, usual, meanIntake)
    : null
  const targets = computeTargets(settings, currentKg, adaptive, energy)
  const progress = progressSoFar(trend)
  const remaining = targets.kcal - totals.kcal
  const isToday = date === todayISO()
  const todayWeight = weighIns.find((w) => w.date === date)

  // The sections of the day are whatever you created, ordered by when the
  // first thing went into each — not a fixed four that assumes every day has
  // a lunch and only one snack.
  const meals: Meal[] = []
  for (const e of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!meals.includes(e.meal)) meals.push(e.meal)
  }

  // Launched from the "Log food" icon shortcut: go straight to adding.
  useEffect(() => {
    if (launch !== 'food') return
    setAdding(guessMeal(meals))
    onLaunchHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, onLaunchHandled])

  const macros = [
    { key: 'protein', label: 'Protein', color: 'var(--series-1)', got: totals.protein, goal: targets.protein },
    { key: 'carbs', label: 'Carbs', color: 'var(--series-2)', got: totals.carbs, goal: targets.carbs },
    { key: 'fat', label: 'Fat', color: 'var(--series-3)', got: totals.fat, goal: targets.fat },
  ]
  const macroKcal = [totals.protein * 4, totals.carbs * 4, totals.fat * 9]
  const macroTotal = macroKcal.reduce((a, b) => a + b, 0)

  return (
    <div className="screen">
      {/* ------------------------------------------------------ date nav */}
      <div className="row between">
        <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <Icon.left />
        </button>
        <button className="btn ghost sm" onClick={() => setDate(todayISO())}>
          <strong>{formatDay(date)}</strong>
        </button>
        <button
          className="iconbtn"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= todayISO()}
          style={{ opacity: date >= todayISO() ? 0.3 : 1 }}
          aria-label="Next day"
        >
          <Icon.chevron />
        </button>
      </div>

      {/* ------------------------------------------------------ calories */}
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="stat-label">{remaining >= 0 ? 'Remaining' : 'Over'}</div>
            <div className="hero num" style={{ color: remaining < 0 ? 'var(--critical)' : undefined }}>
              {Math.abs(Math.round(remaining)).toLocaleString()} <span className="hero-unit">kcal</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small secondary num">{Math.round(totals.kcal).toLocaleString()} eaten</div>
            <div className="small muted num">of {targets.kcal.toLocaleString()} target</div>
            {targets.energy && targets.energy.trust > 0 && (
              <div className="tiny muted num">
                {targets.energy.total.toLocaleString()} kcal out today
                {targets.energy.trust < 1
                  ? ` · counting ${Math.round(targets.energy.trust * 100)}%, ${targets.energy.logged} of ${targets.energy.days} days logged`
                  : ''}
              </div>
            )}
          </div>
        </div>

        <Meter value={totals.kcal} max={targets.kcal} color={remaining < 0 ? 'var(--critical)' : undefined} />

      {/* What the scale says, which is the only measurement here. Paper
          deficits and the trend line disagree early on and converge later. */}
      {progress && (
        <div className="card tight">
          <div className="row between">
            <span className="stat-label">Since you started, {progress.days} days ago</span>
            <span
              className="stat-value num"
              style={{ color: progress.changeKg <= 0 ? 'var(--success-text)' : 'var(--serious)' }}
            >
              {progress.changeKg <= 0 ? '' : '+'}
              {(progress.changeKg * 1000).toFixed(0)} g
            </span>
          </div>
          <div className="tiny muted num">
            {progress.fromKg.toFixed(2)} → {progress.toKg.toFixed(2)} kg on the trend line ·{' '}
            {((progress.changeKg / progress.days) * 7).toFixed(2)} kg/week against{' '}
            {settings.goalKgPerWeek} planned
          </div>
          {!progress.settled && (
            <div className="tiny muted">
              Under a fortnight, so some of this is water and glycogen rather than fat. It
              separates out as the weeks go on.
            </div>
          )}
        </div>
      )}

      {/* The day's arithmetic, laid out. Visible whether or not it is yet
          trusted enough to move the target, because "why is my number that"
          is the question a computed target invites. */}
      {energy && (
        <div className="card tight">
          <div className="card-head">
            <h3>Where today's energy went</h3>
            <span className="tiny muted">{energy.anchored ? 'measured' : 'estimated'}</span>
          </div>
          <div className="row between small num">
            <span className="secondary">Resting</span>
            <span>{energy.bmr.toLocaleString()}</span>
          </div>
          <div className="row between small num">
            <span className="secondary">Digesting what you ate</span>
            <span>{energy.digestion}</span>
          </div>
          <div className="row between small num">
            <span className="secondary">Riding and training</span>
            <span>{energy.activity}</span>
          </div>
          <div className="row between small num">
            <span className="secondary">Everything else you did</span>
            <span>
              {energy.anchored ? energy.rest : `${energy.restLow}–${energy.restHigh}`}
            </span>
          </div>
          <div className="row between" style={{ borderTop: '1px solid var(--grid)', paddingTop: 6 }}>
            <span className="stat-label">Burned</span>
            <span className="stat-value num">
              {energy.anchored
                ? energy.total.toLocaleString()
                : `${(energy.total - energy.rest + energy.restLow).toLocaleString()}–${(
                    energy.total - energy.rest + energy.restHigh
                  ).toLocaleString()}`}
            </span>
          </div>
          <div className="row between small num">
            <span className="secondary">Eaten</span>
            <span>{Math.round(totals.kcal).toLocaleString()}</span>
          </div>
          <div className="row between">
            <span className="stat-label">Down by</span>
            <span className="stat-value num" style={{ color: 'var(--success-text)' }}>
              {energy.anchored
                ? Math.round(energy.total - totals.kcal).toLocaleString()
                : `${Math.round(energy.total - energy.rest + energy.restLow - totals.kcal).toLocaleString()}–${Math.round(
                    energy.total - energy.rest + energy.restHigh - totals.kcal,
                  ).toLocaleString()}`}{' '}
              kcal
            </span>
          </div>
          {/* The number the deficit is actually for. */}
          <div className="row between small num">
            <span className="secondary">which is</span>
            <span style={{ color: 'var(--success-text)' }}>
              {energy.anchored
                ? `${gramsFromKcal(energy.total - totals.kcal)} g`
                : `${gramsFromKcal(energy.total - energy.rest + energy.restLow - totals.kcal)}–${gramsFromKcal(
                    energy.total - energy.rest + energy.restHigh - totals.kcal,
                  )} g`}{' '}
              of fat, against {gramsFromKcal((-settings.goalKgPerWeek * 7700) / 7)} g planned
            </span>
          </div>
          <div className="tiny muted">
            {energy.anchored
              ? 'Everything else is solved against the maintenance your weight trend measured.'
              : 'Everything else — walking about, standing, fidgeting — is the part nothing can log, and there is not yet enough weight history to solve it. Two weeks of weights and it becomes one number instead of a range.'}
            {energy.trust === 0 && ' Not moving the target yet.'}
          </div>
        </div>
      )}

        {macroTotal > 0 && (
          <div className="macrobar" aria-hidden="true">
            {macroKcal.map((k, i) => (
              <span key={i} style={{ flexGrow: k, background: macros[i].color }} />
            ))}
          </div>
        )}

        <div className="grid-3">
          {macros.map((m) => (
            <div key={m.key} className="stack tight">
              <div className="row" style={{ gap: 6 }}>
                <span className="swatch" style={{ background: m.color }} />
                <span className="tiny secondary">{m.label}</span>
              </div>
              <div className="small num">
                <strong>{Math.round(m.got)}</strong>
                <span className="muted"> / {m.goal} g</span>
              </div>
              <Meter value={m.got} max={m.goal} color={m.color} />
            </div>
          ))}
        </div>

        {targets.basis === 'formula' && (
          <div className="tiny muted">
            Target from a formula estimate. Log intake and weight for ~2 weeks and it switches to your
            measured maintenance.
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ quick add */}
      {(quick.length > 0 || templates.length > 0) && (
        <div className="card tight">
          <h3>Quick add</h3>
          <div className="scroll-x">
            {templates.map((t) => (
              <button
                key={`t${t.id}`}
                className="chip"
                onClick={async () => {
                  const n = await logTemplate(t, date)
                  toast(n ? `Logged ${t.name}` : 'That meal has no foods left')
                }}
              >
                <span style={{ color: 'var(--accent)' }}>★</span> {t.name}
              </button>
            ))}
            {quick.map((f) => {
              const grams = f.defaultPortion >= 0 ? f.portions[f.defaultPortion].grams : 100
              return (
                <button
                  key={f.id}
                  className="chip"
                  onClick={async () => {
                    const portionLabel =
                      f.defaultPortion >= 0 ? f.portions[f.defaultPortion].label : `${grams} g`
                    await logFood(f.id!, grams, date, guessMeal(meals), portionLabel)
                    toast(`${f.name} logged`)
                  }}
                >
                  {f.name}
                  <span className="muted num"> {Math.round((f.kcal * grams) / 100)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ meals */}
      {meals.map((meal) => {
        const items = entries.filter((e) => e.meal === meal)
        const t = sum(items)
        return (
          <div className="card tight" key={meal}>
            <div className="card-head">
              <button
                className="btn ghost sm"
                style={{ padding: 0, minHeight: 0, fontSize: 16, fontWeight: 650 }}
                onClick={() => setRenaming(meal)}
              >
                {label(meal)}
              </button>
              <div className="row" style={{ gap: 4 }}>
                {items.length > 0 && <span className="small muted num">{Math.round(t.kcal)} kcal</span>}
                <button className="iconbtn" onClick={() => setAdding(meal)} aria-label={`Add to ${label(meal)}`}>
                  <Icon.plus />
                </button>
              </div>
            </div>

            {(
              <div>
                {items.map((e) => (
                  <button key={e.id} className="item" onClick={() => setEditing(e)}>
                    <div className="grow">
                      <div className="item-title truncate">{e.name}</div>
                      <div className="tiny muted truncate">
                        {e.amountLabel}
                        {e.brand ? ` · ${e.brand}` : ''} · P {Math.round(e.protein)} C {Math.round(e.carbs)} F{' '}
                        {Math.round(e.fat)}
                      </div>
                    </div>
                    <div className="num small">{Math.round(e.kcal)}</div>
                  </button>
                ))}
                {items.some((e) => e.foodId != null) && (
                  <button className="btn sm ghost muted" onClick={() => setSaving({ meal, items })}>
                    ★ Save as quick meal
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {entries.length === 0 && previousDay && (
        <button
          className="btn block"
          onClick={async () => {
            const n = await copyDay(previousDay, date)
            toast(n ? `Copied ${n} item${n > 1 ? 's' : ''} from ${formatDay(previousDay)}` : 'Nothing to copy')
          }}
        >
          Copy {formatDay(previousDay).toLowerCase()}
        </button>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => setNaming(true)}>
          <Icon.plus /> Add meal entry
        </button>
        {entries.length > 0 && previousDay && (
          <button
            className="btn grow"
            onClick={async () => {
              const n = await copyDay(previousDay, date)
              toast(n ? `Added ${n} item${n > 1 ? 's' : ''} from ${formatDay(previousDay)}` : 'Nothing to copy')
            }}
          >
            Copy {formatDay(previousDay).toLowerCase()}
          </button>
        )}
      </div>

      {/* ------------------------------------------------------ day extras */}
      <div className="grid-2">
        <div className="card tight">
          <h3>Weight</h3>
          {todayWeight ? (
            <div className="stat-value num">
              {todayWeight.kg.toFixed(2)} <span className="hero-unit">kg</span>
            </div>
          ) : (
            <div className="small muted">{isToday ? 'Not weighed today' : 'No weigh-in'}</div>
          )}
        </div>
        <div className="card tight">
          <h3>Training</h3>
          {workouts.length ? (
            <div className="small truncate">{workouts.map((w) => w.name).join(', ')}</div>
          ) : (
            <div className="small muted">Rest day</div>
          )}
        </div>
      </div>

      {naming && (
        <NameMeal
          used={meals}
          known={knownMeals}
          past={previousMeals}
          onPick={(name) => {
            setNaming(false)
            setAdding(name)
          }}
          onRepeat={async (meal) => {
            const n = await repeatMeal(meal, date)
            setNaming(false)
            toast(n ? `Added ${meal.meal} — ${n} items` : 'Nothing to copy')
          }}
          onClose={() => setNaming(false)}
        />
      )}

      {renaming !== null && (
        <NameMeal
          initial={label(renaming)}
          used={meals.filter((m) => m !== renaming)}
          known={knownMeals}
          title={label(renaming)}
          onPick={async (name) => {
            const rows = entries.filter((e) => e.meal === renaming)
            await Promise.all(rows.map((e) => db.entries.update(e.id!, { meal: name })))
            setRenaming(null)
            toast('Renamed')
          }}
          onDelete={async () => {
            const n = await deleteMeal(date, renaming)
            setRenaming(null)
            toast(`Deleted ${n} item${n === 1 ? '' : 's'}`)
          }}
          deleteCount={entries.filter((e) => e.meal === renaming).length}
          onClose={() => setRenaming(null)}
        />
      )}

      {adding && (
        <AddFood
          date={date}
          meal={adding}
          mealsToday={meals}
          onClose={() => setAdding(null)}
          toast={toast}
        />
      )}

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} toast={toast} />}

      {saving && (
        <SaveTemplate
          meal={saving.meal}
          items={saving.items}
          onClose={() => setSaving(null)}
          toast={toast}
        />
      )}
    </div>
  )
}

/** Turns today's meal into a one-tap "quick meal" for future days. */
function SaveTemplate({
  meal,
  items,
  onClose,
  toast,
}: {
  meal: Meal
  items: Entry[]
  onClose: () => void
  toast: (m: string) => void
}) {
  const [name, setName] = useState(`My ${label(meal).toLowerCase()}`)
  const usable = items.filter((e) => e.foodId != null)

  return (
    <Sheet title="Save as quick meal" onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="card tight">
        <h3>{usable.length} items</h3>
        <div>
          {usable.map((e) => (
            <div className="item" key={e.id}>
              <div className="grow truncate">{e.name}</div>
              <span className="tiny muted num">{e.grams} g</span>
            </div>
          ))}
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={!name.trim() || usable.length === 0}
        onClick={async () => {
          await db.mealTemplates.add({
            name: name.trim(),
            meal,
            items: usable.map((e) => ({ foodId: e.foodId!, grams: e.grams })),
            useCount: 0,
            lastUsed: Date.now(),
            createdAt: Date.now(),
          })
          toast('Quick meal saved')
          onClose()
        }}
      >
        Save
      </button>
    </Sheet>
  )
}

/** Best guess at which section a quick-add belongs to, from the clock. */
function guessMeal(existing: Meal[]): Meal {
  const h = new Date().getHours()
  const wanted = h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snack'
  // Prefer a section already open today, matched loosely, so a quick-add lands
  // in "Lunch" rather than creating a second one.
  const match = existing.find((m) => m.toLowerCase() === wanted.toLowerCase())
  return match ?? existing[existing.length - 1] ?? wanted
}

/** Naming or renaming a section of the day. */
function NameMeal({
  initial = '',
  used,
  known,
  past = [],
  title = 'Add meal entry',
  onPick,
  onRepeat,
  onDelete,
  deleteCount = 0,
  onClose,
}: {
  initial?: string
  used: Meal[]
  /** Names from your own history, offered before the generic ones. */
  known: Meal[]
  /** Whole meals eaten before, repeatable in one tap. */
  past?: PastMeal[]
  title?: string
  onPick: (name: string) => void
  onRepeat?: (meal: PastMeal) => void
  onDelete?: () => void
  deleteCount?: number
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const taken = used.some((m) => m.toLowerCase() === name.trim().toLowerCase())

  const free = (n: string) => !used.some((m) => m.toLowerCase() === n.toLowerCase())
  const yours = known.filter(free)
  const generic = MEAL_SUGGESTIONS.filter(
    (sug) => free(sug) && !known.some((k) => k.toLowerCase() === sug.toLowerCase()),
  )

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Breakfast, second lunch, midnight raid…"
        />
      </div>

      {yours.length > 0 && (
        <div className="stack tight">
          <h3>You usually call it</h3>
          <div className="scroll-x">
            {yours.map((n) => (
              <button key={n} className="chip" onClick={() => onPick(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {generic.length > 0 && (
        <div className="stack tight">
          {yours.length > 0 && <h3>Or</h3>}
          <div className="scroll-x">
            {generic.map((sug) => (
              <button key={sug} className="chip" onClick={() => onPick(sug)}>
                {sug}
              </button>
            ))}
          </div>
        </div>
      )}

      {taken && <div className="tiny" style={{ color: 'var(--serious)' }}>Already used today.</div>}

      <button
        className="btn primary block"
        disabled={!name.trim() || taken}
        onClick={() => onPick(name.trim())}
      >
        {onDelete ? 'Rename' : 'Name it and add food'}
      </button>

      {onRepeat && past.length > 0 && (
        <div className="card tight">
          <h3>Or repeat one you have had</h3>
          <div>
            {past.filter((m) => free(m.meal)).map((m) => (
              <button key={`${m.date}-${m.meal}`} className="item" onClick={() => onRepeat(m)}>
                <div className="grow">
                  <div className="item-title truncate">{m.meal}</div>
                  <div className="tiny muted">
                    {formatDay(m.date)} · {m.items} item{m.items === 1 ? '' : 's'} ·{' '}
                    {Math.round(m.kcal)} kcal
                  </div>
                </div>
                <span className="muted">
                  <Icon.plus />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {onDelete && <DeleteMeal count={deleteCount} onDelete={onDelete} />}
    </Sheet>
  )
}

/** Removing a whole section, behind a confirmation because it takes items with it. */
function DeleteMeal({ count, onDelete }: { count: number; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button className="btn danger block" onClick={() => setArmed(true)}>
        <Icon.trash /> Delete this meal
      </button>
    )
  }
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn grow" onClick={() => setArmed(false)}>
        Cancel
      </button>
      <button className="btn danger grow" onClick={onDelete}>
        Delete {count} item{count === 1 ? '' : 's'}
      </button>
    </div>
  )
}

function EditEntry({
  entry,
  onClose,
  toast,
}: {
  entry: Entry
  onClose: () => void
  toast: (m: string) => void
}) {
  const [grams, setGrams] = useState(String(entry.grams))
  const g = parseFloat(grams) || 0
  const ratio = entry.grams > 0 ? g / entry.grams : 0

  return (
    <Sheet title={entry.name} onClose={onClose}>
      <div className="field">
        <label>Amount (g)</label>
        <input
          type="number"
          inputMode="decimal"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
        />
      </div>

      <div className="row between small">
        <span className="muted">Recalculated</span>
        <span className="num">
          {Math.round(entry.kcal * ratio)} kcal · P {Math.round(entry.protein * ratio)} C{' '}
          {Math.round(entry.carbs * ratio)} F {Math.round(entry.fat * ratio)}
        </span>
      </div>

      <button
        className="btn primary block"
        disabled={g <= 0}
        onClick={async () => {
          await db.entries.update(entry.id!, {
            grams: g,
            amountLabel: `${g} g`,
            kcal: Math.round(entry.kcal * ratio),
            protein: Math.round(entry.protein * ratio * 10) / 10,
            carbs: Math.round(entry.carbs * ratio * 10) / 10,
            fat: Math.round(entry.fat * ratio * 10) / 10,
            fiber: Math.round(entry.fiber * ratio * 10) / 10,
          })
          toast('Updated')
          onClose()
        }}
      >
        Save
      </button>

      <button
        className="btn danger block"
        onClick={async () => {
          await db.entries.delete(entry.id!)
          toast('Removed')
          onClose()
        }}
      >
        <Icon.trash /> Remove from log
      </button>
    </Sheet>
  )
}
