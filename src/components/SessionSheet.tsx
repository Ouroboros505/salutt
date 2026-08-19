import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ISODate, type Settings, type Workout } from '../db/db'
import {
  CATALOGUE,
  GROUPS,
  byName,
  describeSession,
  altFor,
  isProtocol,
  isTimed,
  withHold,
  parseProtocol,
  withInterval,
  repLabel,
  takesLoad,
  exerciseKcal,
  exerciseMinutes,
  fromDisplayWeight,
  planFor,
  toDisplayWeight,
  totalLoadKg,
  type Exercise,
  type MuscleGroup,
} from '../lib/program'
import { Icon, Meter, NumberInput, Sheet } from './ui'
import { formatShort } from '../lib/date'
import DemoSheet from './DemoSheet'

interface SetRow {
  reps: number
  weightKg?: number
  /**
   * Work and rest of this round, in seconds. Per round rather than per
   * exercise: a session is allowed to change its mind halfway, and five hard
   * rounds followed by five easier ones is a normal way to train, not an
   * anomaly to be modelled later.
   */
  hard?: number
  easy?: number
  /**
   * What this row is, for a block that is a named sequence.
   *
   * Carried on the row rather than looked up by position: delete the third
   * pose and every pose under it shifts into the wrong name, which is worse
   * than no name at all — it would have you holding Pigeon and reading 90/90.
   */
  label?: string
  /**
   * Ticked off as it is finished. A session is worked through in order and
   * the useful thing mid-workout is knowing where you are in it, which a page
   * of identical rows does not tell you.
   */
  done?: boolean
}

interface Done {
  key: string
  name: string
  /** The planned exercise this slot came from, when swapped for a stand-in. */
  origName?: string
  /** Work and rest of one round, in seconds, when this is an interval. */
  hard?: number
  easy?: number
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

function startingSets(ex: Exercise, saved?: { hard: number; easy: number }): SetRow[] {
  if (ex.byMinutes) return []
  // A protocol round has no count of its own; parsing one out of the text
  // only invents a number that means nothing afterwards. It carries its shape
  // instead — last session's if there is one, otherwise the plan's.
  if (ex.steps) return ex.steps.map((st) => ({ reps: st.min, label: st.name }))
  if (isProtocol(ex)) {
    const base = saved ?? parseProtocol(ex.reps) ?? { hard: 30, easy: 90 }
    return Array.from({ length: ex.sets }, () => ({ reps: 0, hard: base.hard, easy: base.easy }))
  }
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
/** Rebuilds the editable shape from a session already logged. */
function fromWorkout(w: Workout): Done[] {
  const out: Done[] = []
  for (const s of w.sets) {
    // Counted in minutes: its own item, never folded into a neighbour's sets.
    if (s.minutes != null) {
      out.push({ key: `${s.exercise}-${out.length}`, name: s.exercise, sets: [], minutes: s.minutes })
      continue
    }
    const row: SetRow = {
      reps: s.reps,
      weightKg: s.weightKg || undefined,
      hard: s.hardSec,
      easy: s.easySec,
    }
    const last = out[out.length - 1]
    if (last && last.name === s.exercise && last.minutes == null) last.sets.push(row)
    else out.push({ key: `${s.exercise}-${out.length}`, name: s.exercise, sets: [row] })
  }
  return out
}

export default function SessionSheet({
  date,
  kg,
  settings,
  workout,
  onClose,
  toast,
}: {
  date: ISODate
  kg: number
  settings: Settings
  /** An existing session being corrected, rather than a new one. */
  workout?: Workout
  onClose: () => void
  toast: (m: string) => void
}) {
  const unit = settings.liftUnit ?? 'lb'
  const setUnit = (u: 'kg' | 'lb') => void db.settings.update('settings', { liftUnit: u })
  const plan = planFor(date)

  const [restored] = useState(() => !workout && !!loadDraft(date))
  const [items, setItems] = useState<Done[]>(() => {
    if (workout) return fromWorkout(workout)
    const saved = loadDraft(date)
    if (saved) return saved
    return (plan?.exercises ?? [])
      .map(byName)
      .filter((e): e is Exercise => !!e)
      .map((ex, i) => ({
        key: `${ex.name}-${i}`,
        name: ex.name,
        sets: startingSets(ex, settings.intervals?.[ex.name]),
        minutes: ex.byMinutes ? ex.sets : undefined,
      }))
  })
  const [adding, setAdding] = useState<MuscleGroup | null>(null)
  const [saving, setSaving] = useState(false)
  const [demoName, setDemoName] = useState<string | null>(null)

  /**
   * What you did last time, per exercise.
   *
   * The weight is only worth writing down if it can be compared with the last
   * one, and nobody remembers what they pressed a week ago. Shown as a single
   * quiet line under each exercise rather than pre-filled: a reference to beat,
   * not a number to accept without thinking.
   */
  const history = useLiveQuery(
    () => db.workouts.where('date').below(date).sortBy('date'),
    [date],
  )
  const lastTime = useMemo(() => {
    const out = new Map<string, { date: ISODate; sets: { reps: number; weightKg: number }[] }>()
    // Newest first. `sortBy` always ascends whatever the collection's order, so
    // reversing it here is what makes "last time" the latest rather than the
    // first time the exercise was ever done.
    for (const w of [...(history ?? [])].reverse()) {
      for (const s of w.sets) {
        const entry = out.get(s.exercise)
        if (!entry) out.set(s.exercise, { date: w.date, sets: [{ reps: s.reps, weightKg: s.weightKg }] })
        // Only the one session, not every session it has ever appeared in.
        else if (entry.date === w.date) entry.sets.push({ reps: s.reps, weightKg: s.weightKg })
      }
    }
    return out
  }, [history])

  // Written on every change, so closing the sheet mid-session costs nothing.
  // An edit of something already logged is not a draft and must not overwrite
  // one that is in progress.
  useEffect(() => {
    if (workout) return
    try {
      localStorage.setItem(draftKey(date), JSON.stringify({ date, items } satisfies Draft))
    } catch {
      // Storage being full or blocked is not a reason to stop logging.
    }
  }, [date, items, workout])

  const detail = (name: string) => byName(name)

  /**
   * Trade an exercise for its stand-in when the machine is taken.
   *
   * The sets reset, because the alternative is a different lift at a different
   * load — carrying the old numbers over would log a rope pushdown's weight
   * against a dumbbell. The slot keeps its place in the order.
   */
  const swapForAlt = (key: string) =>
    setItems((xs) =>
      xs.map((it) => {
        if (it.key !== key) return it
        // Swapped already: go back to what the plan asked for.
        const target = it.origName ?? altFor(it.name)
        if (!target) return it
        const ex = byName(target)
        return {
          key: `${target}-${it.key}`,
          name: target,
          origName: it.origName ? undefined : it.name,
          sets: ex ? startingSets(ex) : [{ reps: 0 }],
          minutes: ex?.byMinutes ? ex.sets : undefined,
        }
      }),
    )

  /**
   * The exercise as actually performed. The catalogue writes down one shape of
   * round; the machine and the mood produce another, and the energy has to
   * follow what was done rather than what was suggested.
   */
  const shape = (name: string) => {
    const ex = byName(name)
    if (!ex || !isProtocol(ex)) return null
    const saved = settings.intervals?.[name]
    return saved ?? parseProtocol(ex.reps)
  }
  /** The shape of one round, falling back through row, memory, then plan. */
  const roundOf = (i: Done, set: SetRow) => {
    const base = shape(i.name)
    return { hard: set.hard ?? base?.hard ?? 0, easy: set.easy ?? base?.easy ?? 0 }
  }
  /** The exercise as one particular round was actually run. */
  const exFor = (i: Done, set?: SetRow): Exercise | undefined => {
    const ex = byName(i.name)
    if (!ex || !isProtocol(ex)) return ex
    const r = roundOf(i, set ?? i.sets[0] ?? { reps: 0 })
    return r.hard && r.easy ? withInterval(ex, r.hard, r.easy) : ex
  }
  const countOf = (i: Done) => (i.minutes != null ? i.minutes : i.sets.length)
  // Sets may differ from one another — a round shortened, a plank held longer
  // — so each is priced on its own rather than multiplied by a count that
  // assumes they are all alike.
  /** Each set as it was actually performed, rather than as prescribed. */
  const asDone = (i: Done, set: SetRow): Exercise | undefined => {
    const ex = byName(i.name)
    if (!ex) return undefined
    if (isProtocol(ex)) return exFor(i, set)
    if (isTimed(ex)) return withHold(ex, set.reps)
    return ex
  }
  const eachSet = (i: Done, f: (ex: Exercise) => number) =>
    i.sets.reduce((t, set) => {
      const ex = asDone(i, set)
      return t + (ex ? f(ex) : 0)
    }, 0)
  /** A sequence lasts exactly as long as the steps in it. */
  const stepMinutes = (i: Done) => i.sets.reduce((t, s) => t + (s.reps || 0), 0)
  const kcalOf = (i: Done) => {
    const ex = byName(i.name)
    if (!ex) return 0
    if (ex.steps) return Math.round((ex.met * kg * stepMinutes(i) * 60) / 3600)
    if (isProtocol(ex) || isTimed(ex)) return Math.round(eachSet(i, (e) => exerciseKcal(e, 1, kg)))
    return exerciseKcal(ex, countOf(i), kg)
  }
  const minutesOf = (i: Done) => {
    const ex = byName(i.name)
    if (!ex) return 0
    if (ex.steps) return stepMinutes(i)
    if (isProtocol(ex) || isTimed(ex)) return Math.round(eachSet(i, (e) => e.secPerSet / 60))
    return exerciseMinutes(ex, countOf(i))
  }

  const totalSets = items.reduce((t, i) => t + i.sets.length, 0)
  const doneSets = items.reduce((t, i) => t + i.sets.filter((x) => x.done).length, 0)
  const kcal = items.reduce((t, i) => t + kcalOf(i), 0)
  const minutes = items.reduce((t, i) => t + minutesOf(i), 0)
  // Time actually spent on a cardio machine, which is what you need when you
  // are standing on one deciding whether to get off. The session total is a
  // different question: it counts planks and yoga you do on the floor after.
  const cardio = items.filter((i) => detail(i.name)?.group === 'Cardio')
  const cardioMin = cardio.reduce((t, i) => t + minutesOf(i), 0)
  const cardioKcal = cardio.reduce((t, i) => t + kcalOf(i), 0)
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
                    sets: startingSets(ex, settings.intervals?.[ex.name]),
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
                    {minutesOf(i)} min{ex && isTimed(ex) ? ' with rest' : ''} · {kcalOf(i)} kcal
                    {ex && isProtocol(ex) ? ` · MET ${exFor(i)?.met}` : ''}
                    {ex?.steps ? ` · ${ex.steps.length} poses` : ''}
                    {ex?.load && !ex.byMinutes && takesLoad(ex) ? ` · weight = ${ex.load.label}` : ''}
                  </div>
                  {(() => {
                    const prev = lastTime.get(i.name)
                    if (!prev || prev.sets.length === 0 || i.minutes != null) return null
                    return (
                      <div className="tiny num" style={{ color: 'var(--text-muted)', opacity: 0.75 }}>
                        {formatShort(prev.date)}:{' '}
                        {prev.sets
                          .map((s2) =>
                            s2.weightKg
                              ? `${s2.reps}×${Math.round(toDisplayWeight(s2.weightKg, unit) ?? 0)}`
                              : `${s2.reps}`,
                          )
                          .join(' · ')}
                      </div>
                    )
                  })()}
                </div>
                <button
                  className="iconbtn"
                  aria-label={`How to do ${i.name}`}
                  title={`How to do ${i.name}`}
                  onClick={() => setDemoName(i.name)}
                >
                  <Icon.help />
                </button>
                {(altFor(i.name) || i.origName) && (
                  <button
                    className="iconbtn"
                    aria-pressed={!!i.origName}
                    style={i.origName ? { color: 'var(--accent)' } : undefined}
                    aria-label={
                      i.origName
                        ? `Switch ${i.name} back to ${i.origName}`
                        : `Machine busy — switch ${i.name} for ${altFor(i.name)}`
                    }
                    title={
                      i.origName ? `Back to ${i.origName}` : `Machine busy? Do ${altFor(i.name)} instead`
                    }
                    onClick={() => swapForAlt(i.key)}
                  >
                    <Icon.swap />
                  </button>
                )}
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
                  {/* Sets every round at once, for when the whole session is
                      one pattern. Each round can still be changed on its own
                      below — this is the shortcut, not the rule. */}
                  {ex && isProtocol(ex) && (
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span className="tiny muted" style={{ width: 30, flex: 'none' }}>
                        all
                      </span>
                      <div style={{ width: 84, flex: 'none' }}>
                        <NumberInput
                          value={i.sets[0]?.hard ?? shape(i.name)?.hard}
                          unit="s on"
                          onChange={(v) => {
                            if (!v) return
                            update(i.key, { sets: i.sets.map((x) => ({ ...x, hard: v })) })
                            const easy = i.sets[0]?.easy ?? shape(i.name)?.easy
                            if (easy)
                              void db.settings.update('settings', {
                                intervals: { ...(settings.intervals ?? {}), [i.name]: { hard: v, easy } },
                              })
                          }}
                        />
                      </div>
                      <div style={{ width: 84, flex: 'none' }}>
                        <NumberInput
                          value={i.sets[0]?.easy ?? shape(i.name)?.easy}
                          unit="s off"
                          onChange={(v) => {
                            if (!v) return
                            update(i.key, { sets: i.sets.map((x) => ({ ...x, easy: v })) })
                            const hard = i.sets[0]?.hard ?? shape(i.name)?.hard
                            if (hard)
                              void db.settings.update('settings', {
                                intervals: { ...(settings.intervals ?? {}), [i.name]: { hard, easy: v } },
                              })
                          }}
                        />
                      </div>
                      <span className="tiny muted grow truncate">sets every round</span>
                    </div>
                  )}
                  {/* The same shortcut for everything else: fill every set at
                      once, then change whichever ones went differently. Ten
                      rows of the same number is not freedom, it is typing. */}
                  {ex && !isProtocol(ex) && !ex.steps && i.sets.length > 1 && (
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span className="tiny muted" style={{ width: 30, flex: 'none' }}>
                        all
                      </span>
                      <div style={{ width: 92, flex: 'none' }}>
                        <NumberInput
                          value={i.sets[0]?.reps || undefined}
                          unit={repLabel(ex.reps)}
                          onChange={(v) =>
                            update(i.key, { sets: i.sets.map((x) => ({ ...x, reps: v ?? 0 })) })
                          }
                        />
                      </div>
                      {takesLoad(ex) && (
                        <div style={{ width: 96, flex: 'none' }}>
                          <NumberInput
                            value={toDisplayWeight(i.sets[0]?.weightKg, unit)}
                            unit={unit}
                            placeholder="—"
                            onChange={(v) =>
                              update(i.key, {
                                sets: i.sets.map((x) => ({ ...x, weightKg: fromDisplayWeight(v, unit) })),
                              })
                            }
                          />
                        </div>
                      )}
                      <span className="tiny muted grow truncate">fills every set</span>
                    </div>
                  )}
                  {i.sets.map((set, idx) => (
                    <div className="row" key={idx} style={{ gap: 6, alignItems: 'center' }}>
                      {/* Looked like a row number, so nobody pressed it. It is
                          the only way to mark a set off, so it now looks like
                          the checkbox it always was. */}
                      <button
                        className={`tickbox${set.done ? ' on' : ''}`}
                        aria-label={`Set ${idx + 1} ${set.done ? 'done' : 'not done'}`}
                        aria-pressed={!!set.done}
                        onClick={() => setSet(i.key, idx, { done: !set.done })}
                      >
                        {set.done ? <Icon.check /> : <span className="tiny num">{idx + 1}</span>}
                      </button>
                      {ex?.steps ? (
                        <>
                          <button
                            className="small grow truncate"
                            style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, color: 'inherit', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                            onClick={() => set.label && setDemoName(set.label)}
                          >
                            {set.label ?? ''}
                          </button>
                          <div style={{ width: 84, flex: 'none' }}>
                            <NumberInput
                              value={set.reps || undefined}
                              unit="min"
                              onChange={(v) => setSet(i.key, idx, { reps: v ?? 0 })}
                            />
                          </div>
                        </>
                      ) : isProtocol(ex!) ? (
                        <>
                          <div style={{ width: 84, flex: 'none' }}>
                            <NumberInput
                              value={set.hard ?? shape(i.name)?.hard}
                              unit="s on"
                              onChange={(v) => setSet(i.key, idx, { hard: v ?? undefined })}
                            />
                          </div>
                          <div style={{ width: 84, flex: 'none' }}>
                            <NumberInput
                              value={set.easy ?? shape(i.name)?.easy}
                              unit="s off"
                              onChange={(v) => setSet(i.key, idx, { easy: v ?? undefined })}
                            />
                          </div>
                        </>
                      ) : (
                        <div style={{ width: 92, flex: 'none' }}>
                          <NumberInput
                            value={set.reps || undefined}
                            unit={ex ? repLabel(ex.reps) : 'reps'}
                            onChange={(v) => setSet(i.key, idx, { reps: v ?? 0 })}
                          />
                        </div>
                      )}
                      {(!ex || (takesLoad(ex) && !isProtocol(ex))) && (
                        <div style={{ width: 96, flex: 'none' }}>
                          <NumberInput
                            value={toDisplayWeight(set.weightKg, unit)}
                            unit={unit}
                            placeholder="—"
                            onChange={(v) => setSet(i.key, idx, { weightKg: fromDisplayWeight(v, unit) })}
                          />
                        </div>
                      )}
                      {ex && !takesLoad(ex) && !isProtocol(ex) && !ex.steps && (
                        <span className="tiny muted truncate" style={{ width: 96, flex: 'none' }}>
                          {ex.reps}
                        </span>
                      )}
                      <span className="tiny muted grow num truncate">
                        {set.weightKg && ex?.load && (ex.load.factor > 1 || ex.load.barKg)
                          ? `= ${Math.round(toDisplayWeight(totalLoadKg(set.weightKg, ex.load), unit) ?? 0)} ${unit}${
                              ex.load.barKg ? ' with the bar' : ' total'
                            }`
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
        {cardio.length > 1 && (
          <div className="row between tiny muted num">
            <span>on the machines — {cardio.map((i) => `${minutesOf(i)}`).join(' + ')} min</span>
            <span>
              {cardioMin} min · {cardioKcal} kcal
            </span>
          </div>
        )}
        {totalSets > 0 && (
          <>
            <div className="row between small num">
              <span className="secondary">Sets ticked off</span>
              <span>
                {doneSets} of {totalSets}
              </span>
            </div>
            <Meter value={doneSets} max={totalSets} />
          </>
        )}
        <div className="tiny muted">
          {workout
            ? 'Saved over the session already logged.'
            : 'Saved as you go, every change. It reaches the day’s energy only once you finish.'}
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
            const row: Omit<Workout, 'id'> = {
              date,
              kind: groups.length > 0 && groups.every((g) => g === 'Cardio') ? 'cardio' : 'strength',
              name: plan ? plan.name.split(' — ')[0] : describeSession(groups),
              durationMin: minutes,
              kcal,
              sets: items.flatMap((i) =>
                i.minutes != null
                  ? [{ exercise: i.name, reps: 0, weightKg: 0, minutes: i.minutes }]
                  : i.sets.map((s) => {
                  const r = roundOf(i, s)
                  return {
                    exercise: i.name,
                    reps: s.reps,
                    weightKg: s.weightKg ?? 0,
                    ...(r.hard && r.easy ? { hardSec: r.hard, easySec: r.easy } : {}),
                  }
                }),
              ),
              notes: plan && kept < planned ? `${kept} of ${planned} planned exercises` : undefined,
              createdAt: workout?.createdAt ?? Date.now(),
            }
            if (workout?.id) await db.workouts.update(workout.id, row)
            else await db.workouts.add(row)
            if (!workout) localStorage.removeItem(draftKey(date))
            toast(workout ? 'Session updated' : `${minutes} min logged — ${kcal} kcal`)
            onClose()
          } finally {
            setSaving(false)
          }
        }}
      >
        {workout ? 'Save changes' : 'Finish and log'} · {minutes} min · {kcal} kcal
      </button>

      <button className="btn ghost block muted" onClick={onClose}>
        {workout ? 'Cancel' : 'Keep for later'}
      </button>

      {demoName && <DemoSheet name={demoName} onClose={() => setDemoName(null)} />}
    </Sheet>
  )
}
