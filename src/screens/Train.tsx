import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ISODate, type SetEntry, type Settings, type Workout } from '../db/db'
import { formatDay, todayISO, startOfWeek } from '../lib/date'
import { Field, Icon, NumberInput, Segmented, Sheet } from '../components/ui'
import RideSheet from '../components/RideSheet'
import { getLiveRide, clearLiveRide, liveMinutes, type LiveRide } from '../lib/liveRide'
import SessionSheet from '../components/SessionSheet'
import { TrainProgress } from '../components/progress'
import { planFor, toDisplayWeight, fromDisplayWeight, programWeek } from '../lib/program'
import { ageFrom, bmrMifflin } from '../lib/metrics'

const KINDS = [
  { value: 'strength' as const, label: 'Strength' },
  { value: 'cardio' as const, label: 'Cardio' },
  { value: 'ride' as const, label: 'Bike' },
  { value: 'other' as const, label: 'Other' },
]

export default function Train({
  date,
  setDate,
  settings,
  toast,
}: {
  date: ISODate
  setDate: (d: ISODate) => void
  settings: Settings
  toast: (m: string) => void
}) {
  const [editing, setEditing] = useState<Workout | 'new' | null>(null)
  const [riding, setRiding] = useState(false)
  // A ride timing in your pocket. Read from storage, and a slow tick keeps the
  // minutes fresh while the screen is open; the value itself is clock-based, so
  // it stays right even if the app was closed the whole ride.
  const [live, setLive] = useState<LiveRide | null>(() => getLiveRide())
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [finishing, setFinishing] = useState<LiveRide | null>(null)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNowTick(Date.now()), 5000)
    return () => clearInterval(id)
  }, [live])
  // Pick the ride back up whenever the screen returns to the front — this is
  // the moment after a ride when the stored start is read and shown.
  useEffect(() => {
    const refresh = () => {
      setLive(getLiveRide())
      setNowTick(Date.now())
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])
  const [session, setSession] = useState(false)
  // Corrections to a logged session go through the same sheet that wrote it,
  // so the catalogue and the per-set rows are all there.
  const [sessionEdit, setSessionEdit] = useState<Workout | null>(null)
  // The energy cost of moving a body scales with the body, so the estimate
  // uses the most recent weigh-in rather than a stored constant.
  const latest = useLiveQuery(() => db.weighIns.orderBy('date').last(), [])

  const workouts = useLiveQuery(() => db.workouts.orderBy('date').reverse().limit(60).toArray(), []) ?? []

  // Only the day being looked at. The week's totals are above; a wall of
  // history underneath makes it hard to see whether today has happened.
  const today = workouts.filter((w) => w.date === date)

  // The week the day being looked at belongs to, Monday to Sunday. A rolling
  // seven days answers a different question, and answers it confusingly on a
  // Monday: a week that has just begun would open carrying most of the last.
  const weekStart = startOfWeek(date)
  const weekEnd = shiftDays(weekStart, 6)
  const recent = workouts.filter((w) => w.date >= weekStart && w.date <= weekEnd)
  const thisWeek = recent.filter((w) => w.kind !== 'ride').length
  const rides = recent.filter((w) => w.kind === 'ride')
  // A plan is not a record: nothing exists until it is logged. A draft sits
  // between the two and should say so.
  const loggedToday = workouts.find((w) => w.date === date && w.kind !== 'ride')
  const draftToday = !loggedToday && !!localStorage.getItem(`salutt:session-draft:${date}`)
  const rideMin = rides.reduce((t, w) => t + (w.durationMin ?? 0), 0)
  const rideKm = rides.reduce((t, w) => t + (w.distanceKm ?? 0), 0)
  const unit = settings.liftUnit ?? 'lb'
  const volume = recent.reduce(
    (t, w) => t + w.sets.reduce((s, x) => s + x.reps * x.weightKg, 0),
    0,
  )

  const blockWeeks = settings.programWeeks ?? 8
  const week = programWeek(settings.programStartDate, todayISO(), settings.trips)

  return (
    <div className="screen">
      {live && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="row between">
            <div>
              <h3 style={{ color: 'var(--accent)' }}>
                Riding{live.place ? ` to ${live.place}` : ''}
              </h3>
              <div className="stat-value num">{liveMinutes(live, nowTick)} min</div>
              <div className="tiny muted">started {new Date(live.startedAt).toLocaleTimeString()}</div>
            </div>
            <div className="stack tight">
              <button
                className="btn primary sm"
                onClick={() => {
                  setFinishing(live)
                  setLive(null)
                }}
              >
                Finish &amp; log
              </button>
              <button
                className="btn ghost sm muted"
                onClick={() => {
                  clearLiveRide()
                  setLive(null)
                  toast('Ride discarded')
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {week != null && week >= blockWeeks && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <h3 style={{ color: 'var(--warning)' }}>Week {week} — time to change the routine</h3>
          <div className="small">
            You have run this block {week} weeks. Plan a new set of exercises for next week — keep
            what is still progressing, swap what has stalled or gone stale. Tell me and I will build
            it, then reset the counter.
          </div>
        </div>
      )}

      {/* The same day navigation as Today, and the same direction of travel. */}
      <div className="row between">
        <button
          className="iconbtn"
          onClick={() => setDate(shiftDays(date, 1))}
          disabled={date >= todayISO()}
          style={{ opacity: date >= todayISO() ? 0.3 : 1 }}
          aria-label="Next day"
        >
          <Icon.left />
        </button>
        <button className="btn ghost sm" onClick={() => setDate(todayISO())}>
          <strong>{formatDay(date)}</strong>
        </button>
        <button className="iconbtn" onClick={() => setDate(shiftDays(date, -1))} aria-label="Previous day">
          <Icon.chevron />
        </button>
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <div className="stat-label">This week</div>
            <div className="hero num">
              {thisWeek} <span className="hero-unit">session{thisWeek === 1 ? '' : 's'}</span>
            </div>
            {volume > 0 && (
              <div className="tiny muted num">
                {Math.round(toDisplayWeight(volume, unit) ?? volume).toLocaleString()} {unit} total volume
              </div>
            )}
            {/* Time and distance are the ride; how many times you got on and
                off is not. */}
            {rideMin > 0 && (
              <div className="tiny muted num">
                {Math.floor(rideMin / 60)} h {rideMin % 60} m riding
                {rideKm > 0 ? ` · ${Math.round(rideKm)} km` : ''}
                {rideKm > 0 && rideMin > 0 ? ` · ${((rideKm / rideMin) * 60).toFixed(1)} km/h` : ''}
              </div>
            )}
          </div>
          <div className="stack tight" style={{ alignItems: 'flex-end' }}>
            <button className="btn primary" onClick={() => setSession(true)}>
              <Icon.plus /> Session
            </button>
            <button className="btn sm" onClick={() => setRiding(true)}>
              <Icon.bike /> Ride
            </button>
            <button className="btn sm" onClick={() => setEditing('new')}>
              Free form
            </button>
          </div>
        </div>
      </div>

      <div className="card tight">
        <h3>{formatDay(date)}</h3>
        {today.length === 0 ? (
          <div className="empty">Nothing logged for this day yet.</div>
        ) : (
          <div>
            {today.map((w) => (
              <button
                key={w.id}
                className="item"
                onClick={() => (w.kind === 'ride' ? setEditing(w) : setSessionEdit(w))}
              >
                <div className="grow">
                  <div className="item-title truncate">{w.name}</div>
                  <div className="tiny muted truncate">{describe(w, unit)}</div>
                </div>
                <span className="muted">
                  <Icon.edit />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* What the plan asks for, and whether it has happened yet. A plan and
          a log look alike on a screen, and confusing them is how a session
          gets logged twice or not at all. */}
      {planFor(date) && (
        <button className="card tight" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSession(true)}>
          <div className="row between">
            <span className="stat-label">
              {loggedToday ? 'Logged today' : draftToday ? 'In progress — not logged yet' : 'Planned today — not logged yet'}
            </span>
            <span className="muted"><Icon.chevron /></span>
          </div>
          <div className="small">{planFor(date)!.name}</div>
          {planFor(date)!.note && <div className="tiny muted">{planFor(date)!.note}</div>}
          <div className="tiny muted">
            {loggedToday
              ? `${loggedToday.name} · ${loggedToday.durationMin ?? 0} min · ${loggedToday.kcal ?? 0} kcal recorded`
              : draftToday
                ? 'Tap to carry on where you left off'
                : `${planFor(date)!.exercises.length} exercises suggested · tap to log what you actually did`}
          </div>
        </button>
      )}

      {/* How it is going, under what is happening today. */}
      <TrainProgress unit={unit} today={todayISO()} />

      {sessionEdit && (
        <SessionSheet
          date={sessionEdit.date}
          kg={latest?.kg ?? 70}
          settings={settings}
          workout={sessionEdit}
          onClose={() => setSessionEdit(null)}
          toast={toast}
        />
      )}

      {session && (
        <SessionSheet
          date={date}
          kg={latest?.kg ?? 70}
          settings={settings}
          onClose={() => setSession(false)}
          toast={toast}
        />
      )}

      {riding && (
        <RideSheet
          date={date}
          kg={latest?.kg ?? 70}
          bmrPerMin={
            bmrMifflin(latest?.kg ?? 70, settings.heightCm, ageFrom(settings.birthDate), settings.sex) / 1440
          }
          onClose={() => setRiding(false)}
          toast={toast}
        />
      )}

      {finishing && (
        <RideSheet
          date={date}
          kg={latest?.kg ?? 70}
          bmrPerMin={
            bmrMifflin(latest?.kg ?? 70, settings.heightCm, ageFrom(settings.birthDate), settings.sex) / 1440
          }
          initial={{
            place: finishing.place,
            km: finishing.km,
            climbM: finishing.climbM,
            loadKg: finishing.loadKg,
            routeId: finishing.routeId ?? null,
            minutes: liveMinutes(finishing, Date.now()),
          }}
          onClose={() => setFinishing(null)}
          toast={toast}
        />
      )}

      {editing && (
        <WorkoutSheet
          workout={editing === 'new' ? undefined : editing}
          unit={unit}
          date={date}
          onClose={() => setEditing(null)}
          toast={toast}
        />
      )}
    </div>
  )
}

function describe(w: Workout, unit: 'kg' | 'lb' = 'kg'): string {
  const bits: string[] = []
  if (w.sets.length) {
    const vol = w.sets.reduce((s, x) => s + x.reps * x.weightKg, 0)
    bits.push(`${w.sets.length} sets`)
    if (vol > 0) bits.push(`${Math.round(toDisplayWeight(vol, unit) ?? vol).toLocaleString()} ${unit} volume`)
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
  unit,
  date,
  onClose,
  toast,
}: {
  workout?: Workout
  unit: 'kg' | 'lb'
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
              <div style={{ width: 92, flex: 'none' }}>
                <NumberInput
                  value={toDisplayWeight(s.weightKg, unit) || undefined}
                  unit={unit}
                  onChange={(v) => setSet(i, { weightKg: fromDisplayWeight(v, unit) ?? 0 })}
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
          {w.sets.length > 0 && <div className="tiny muted">exercise · reps · {unit}</div>}
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
