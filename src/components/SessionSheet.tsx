import { useEffect, useMemo, useState } from 'react'
import { db, type ISODate, type Settings } from '../db/db'
import {
  CATALOGUE,
  GROUPS,
  byName,
  describeSession,
  exerciseKcal,
  exerciseMinutes,
  fromDisplayWeight,
  planFor,
  toDisplayWeight,
  type Exercise,
  type MuscleGroup,
} from '../lib/program'
import { Icon, NumberInput, Sheet } from './ui'

interface SetRow {
  reps: number
  weightKg?: number
}

interface Done {
  key: string
  name: string
  /** Sets, each with its own reps and load. Empty for the cardio entries. */
  sets: SetRow[]
  /** Minutes, for the entries counted that way. */
  minutes?: number
}

interface Draft {
  date: ISODate
  items: Done[]
}

const draftKey = (date: ISODate) => `salutt:session-draft:${date}`

function loadDraft(date: ISODate): Done[] | null {
  try {
    const raw = localStorage.getItem(draftKey(date))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Draft
    return parsed.date === date && Array.isArray(parsed.items) ? parsed.items : null
  } catch {
    return null
  }
}

function startingSets(ex: Exercise): SetRow[] {
  if (ex.byMinutes) return []
  return Array.from({ length: ex.sets }, () => ({ reps: parseInt(ex.reps, 10) || 10 }))
}

/**
 * Logging the session as it happens.
 *
 * A session is filled in between sets, not written up afterwards, so this is a
 * draft from the moment it opens: every change is kept, and closing it to
 * answer a message loses nothing. Nothing reaches the log until Finish,
 * because a half-done session in the record would be treated as a whole one by
 * everything downstream — the day's energy included.
 *
 * Sets are individual. Adding a rep or a plate as you go is the ordinary shape
 * of a working set, and flattening that into "3 x 12" throws away the only
 * progression worth watching.
 */
export default function SessionSheet({
  date,
  kg,
  settings,
  onClose,
  toast,
}: {
  date: ISODate
  kg: number
  settings: Settings
  onClose: () => void
  toast: (m: string) => void
}) {
  const unit = settings.liftUnit ?? 'lb'
  const setUnit = (u: 'kg' | 'lb') => void db.settings.update('settings', { liftUnit: u })
  const plan = planFor(date)

  const [restored] = useState(() => !!loadDraft(date))
  const [items, setItems] = useState<Done[]>(() => {
    const saved = loadDraft(date)
    if (saved) return saved
    return (plan?.exercises ?? [])
      .map(byName)
      .filter((e): e is Exercise => !!e)
      .map((ex, i) => ({
        key: `${ex.name}-${i}`,
        name: ex.name,
        sets: startingSets(ex),
        minutes: ex.byMinutes ? ex.sets : undefined,
      }))
  })
  const [adding, setAdding] = useState<MuscleGroup | null>(null)
  const [saving, setSaving] = useState(false)

  // Written on every change, so closing the sheet mid-session costs nothing.
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(date), JSON.stringify({ date, items } satisfies Draft))
    } catch {
      // Storage being full or blocked is not a reason to stop logging.
    }
  }, [date, items])

  const detail = (name: string) => byName(name)
  const countOf = (i: Done) => (i.minutes != null ? i.minutes : i.sets.length)
  const kcalOf = (i: Done) => {
    const ex = detail(i.name)
    return ex ? exerciseKcal(ex, countOf(i), kg) : 0
  }
  const minutesOf = (i: Done) => {
    const ex = detail(i.name)
    return ex ? exerciseMinutes(ex, countOf(i)) : 0
  }

  const kcal = items.reduce((t, i) => t + kcalOf(i), 0)
  const minutes = items.reduce((t, i) => t + minutesOf(i), 0)
  const planned = plan?.exercises.length ?? 0
  const kept = items.filter((i) => plan?.exercises.includes(i.name)).length

  const update = (key: string, patch: Partial<Done>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  const setSet = (key: string, idx: number, patch: Partial<SetRow>) =>
    setItems((xs) =>
      xs.map((x) =>
        x.key === key ? { ...x, sets: x.sets.map((s, j) => (j === idx ? { ...s, ...patch } : s)) } : x,
      ),
    )

  const catalogue = useMemo(
    () => (adding ? CATALOGUE.filter((e) => e.group === adding) : []),
    [adding],
  )

  if (adding) {
    return (
      <Sheet title={adding} onClose={() => setAdding(null)}>
        <div className="scroll-x">
          {GROUPS.map((g) => (
            <button key={g} className="chip" aria-pressed={g === adding} onClick={() => setAdding(g)}>
              {g}
            </button>
          ))}
        </div>
        <div className="card tight">
          {catalogue.map((ex) => (
            <button
              key={ex.name}
              className="item"
              onClick={() => {
                setItems((xs) => [
                  ...xs,
                  {
                    key: `${ex.name}-${xs.length}-${ex.sets}`,
                    name: ex.name,
                    sets: startingSets(ex),
                    minutes: ex.byMinutes ? ex.sets : undefined,
                  },
                ])
                setAdding(null)
              }}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="item-title truncate">
                  {ex.name}
                  {ex.planned && <span className="tiny" style={{ color: 'var(--success-text)' }}> · in your plan</span>}
                </div>
                <div className="tiny muted truncate num">
                  {ex.byMinutes ? `${ex.sets} min` : `${ex.sets} × ${ex.reps}`} ·{' '}
                  {exerciseKcal(ex, ex.sets, kg)} kcal
                  {ex.equipment ? ` · ${ex.equipment}` : ''}
                </div>
              </div>
              <span className="muted">
                <Icon.plus />
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={plan ? plan.name : 'Session'} onClose={onClose}>
      <div className="row between">
        <span className="tiny muted grow">
          {restored
            ? 'Picked up where you left off — nothing is logged until you finish.'
            : plan
              ? 'Today’s plan, filled in. Change it as you go; nothing is logged until you finish.'
              : 'Add what you did. Nothing is logged until you finish.'}
        </span>
        <div className="scroll-x" style={{ flex: 'none' }}>
          {(['lb', 'kg'] as const).map((u) => (
            <button key={u} className="chip" aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="card tight">
        {items.length === 0 && <div className="empty">Nothing yet — add from below.</div>}
        {items.map((i) => {
          const ex = detail(i.name)
          return (
            <div
              key={i.key}
              className="stack tight"
              style={{ paddingBlock: 8, borderBottom: '1px solid var(--grid)' }}
            >
              <div className="row" style={{ gap: 8 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="item-title truncate">{i.name}</div>
                  <div className="tiny muted num">
                    {minutesOf(i)} min · {kcalOf(i)} kcal
                    {ex?.load && !ex.byMinutes ? ` · weight = ${ex.load.label}` : ''}
                  </div>
                </div>
                <button
                  className="iconbtn"
                  aria-label={`Remove ${i.name}`}
                  onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}
                >
                  <Icon.close />
                </button>
              </div>

              {i.minutes != null ? (
                <div style={{ width: 104 }}>
                  <NumberInput
                    value={i.minutes || undefined}
                    unit="min"
                    onChange={(v) => update(i.key, { minutes: v ?? 0 })}
                  />
                </div>
              ) : (
                <>
                  {i.sets.map((set, idx) => (
                    <div className="row" key={idx} style={{ gap: 6, alignItems: 'center' }}>
                      <span className="tiny muted" style={{ width: 26, flex: 'none' }}>
                        {idx + 1}
                      </span>
                      <div style={{ width: 92, flex: 'none' }}>
                        <NumberInput
                          value={set.reps || undefined}
                          unit="reps"
                          onChange={(v) => setSet(i.key, idx, { reps: v ?? 0 })}
                        />
                      </div>
                      <div style={{ width: 96, flex: 'none' }}>
                        <NumberInput
                          value={toDisplayWeight(set.weightKg, unit)}
                          unit={unit}
                          placeholder="—"
                          onChange={(v) => setSet(i.key, idx, { weightKg: fromDisplayWeight(v, unit) })}
                        />
                      </div>
                      <span className="tiny muted grow num truncate">
                        {set.weightKg && ex?.load && ex.load.factor > 1
                          ? `${Math.round(toDisplayWeight(set.weightKg * ex.load.factor, unit) ?? 0)} ${unit} total`
                          : ''}
                      </span>
                      <button
                        className="iconbtn"
                        aria-label={`Remove set ${idx + 1}`}
                        onClick={() => update(i.key, { sets: i.sets.filter((_, j) => j !== idx) })}
                      >
                        <Icon.close />
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn sm"
                    onClick={() => {
                      // A new set starts where the last one finished, so adding
                      // a rep or a plate is one tap rather than a re-entry.
                      const last = i.sets[i.sets.length - 1]
                      update(i.key, { sets: [...i.sets, { ...(last ?? { reps: 10 }) }] })
                    }}
                  >
                    <Icon.plus /> Set
                  </button>
                </>
              )}
            </div>
          )
        })}

        <div className="scroll-x" style={{ paddingTop: 10 }}>
          {GROUPS.map((g) => (
            <button key={g} className="chip" onClick={() => setAdding(g)}>
              + {g}
            </button>
          ))}
        </div>
      </div>

      <div className="card tight">
        <div className="row between">
          <span className="stat-label">
            {minutes} min{plan ? ` · ${kept} of ${planned} planned` : ''}
          </span>
          <span className="stat-value num">{kcal} kcal</span>
        </div>
        <div className="tiny muted">
          Kept as you go. It reaches the day's energy only once you finish.
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={saving || items.length === 0}
        onClick={async () => {
          setSaving(true)
          try {
            const groups = items
              .map((i) => detail(i.name)?.group)
              .filter((g): g is MuscleGroup => !!g)
            await db.workouts.add({
              date,
              kind: groups.length > 0 && groups.every((g) => g === 'Cardio') ? 'cardio' : 'strength',
              name: plan ? plan.name.split(' — ')[0] : describeSession(groups),
              durationMin: minutes,
              kcal,
              sets: items.flatMap((i) =>
                i.sets.map((s) => ({ exercise: i.name, reps: s.reps, weightKg: s.weightKg ?? 0 })),
              ),
              notes: plan && kept < planned ? `${kept} of ${planned} planned exercises` : undefined,
              createdAt: Date.now(),
            })
            localStorage.removeItem(draftKey(date))
            toast(`${minutes} min logged — ${kcal} kcal`)
            onClose()
          } finally {
            setSaving(false)
          }
        }}
      >
        Finish and log · {minutes} min · {kcal} kcal
      </button>

      <button className="btn ghost block muted" onClick={onClose}>
        Keep for later
      </button>
    </Sheet>
  )
}
