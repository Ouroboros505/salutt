import { useMemo, useState } from 'react'
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

interface Done {
  key: string
  ex: Exercise
  /** Sets for resistance work, minutes for cardio. */
  count: number
  reps: string
  weightKg?: number
}

/**
 * Logging the session that happened.
 *
 * The plan for the day arrives filled in, because most days most of it is what
 * you did. Then every number is editable and anything can be added or dropped,
 * because the cable station is taken, the day is short, or something else
 * looked better. Nothing here objects to a session that went off-plan; it only
 * records which one it was.
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
  // Plates here are marked in pounds; body weight stays metric because the
  // scale is. Stored in kilograms either way, so the two never diverge.
  const unit = settings.liftUnit ?? 'lb'
  const setUnit = (u: 'kg' | 'lb') => void db.settings.update('settings', { liftUnit: u })
  const plan = planFor(date)
  const [items, setItems] = useState<Done[]>(() =>
    (plan?.exercises ?? [])
      .map(byName)
      .filter((e): e is Exercise => !!e)
      .map((ex, i) => ({ key: `${ex.name}-${i}`, ex, count: ex.sets, reps: ex.reps })),
  )
  const [adding, setAdding] = useState<MuscleGroup | null>(null)
  const [saving, setSaving] = useState(false)

  const kcal = items.reduce((t, i) => t + exerciseKcal(i.ex, i.count, kg), 0)
  const minutes = items.reduce((t, i) => t + exerciseMinutes(i.ex, i.count), 0)
  const planned = plan?.exercises.length ?? 0
  const kept = items.filter((i) => plan?.exercises.includes(i.ex.name)).length

  const update = (key: string, patch: Partial<Done>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

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
                  { key: `${ex.name}-${xs.length}-${ex.sets}`, ex, count: ex.sets, reps: ex.reps },
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
          {plan
            ? 'Today’s plan, filled in. Change anything — fewer sets, more reps, drop what the gym was busy with.'
            : 'No session planned today. Add whatever you did.'}
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
        {items.map((i) => (
          <div
            key={i.key}
            className="stack tight"
            style={{ paddingBlock: 8, borderBottom: '1px solid var(--grid)' }}
          >
            <div className="row" style={{ gap: 8 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="item-title truncate">{i.ex.name}</div>
                <div className="tiny muted num">
                  {exerciseMinutes(i.ex, i.count)} min · {exerciseKcal(i.ex, i.count, kg)} kcal
                </div>
              </div>
              <button
                className="iconbtn"
                aria-label={`Remove ${i.ex.name}`}
                onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}
              >
                <Icon.close />
              </button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <div style={{ width: 92, flex: 'none' }}>
                <NumberInput
                  value={i.count || undefined}
                  unit={i.ex.byMinutes ? 'min' : '× sets'}
                  onChange={(v) => update(i.key, { count: v ?? 0 })}
                />
              </div>
              {!i.ex.byMinutes && (
                <>
                  <input
                    className="grow"
                    value={i.reps}
                    aria-label="Reps"
                    onChange={(e) => update(i.key, { reps: e.target.value })}
                  />
                  <div style={{ width: 96, flex: 'none' }}>
                    <NumberInput
                      value={toDisplayWeight(i.weightKg, unit)}
                      unit={unit}
                      placeholder="—"
                      onChange={(v) => update(i.key, { weightKg: fromDisplayWeight(v, unit) })}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

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
          This feeds today's energy figure, so a session you cut short costs less than a full one —
          and the target follows.
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={saving || items.length === 0}
        onClick={async () => {
          setSaving(true)
          try {
            await db.workouts.add({
              date,
              kind: items.every((i) => i.ex.group === 'Cardio') ? 'cardio' : 'strength',
              // What it was, rather than that it happened.
              name: plan ? plan.name.split(' — ')[0] : describeSession(items.map((i) => i.ex.group)),
              durationMin: minutes,
              kcal,
              sets: items.flatMap((i) =>
                i.ex.byMinutes
                  ? []
                  : Array.from({ length: Math.max(0, Math.round(i.count)) }, () => ({
                      exercise: i.ex.name,
                      reps: parseInt(i.reps, 10) || 0,
                      weightKg: i.weightKg ?? 0,
                    })),
              ),
              notes: plan && kept < planned ? `${kept} of ${planned} planned exercises` : undefined,
              createdAt: Date.now(),
            })
            toast(`${minutes} min logged — ${kcal} kcal`)
            onClose()
          } finally {
            setSaving(false)
          }
        }}
      >
        Log {minutes} min · {kcal} kcal
      </button>
    </Sheet>
  )
}
