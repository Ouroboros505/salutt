import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ISODate, type SetEntry, type Workout } from '../db/db'
import { formatDay, todayISO } from '../lib/date'
import { Field, Icon, NumberInput, Segmented, Sheet } from '../components/ui'

const KINDS = [
  { value: 'strength' as const, label: 'Strength' },
  { value: 'cardio' as const, label: 'Cardio' },
  { value: 'other' as const, label: 'Other' },
]

export default function Train({ date, toast }: { date: ISODate; toast: (m: string) => void }) {
  const [editing, setEditing] = useState<Workout | 'new' | null>(null)

  const workouts = useLiveQuery(() => db.workouts.orderBy('date').reverse().limit(60).toArray(), []) ?? []

  const byDate = workouts.reduce<Record<string, Workout[]>>((acc, w) => {
    ;(acc[w.date] ??= []).push(w)
    return acc
  }, {})

  const thisWeek = workouts.filter((w) => w.date > shiftDays(todayISO(), -7)).length
  const volume = workouts
    .filter((w) => w.date > shiftDays(todayISO(), -7))
    .reduce((t, w) => t + w.sets.reduce((s, x) => s + x.reps * x.weightKg, 0), 0)

  return (
    <div className="screen">
      <div className="card">
        <div className="row between">
          <div>
            <div className="stat-label">Last 7 days</div>
            <div className="hero num">
              {thisWeek} <span className="hero-unit">session{thisWeek === 1 ? '' : 's'}</span>
            </div>
            {volume > 0 && (
              <div className="tiny muted num">{Math.round(volume).toLocaleString()} kg total volume</div>
            )}
          </div>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Icon.plus /> Log
          </button>
        </div>
      </div>

      {Object.keys(byDate).length === 0 && (
        <div className="card">
          <div className="empty">
            No sessions logged yet. Strength work is what keeps the weight you lose from coming off
            muscle.
          </div>
        </div>
      )}

      {Object.entries(byDate).map(([d, list]) => (
        <div className="card tight" key={d}>
          <h3>{formatDay(d)}</h3>
          <div>
            {list.map((w) => (
              <button key={w.id} className="item" onClick={() => setEditing(w)}>
                <div className="grow">
                  <div className="item-title truncate">{w.name}</div>
                  <div className="tiny muted truncate">{describe(w)}</div>
                </div>
                <span className="muted">
                  <Icon.edit />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <WorkoutSheet
          workout={editing === 'new' ? undefined : editing}
          date={date}
          onClose={() => setEditing(null)}
          toast={toast}
        />
      )}
    </div>
  )
}

function describe(w: Workout): string {
  const bits: string[] = []
  if (w.sets.length) {
    const vol = w.sets.reduce((s, x) => s + x.reps * x.weightKg, 0)
    bits.push(`${w.sets.length} sets`)
    if (vol > 0) bits.push(`${Math.round(vol).toLocaleString()} kg volume`)
  }
  if (w.durationMin) bits.push(`${w.durationMin} min`)
  if (w.distanceKm) bits.push(`${w.distanceKm} km`)
  if (w.kcal) bits.push(`${w.kcal} kcal`)
  return bits.join(' · ') || w.kind
}

function shiftDays(d: ISODate, n: number): ISODate {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}

function WorkoutSheet({
  workout,
  date,
  onClose,
  toast,
}: {
  workout?: Workout
  date: ISODate
  onClose: () => void
  toast: (m: string) => void
}) {
  const [w, setW] = useState<Omit<Workout, 'id' | 'createdAt'>>(
    workout ?? {
      date: date,
      kind: 'strength',
      name: '',
      sets: [],
      durationMin: undefined,
      kcal: undefined,
      distanceKm: undefined,
      notes: '',
    },
  )

  const setSet = (i: number, patch: Partial<SetEntry>) =>
    setW({ ...w, sets: w.sets.map((s, j) => (i === j ? { ...s, ...patch } : s)) })

  const addSet = () => {
    const prev = w.sets.at(-1)
    setW({
      ...w,
      sets: [...w.sets, prev ? { ...prev } : { exercise: '', reps: 8, weightKg: 20 }],
    })
  }

  return (
    <Sheet title={workout ? 'Edit session' : 'Log session'} onClose={onClose}>
      <Segmented value={w.kind} options={KINDS} onChange={(kind) => setW({ ...w, kind })} />

      <Field label="Date">
        <input type="date" value={w.date} onChange={(e) => setW({ ...w, date: e.target.value })} />
      </Field>

      <Field label="Name">
        <input
          autoFocus
          value={w.name}
          onChange={(e) => setW({ ...w, name: e.target.value })}
          placeholder={w.kind === 'strength' ? 'Push day' : w.kind === 'cardio' ? 'Easy run' : 'Session'}
        />
      </Field>

      {w.kind === 'strength' && (
        <div className="card tight">
          <div className="card-head">
            <h3>Sets</h3>
            <button className="btn sm" onClick={addSet}>
              <Icon.plus /> Set
            </button>
          </div>

          {w.sets.length === 0 && <div className="empty">No sets yet</div>}

          {w.sets.map((s, i) => (
            <div className="row" key={i} style={{ gap: 6, paddingBlock: 4 }}>
              <input
                className="grow"
                value={s.exercise}
                placeholder="Exercise"
                onChange={(e) => setSet(i, { exercise: e.target.value })}
              />
              <div style={{ width: 76, flex: 'none' }}>
                <NumberInput
                  value={s.reps || undefined}
                  unit="×"
                  onChange={(v) => setSet(i, { reps: v ?? 0 })}
                />
              </div>
              <div style={{ width: 86, flex: 'none' }}>
                <NumberInput
                  value={s.weightKg || undefined}
                  unit="kg"
                  onChange={(v) => setSet(i, { weightKg: v ?? 0 })}
                />
              </div>
              <button
                className="iconbtn"
                aria-label="Delete set"
                onClick={() => setW({ ...w, sets: w.sets.filter((_, j) => j !== i) })}
              >
                <Icon.close />
              </button>
            </div>
          ))}
          {w.sets.length > 0 && <div className="tiny muted">exercise · reps · kg</div>}
        </div>
      )}

      <div className="grid-2">
        <Field label="Duration (min)">
          <NumberInput
            value={w.durationMin}
            unit="min"
            onChange={(v) => setW({ ...w, durationMin: v })}
          />
        </Field>
        {w.kind === 'cardio' ? (
          <Field label="Distance (km)">
            <NumberInput value={w.distanceKm} unit="km" onChange={(v) => setW({ ...w, distanceKm: v })} />
          </Field>
        ) : (
          <Field label="Calories" hint="optional">
            <NumberInput value={w.kcal} unit="kcal" onChange={(v) => setW({ ...w, kcal: v })} />
          </Field>
        )}
      </div>

      <Field label="Notes">
        <textarea rows={2} value={w.notes ?? ''} onChange={(e) => setW({ ...w, notes: e.target.value })} />
      </Field>

      <button
        className="btn primary block"
        disabled={!w.name.trim()}
        onClick={async () => {
          if (workout?.id) await db.workouts.update(workout.id, w)
          else await db.workouts.add({ ...w, createdAt: Date.now() })
          toast('Session saved')
          onClose()
        }}
      >
        Save
      </button>

      {workout?.id && (
        <button
          className="btn danger block"
          onClick={async () => {
            await db.workouts.delete(workout.id!)
            toast('Deleted')
            onClose()
          }}
        >
          <Icon.trash /> Delete session
        </button>
      )}

      <div className="tiny muted">
        Salutt does not add workout calories back to your target — the adaptive maintenance number
        already includes how much you train.
      </div>
    </Sheet>
  )
}
