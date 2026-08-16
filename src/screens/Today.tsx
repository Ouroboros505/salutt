import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, MEALS, type Entry, type ISODate, type Meal, type Settings } from '../db/db'
import { copyMeal, logFood, logTemplate, quickFoods, sum, ZERO } from '../db/ops'
import { addDays, formatDay, todayISO } from '../lib/date'
import { adaptiveTDEE, computeTargets, weightTrend } from '../lib/metrics'
import { Icon, Meter, Sheet } from '../components/ui'
import AddFood from '../components/AddFood'

const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
}

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

  // Launched from the "Log food" icon shortcut: go straight to adding.
  useEffect(() => {
    if (launch !== 'food') return
    setAdding(guessMeal())
    onLaunchHandled?.()
  }, [launch, onLaunchHandled])

  const entries = useLiveQuery(() => db.entries.where('date').equals(date).toArray(), [date]) ?? []
  const weighIns = useLiveQuery(() => db.weighIns.toArray(), []) ?? []
  const allEntries = useLiveQuery(() => db.entries.toArray(), []) ?? []
  const quick = useLiveQuery(() => quickFoods(10), [entries.length]) ?? []
  const templates =
    useLiveQuery(() => db.mealTemplates.orderBy('lastUsed').reverse().limit(6).toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.where('date').equals(date).toArray(), [date]) ?? []

  const trend = weightTrend(weighIns, settings.trendHalfLifeDays)
  const currentKg = trend.length ? trend[trend.length - 1].trend : null
  const targets = computeTargets(settings, currentKg, adaptiveTDEE(allEntries, trend))

  const totals = entries.length ? sum(entries) : { ...ZERO }
  const remaining = targets.kcal - totals.kcal
  const isToday = date === todayISO()
  const todayWeight = weighIns.find((w) => w.date === date)

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
          </div>
        </div>

        <Meter value={totals.kcal} max={targets.kcal} color={remaining < 0 ? 'var(--critical)' : undefined} />

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
                    const label =
                      f.defaultPortion >= 0 ? f.portions[f.defaultPortion].label : `${grams} g`
                    await logFood(f.id!, grams, date, guessMeal(), label)
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
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal)
        const t = sum(items)
        return (
          <div className="card tight" key={meal}>
            <div className="card-head">
              <h2>{MEAL_LABEL[meal]}</h2>
              <div className="row" style={{ gap: 4 }}>
                {items.length > 0 && <span className="small muted num">{Math.round(t.kcal)} kcal</span>}
                <button className="iconbtn" onClick={() => setAdding(meal)} aria-label={`Add to ${MEAL_LABEL[meal]}`}>
                  <Icon.plus />
                </button>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn sm ghost muted" onClick={() => setAdding(meal)}>
                  + Add food
                </button>
                <button
                  className="btn sm ghost muted"
                  onClick={async () => {
                    const n = await copyMeal(addDays(date, -1), date, meal)
                    toast(n ? `Copied ${n} item${n > 1 ? 's' : ''} from yesterday` : 'Nothing logged yesterday')
                  }}
                >
                  Copy yesterday
                </button>
              </div>
            ) : (
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

      {/* ------------------------------------------------------ day extras */}
      <div className="grid-2">
        <div className="card tight">
          <h3>Weight</h3>
          {todayWeight ? (
            <div className="stat-value num">
              {todayWeight.kg.toFixed(1)} <span className="hero-unit">kg</span>
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

      {adding && (
        <AddFood
          date={date}
          meal={adding}
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
  const [name, setName] = useState(`My ${MEAL_LABEL[meal].toLowerCase()}`)
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

/** Picks the meal a quick-add most likely belongs to, from the time of day. */
function guessMeal(): Meal {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 16) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
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
