import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, MEAL_SUGGESTIONS, type Entry, type ISODate, type Meal, type Settings, type PlannedMeal } from '../db/db'
import {
  deleteMeal,
  lastLoggedDay,
  logFood,
  logPlanned,
  logTemplate,
  pastMeals,
  plannedTotals,
  quickFoods,
  recentMealNames,
  repeatMeal,
  sum,
  ZERO,
  type PastMeal,
} from '../db/ops'
import { addDays, formatDay, formatShort, todayISO } from '../lib/date'
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
import CopyDay from '../components/CopyDay'

/** Legacy rows used fixed lowercase keys; show them with proper names. */
const LEGACY: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}
const label = (meal: Meal) => LEGACY[meal] ?? meal

type MacroKey = 'protein' | 'carbs' | 'fat' | 'fiber'

/**
 * Fibre's target, from intake rather than fixed.
 *
 * The usual advice is a flat 30 g, which is written for someone eating 2500.
 * On 1850 that is a much denser diet than the guideline actually asks for, and
 * the guideline itself is per calorie: 14 g per 1000. Deriving it means the
 * bar moves with the diet instead of quietly getting harder as the cut goes on.
 */
const fibreTarget = (kcalTarget: number, override?: number) =>
  override && override > 0 ? override : Math.round((kcalTarget * 14) / 1000)

/**
 * Above this it stops being a good thing.
 *
 * There is no official ceiling, but the discomfort is real and arrives fairly
 * predictably somewhere past 50 g — more so when it comes from beans, chia and
 * inulin, which is exactly where his comes from. Worth a colour, not a warning.
 */
const FIBRE_PLENTY = 50

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
  const [openMacro, setOpenMacro] = useState<MacroKey | null>(null)
  const [openMeal, setOpenMeal] = useState<Meal | null>(null)
  const [copying, setCopying] = useState(false)
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
  // Anything weighed and not yet eaten, including earlier days: food that was
  // not eaten yesterday is usually eaten today, and making him weigh it again
  // to prove that would be the paper notebook all over again. It logs to the
  // day it is actually eaten, not the day it was weighed.
  const planned =
    useLiveQuery(
      () => db.plannedMeals.where('date').belowOrEqual(date).sortBy('date'),
      [date],
    ) ?? []
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
      {/* Time runs leftwards here: the right-hand tap goes back a day, which
          is the direction the days themselves are arriving from. */}
      <div className="row between">
        <button
          className="iconbtn"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= todayISO()}
          style={{ opacity: date >= todayISO() ? 0.3 : 1 }}
          aria-label="Next day"
        >
          <Icon.left />
        </button>
        <button className="btn ghost sm" onClick={() => setDate(todayISO())}>
          <strong>{formatDay(date)}</strong>
        </button>
        <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
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
              /* Under a fortnight the figure is mostly water, and the card
                 says so underneath — so it is shown plainly rather than in
                 the colour reserved for a real gain. */
              style={{
                color: !progress.settled
                  ? 'var(--text-secondary)'
                  : progress.changeKg <= 0
                    ? 'var(--success-text)'
                    : 'var(--serious)',
              }}
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

      {/* The day's arithmetic. Folded away by default: it answers a question
          worth answering, but not one worth a screenful before breakfast. */}
      {energy && (
        <details className="card tight">
          <summary className="row between" style={{ cursor: 'pointer', listStyle: 'none' }}>
            <span className="stat-label">Down by</span>
            <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <span className="stat-value num" style={{ color: 'var(--success-text)' }}>
                {energy.anchored
                  ? `${gramsFromKcal(energy.total - totals.kcal)} g`
                  : `${gramsFromKcal(energy.total - energy.rest + energy.restLow - totals.kcal)}–${gramsFromKcal(
                      energy.total - energy.rest + energy.restHigh - totals.kcal,
                    )} g`}
              </span>
              <span className="tiny muted num">
                of {gramsFromKcal((-settings.goalKgPerWeek * 7700) / 7)} g planned
              </span>
              <span className="muted"><Icon.chevron /></span>
            </span>
          </summary>

          <div className="stack tight" style={{ paddingTop: 8 }}>
            <div className="row between small num">
              <span className="secondary">Resting (BMR)</span>
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
              <span className="secondary" title="Walking about, standing, fidgeting, carrying things — the part nothing can log.">
                Everything else you did
              </span>
              <span>{energy.anchored ? energy.rest : `${energy.restLow}–${energy.restHigh}`}</span>
            </div>
            <div className="row between small num" style={{ borderTop: '1px solid var(--grid)', paddingTop: 6 }}>
              <span className="secondary">Burned</span>
              <span>
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
            <div className="tiny muted">
              {energy.anchored
                ? 'Everything else is solved against the maintenance your weight trend measured.'
                : 'Everything else is the part nothing can log, and there is not yet enough weight history to solve it — hence a range. Two weeks of weights turns it into one number.'}
              {energy.trust === 0 && ' Not moving the target yet.'}
            </div>
          </div>
        </details>
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
            <button
              key={m.key}
              className="stack tight macro-tile"
              aria-expanded={openMacro === m.key}
              onClick={() => setOpenMacro(openMacro === m.key ? null : (m.key as MacroKey))}
            >
              <div className="row" style={{ gap: 6 }}>
                <span className="swatch" style={{ background: m.color }} />
                <span className="tiny secondary">{m.label}</span>
              </div>
              <div className="small num">
                <strong>{Math.round(m.got)}</strong>
                <span className="muted"> / {m.goal} g</span>
              </div>
              <Meter value={m.got} max={m.goal} color={m.color} />
            </button>
          ))}
        </div>

        {(() => {
          const goal = fibreTarget(targets.kcal, settings.fibreTargetG)
          const ceiling = settings.fibreCeilingG ?? FIBRE_PLENTY
          const got = totals.fiber
          // Its own slot in the palette. It wore fat's green, and a second
          // green for "at target" would have collided with it twice over —
          // the meter reaching the end already says that much.
          const colour = got > ceiling ? 'var(--warning)' : 'var(--series-5)'
          return (
            <button
              className="macro-tile stack tight"
              aria-expanded={openMacro === 'fiber'}
              onClick={() => setOpenMacro(openMacro === 'fiber' ? null : 'fiber')}
            >
              <div className="row" style={{ gap: 6 }}>
                <span className="swatch" style={{ background: colour }} />
                <span className="tiny secondary grow">Fibre</span>
                <span className="small num">
                  <strong>{Math.round(got)}</strong>
                  <span className="muted"> / {goal} g</span>
                </span>
              </div>
              <Meter value={got} max={goal} color={colour} />
              {got > ceiling && (
                <div className="tiny" style={{ color: 'var(--warning)' }}>
                  Plenty. Past about {ceiling} g it tends to cost more comfort than it buys.
                </div>
              )}
            </button>
          )
        })()}

        {/* Where the number came from. A total tells you whether you are short;
            only the breakdown tells you what to do about it. Folded away
            because it is three numbers most of the time and thirty at dinner. */}
        {openMacro && (
          <div className="stack tight">
            {(() => {
              const key = openMacro
              const rows = [...entries]
                .filter((e) => (e[key] ?? 0) > 0)
                .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
              const total = rows.reduce((t, e) => t + (e[key] ?? 0), 0)
              if (rows.length === 0)
                return <div className="tiny muted">Nothing logged yet today.</div>
              return (
                <>
                  {rows.map((e) => (
                    <div className="row" key={e.id} style={{ gap: 8 }}>
                      <span className="small truncate grow">{e.name}</span>
                      <span className="tiny muted num">{Math.round(((e[key] ?? 0) / total) * 100)}%</span>
                      <span className="small num" style={{ width: 54, textAlign: 'right' }}>
                        {Math.round((e[key] ?? 0) * 10) / 10} g
                      </span>
                    </div>
                  ))}
                  <div className="row between tiny muted num">
                    <span>{rows.length} items</span>
                    <span>{Math.round(total * 10) / 10} g total</span>
                  </div>
                </>
              )
            })()}
          </div>
        )}

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
                {items.length > 0 && (
                  <>
                    <span className="small muted num">{Math.round(t.kcal)} kcal</span>
                    {/* The rest of the macros are a tap away rather than a
                        second line on every section, which at six sections is
                        six lines of numbers nobody reads. */}
                    <button
                      className="iconbtn"
                      aria-label={`Macros for ${label(meal)}`}
                      aria-expanded={openMeal === meal}
                      onClick={() => setOpenMeal(openMeal === meal ? null : meal)}
                    >
                      <span className="tiny muted" style={{ fontWeight: 700 }}>
                        {openMeal === meal ? '\u00d7' : 'i'}
                      </span>
                    </button>
                  </>
                )}
                <button className="iconbtn" onClick={() => setAdding(meal)} aria-label={`Add to ${label(meal)}`}>
                  <Icon.plus />
                </button>
              </div>
            </div>

            {openMeal === meal && items.length > 0 && (
              <div className="row wrap tiny num" style={{ gap: 10 }}>
                <span>
                  <strong>{Math.round(t.protein * 10) / 10}</strong> g protein
                </span>
                <span>
                  <strong>{Math.round(t.carbs * 10) / 10}</strong> g carbs
                </span>
                <span>
                  <strong>{Math.round(t.fat * 10) / 10}</strong> g fat
                </span>
                <span>
                  <strong>{Math.round(t.fiber * 10) / 10}</strong> g fibre
                </span>
                <span className="muted">{Math.round(items.reduce((g, e) => g + e.grams, 0))} g eaten</span>
              </div>
            )}

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
        <button className="btn block" onClick={() => setCopying(true)}>
          Copy from {formatDay(previousDay).toLowerCase()}
        </button>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => setNaming(true)}>
          <Icon.plus /> Add meal entry
        </button>
        {entries.length > 0 && previousDay && (
          <button className="btn grow" onClick={() => setCopying(true)}>
            Copy from {formatDay(previousDay).toLowerCase()}
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

      {copying && previousDay && (
        <CopyDay from={previousDay} to={date} onClose={() => setCopying(false)} toast={toast} />
      )}

      {naming && (
        <NameMeal
          used={meals}
          known={knownMeals}
          past={previousMeals}
          planned={planned}
          forDate={date}
          onEatPlanned={async (p) => {
            const n = await logPlanned(p, date)
            setNaming(false)
            toast(`${p.meal} logged — ${n} items`)
          }}
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
  planned = [],
  /** The day being logged, so a box weighed earlier can say so. */
  forDate,
  title = 'Add meal entry',
  onPick,
  onEatPlanned,
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
  /** Weighed this morning and not yet eaten. */
  planned?: PlannedMeal[]
  forDate?: ISODate
  title?: string
  onPick: (name: string) => void
  onEatPlanned?: (p: PlannedMeal) => void
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

      {/* Weighed already, so it is one tap and no numbers: the grams were
          settled at the scale hours ago. Offered first, because on a day these
          exist they are almost always the answer. */}
      {planned.length > 0 && onEatPlanned && (
        <div className="stack tight">
          <h3>Weighed this morning</h3>
          {planned.map((p) => {
            const t = plannedTotals(p)
            return (
              <button key={p.id} className="item" onClick={() => onEatPlanned(p)}>
                <div className="grow">
                  <div className="item-title truncate">
                    {p.meal}
                    {p.date !== forDate && (
                      <span className="tiny" style={{ color: 'var(--warning)' }}>
                        {' '}
                        · weighed {formatShort(p.date)}
                      </span>
                    )}
                  </div>
                  <div className="tiny muted truncate num">
                    {p.items.length} items · {Math.round(t.kcal)} kcal · P
                    {Math.round(t.protein * 10) / 10}
                  </div>
                </div>
                <span className="muted">
                  <Icon.plus />
                </span>
              </button>
            )
          })}
        </div>
      )}

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
