import type { ISODate, Workout } from '../db/db'
import { addDays, daysBetween, startOfWeek } from './date'
import { byName, canonicalName, totalLoadKg, type MuscleGroup } from './program'

/**
 * What the training log says about one lift, and about the training as a whole.
 *
 * Everything here is worked out from the sets as typed — the number on the
 * dumbbell or the stack — because that is the number he sees at the gym and
 * the one double progression moves. Pure functions only: the charts read
 * these, and they can be checked without a browser.
 */

export interface SetRec {
  reps: number
  kg: number
  band?: number
}

export interface ExSession {
  date: ISODate
  sets: SetRec[]
  /** The top set's load on the chart's basis: the whole bar for barbell work. */
  topLoad: number
  /** Heaviest weight used, and the most reps done at it. */
  topKg: number
  topReps: number
  /**
   * Best estimated one-rep max across the sets (Epley), 0 when unweighted.
   * On the chart's basis, so a barbell lift is the whole bar, not one side.
   */
  e1rm: number
  /** Reps times weight, summed. */
  volume: number
  reps: number
  /** Most reps in any one set, the measure for bodyweight work. */
  bestReps: number
  /** Logged while ill or tired: shown, but not a number to beat. */
  notFull: boolean
}

/** Epley. Generous above about fifteen reps, but consistent, which is what a trend needs. */
export function epley(kg: number, reps: number): number {
  if (!(kg > 0) || !(reps > 0)) return 0
  return reps === 1 ? kg : kg * (1 + reps / 30)
}

/**
 * What the chart and the estimated max are measured in.
 *
 * Barbell work is typed as the plates on one side, which is what you load —
 * but a one-rep max of one side of a bar is not a number anyone lifts. So for
 * anything with a bar the chart and the max use the whole bar, and the typed
 * figure is kept for what to load next. Dumbbells stay as one dumbbell, the
 * way they are typed and the way people talk about them.
 */
export function chartBasis(name: string): { toLoad: (typedKg: number) => number; label: string | null } {
  const load = byName(name)?.load
  if (load?.barKg) return { toLoad: (kg) => (kg > 0 ? totalLoadKg(kg, load) : 0), label: 'on the bar' }
  // Typed as one dumbbell while two are held: the label says so, the number stays one.
  if (load && load.factor === 2) return { toLoad: (kg) => kg, label: 'each hand' }
  return { toLoad: (kg) => kg, label: null }
}

/** Every session that included this exercise, oldest first, one per day. */
export function exerciseHistory(workouts: Workout[], name: string): ExSession[] {
  const key = canonicalName(name)
  const { toLoad } = chartBasis(key)
  // Two sessions on one day are one day of training on the chart: merged, so
  // a day never appears twice and its sets stay together.
  const byDate = new Map<ISODate, { sets: SetRec[]; notFull: boolean }>()
  for (const w of workouts) {
    const sets = w.sets
      .filter((s) => canonicalName(s.exercise) === key && s.minutes == null && s.hardSec == null)
      .map((s) => ({ reps: s.reps, kg: s.weightKg, band: s.band }))
      .filter((s) => s.reps > 0)
    if (!sets.length) continue
    const day = byDate.get(w.date) ?? { sets: [], notFull: false }
    day.sets.push(...sets)
    day.notFull = day.notFull || !!w.notFullStrength
    byDate.set(w.date, day)
  }
  const out: ExSession[] = []
  for (const [date, { sets, notFull }] of byDate) {
    const topKg = Math.max(...sets.map((s) => s.kg))
    const topReps = Math.max(...sets.filter((s) => s.kg === topKg).map((s) => s.reps))
    out.push({
      date,
      sets,
      topKg,
      topLoad: toLoad(topKg),
      topReps,
      e1rm: Math.max(...sets.map((s) => epley(toLoad(s.kg), s.reps))),
      volume: sets.reduce((t, s) => t + s.reps * s.kg, 0),
      reps: sets.reduce((t, s) => t + s.reps, 0),
      bestReps: Math.max(...sets.map((s) => s.reps)),
      notFull,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export function isWeighted(history: ExSession[]): boolean {
  return history.some((s) => s.topKg > 0)
}

export interface ToBeat {
  /** What last time's best looked like. */
  last: ExSession
  /** True when every set at the top weight reached the ceiling: time to go up. */
  readyToMoveUp: boolean
  /** The one-line instruction. */
  headline: 'up' | 'rep' | 'reps-bw'
  /** Reps to aim for at the top weight (one more than last time). */
  targetReps: number
}

/**
 * The next thing to beat, by his own double-progression rule.
 *
 * He stays at a weight until every set at it reaches the top of the range,
 * then moves up — and the reps fall back after each increase, which is the
 * rule working rather than a stall. So the target is one more rep at the top
 * weight, until the top weight is done, and then a step up. A session logged
 * while ill is skipped, as it is everywhere else.
 */
export function toBeat(history: ExSession[], ceiling = 15): ToBeat | null {
  const last = [...history].reverse().find((s) => !s.notFull)
  if (!last) return null
  if (last.topKg <= 0) {
    return { last, readyToMoveUp: false, headline: 'reps-bw', targetReps: last.bestReps + 1 }
  }
  const atTop = last.sets.filter((s) => s.kg === last.topKg)
  const done = atTop.length >= 2 && atTop.every((s) => s.reps >= ceiling)
  return {
    last,
    readyToMoveUp: done,
    headline: done ? 'up' : 'rep',
    targetReps: Math.min(ceiling, Math.min(...atTop.map((s) => s.reps)) + 1),
  }
}

/** What to put in each set today, before anything is typed. */
export interface Suggestion {
  /** One per set, in order; `up` marks a set that moved to a heavier weight. */
  sets: { reps: number; kg: number; up: boolean }[]
  /**
   * Which way it moved. `rep`: same weights, a rep more. `up`: every set went
   * heavier. `mixed`: some sets went heavier, the rest add a rep. `back`: the
   * first session after a break. `bw`: no weight to move.
   */
  why: 'rep' | 'up' | 'mixed' | 'back' | 'bw'
  /** The weight step used, so the line under the lift can say it. */
  stepKg: number
}

/** A gap in training longer than this is a break, and the first session back is lighter. */
export const BREAK_DAYS = 14

/**
 * The smallest jump this lift's equipment allows, learned from the log.
 *
 * Racks go up in 5 lb, some cable stacks in 2.5 or 7.5, barbell plates by a
 * side. Rather than keep a table of every machine at the CoRec, the step is the
 * smallest difference between two weights he has actually used on it, which
 * is the machine telling us its own increment. Until there are two weights to
 * compare, the fallback is the usual one.
 */
export function weightStepKg(history: ExSession[], fallbackKg: number): number {
  const used = [...new Set(history.flatMap((s) => s.sets.map((x) => Math.round(x.kg * 100) / 100)))]
    .filter((kg) => kg > 0)
    .sort((a, b) => a - b)
  // Under half a kilo is the same plate typed twice through a unit
  // conversion (7.94 and 7.96 are both 17.5 lb), not a step, so it is skipped
  // rather than allowed to win; over 5 kg is a jump he chose, not the smallest.
  let step = Infinity
  for (let i = 1; i < used.length; i++) {
    const d = used[i] - used[i - 1]
    if (d >= 0.5) step = Math.min(step, d)
  }
  return step <= 5 ? step : fallbackKg
}

/**
 * Reps at a new weight that match the strength of a set just done (Epley),
 * rounded up so the heavier set is never a step backwards.
 */
function repsToMatch(kg: number, reps: number, newKg: number): number {
  return Math.ceil(30 * (epley(kg, reps) / newKg - 1))
}

/**
 * Today's sets, by double progression applied set by set.
 *
 * Both directions are in it, and which one applies is not a matter of taste:
 * a set below the top of its range gets one more rep at the same weight; a set
 * at or past the top goes a step heavier. He ramps (20, 20, 22.5 on the bench),
 * so each set is judged on its own rather than the session on its heaviest.
 *
 * The reps after a step up are the ones that match the strength of the set
 * that earned it, not the bottom of the range: fifteen at 20 lb dropping to
 * eight at 22.5 is a weaker set, however heavy it looks, and would score as
 * going backwards. Matched on the real load, so a bar's own weight counts.
 *
 * A step the set has not yet paid for is not taken. Small dumbbells jump 12%
 * at a time, and twelve curls at 17.5 lb match only seven at 20; asking for
 * the bottom of the range there asks for strength he has not shown. Up to one
 * rep short is allowed, the same effort as the usual one-rep step; beyond
 * that the set stays at its weight for one more rep until the jump is earned. Added weight
 * on a bodyweight lift is the exception: the body is most of the load, so the
 * small plate is never the big jump it looks like.
 *
 * A set the plan now has but the last session did not, like a fourth set of
 * raises, repeats the last set as it went rather than inventing progress.
 *
 * After a break in training of more than two weeks (not one lift skipped for a
 * fortnight, which is just a Friday missed twice), the first session back is
 * about 80% of the weight at the same reps: the return rule that tendons need,
 * which the September hip taught the hard way.
 */
export function suggestSets(
  history: ExSession[],
  range: { low: number; top: number },
  count: number,
  today: ISODate,
  fallbackStepKg: number,
  /** Last day of any full-strength training, whatever the lift. */
  lastTrained?: ISODate,
  /**
   * The spacing of real weights, for free weights: dumbbells and plates come
   * in 2.5 lb, so a step learned from an odd entry must not invent a 27 lb
   * dumbbell. Cable and machine stacks have no grid; their pins are learned.
   */
  gridKg?: number,
  /**
   * Typed weight to the load actually moved (a barbell's plates plus the
   * bar), and whether the typed number is only weight added to the body.
   */
  load?: { toLoad?: (kg: number) => number; addedOnly?: boolean },
): Suggestion | null {
  const last = [...history].reverse().find((s) => !s.notFull)
  if (!last || !last.sets.length || count <= 0) return null
  const snap = (kg: number) => (gridKg ? Math.round(kg / gridKg) * gridKg : kg)
  const learned = weightStepKg(history, fallbackStepKg)
  const stepKg = gridKg ? Math.max(gridKg, snap(learned)) : learned
  const used = [...new Set(history.flatMap((s) => s.sets.map((x) => x.kg)))].filter((kg) => kg > 0).sort((a, b) => a - b)
  /**
   * The next weight up. A cable stack's pins are not evenly spaced (his log
   * reads 24, 25.5, 27.5, 29 lb), so a fixed step lands between two pins; the
   * next weight he has already used on the lift is a pin that exists. Past
   * anything he has used, the learned step.
   */
  const nextUp = (kg: number) => {
    const pin = used.find((u) => u > kg + 0.05)
    return pin != null && pin - kg < 2 * stepKg - 0.05 ? pin : kg + stepKg
  }
  const nth = (i: number) => last.sets[Math.min(i, last.sets.length - 1)]
  const make = (f: (s: SetRec) => Suggestion['sets'][number]) => Array.from({ length: count }, (_, i) => f(nth(i)))
  const clamp = (r: number) => Math.max(range.low, Math.min(range.top, r))

  if (lastTrained && daysBetween(lastTrained, today) > BREAK_DAYS) {
    return {
      why: 'back',
      stepKg,
      sets: make((s) => ({
        reps: s.kg > 0 ? Math.min(range.top, s.reps) : Math.max(1, Math.round(s.reps * 0.8)),
        kg: s.kg > 0 ? Math.max(stepKg, Math.floor((s.kg * 0.8) / (gridKg ?? stepKg) + 1e-6) * (gridKg ?? stepKg)) : 0,
        up: false,
      })),
    }
  }
  if (last.topKg <= 0) {
    return { why: 'bw', stepKg, sets: make((s) => ({ reps: s.reps + 1, kg: 0, up: false })) }
  }
  const real = load?.toLoad ?? ((kg: number) => kg)
  const final = last.sets[last.sets.length - 1]
  const sets = Array.from({ length: count }, (_, i): Suggestion['sets'][number] => {
    if (i >= last.sets.length) return { reps: final.reps, kg: final.kg, up: false }
    const s = last.sets[i]
    if (s.kg <= 0) return { reps: s.reps + 1, kg: 0, up: false }
    if (s.reps < range.top) return { reps: s.reps + 1, kg: s.kg, up: false }
    const kg = snap(nextUp(s.kg))
    const matched = repsToMatch(real(s.kg), s.reps, real(kg))
    // One rep short of the range is the same effort as the +1 a rep step
    // asks for; more than that is strength not yet shown.
    if (matched < range.low - 1 && !load?.addedOnly) return { reps: s.reps + 1, kg: s.kg, up: false }
    return { reps: clamp(matched), kg, up: true }
  })
  const ups = sets.filter((x) => x.up).length
  return { why: ups === 0 ? 'rep' : ups === sets.length ? 'up' : 'mixed', stepKg, sets }
}

export interface Records {
  heaviest: { kg: number; reps: number; date: ISODate } | null
  bestE1rm: { kg: number; date: ISODate } | null
  bestVolume: { kg: number; date: ISODate } | null
  mostReps: { reps: number; date: ISODate } | null
}

export function records(history: ExSession[]): Records {
  let heaviest: Records['heaviest'] = null
  let bestE1rm: Records['bestE1rm'] = null
  let bestVolume: Records['bestVolume'] = null
  let mostReps: Records['mostReps'] = null
  for (const s of history) {
    if (s.topKg > 0 && (!heaviest || s.topKg > heaviest.kg || (s.topKg === heaviest.kg && s.topReps > heaviest.reps)))
      heaviest = { kg: s.topKg, reps: s.topReps, date: s.date }
    if (s.e1rm > 0 && (!bestE1rm || s.e1rm > bestE1rm.kg)) bestE1rm = { kg: s.e1rm, date: s.date }
    if (s.volume > 0 && (!bestVolume || s.volume > bestVolume.kg)) bestVolume = { kg: s.volume, date: s.date }
    if (!mostReps || s.bestReps > mostReps.reps) mostReps = { reps: s.bestReps, date: s.date }
  }
  return { heaviest, bestE1rm, bestVolume, mostReps }
}

/**
 * Change in estimated strength over a window, as a fraction.
 *
 * Compared best-to-best — the best of the latest window against the best of
 * the one before — so a single tired session does not read as going backward.
 */
export function strengthChange(history: ExSession[], today: ISODate, days = 28): number | null {
  const recent = history.filter((s) => s.date > addDays(today, -days) && s.e1rm > 0 && !s.notFull)
  const before = history.filter(
    (s) => s.date <= addDays(today, -days) && s.date > addDays(today, -2 * days) && s.e1rm > 0 && !s.notFull,
  )
  if (!recent.length || !before.length) return null
  const a = Math.max(...before.map((s) => s.e1rm))
  const b = Math.max(...recent.map((s) => s.e1rm))
  return a > 0 ? (b - a) / a : null
}

/** Days since the exercise was last done, or null if never. */
export function daysSince(history: ExSession[], today: ISODate): number | null {
  const last = history[history.length - 1]
  return last ? daysBetween(last.date, today) : null
}

/* ------------------------------------------------------------ the calendar */

export type DayKind = 'push' | 'pull' | 'legs' | 'core' | 'ride'

const KIND_OF: Partial<Record<MuscleGroup, DayKind>> = {
  Chest: 'push',
  Shoulders: 'push',
  Triceps: 'push',
  Back: 'pull',
  Biceps: 'pull',
  Legs: 'legs',
  Core: 'core',
  Cardio: 'core',
  Mobility: 'core',
}

/**
 * What kind of session a workout was, from what was actually in it.
 *
 * Counted by sets rather than read from the name, because the name is
 * whatever the plan or a free-form entry said, and a legs day carries a few
 * sets of pulldowns and raises without being a pull day.
 */
export function kindOf(w: Workout): DayKind | null {
  if (w.kind === 'ride') return 'ride'
  const tally = new Map<DayKind, number>()
  for (const s of w.sets) {
    const g = byName(s.exercise)?.group
    const k = g ? KIND_OF[g] : undefined
    if (k) tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  if (!tally.size) return w.kind === 'cardio' ? 'core' : null
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

export interface CalDay {
  date: ISODate
  /** The main session of the day, if there was one. */
  session: DayKind | null
  sessionName?: string
  sets: number
  rideMin: number
  rides: number
}

/** Every day in the last `weeks` whole weeks, Monday first, ending this week. */
export function trainingCalendar(workouts: Workout[], today: ISODate, weeks = 12): CalDay[][] {
  const first = addDays(startOfWeek(today), -7 * (weeks - 1))
  const byDate = new Map<ISODate, Workout[]>()
  for (const w of workouts) {
    if (w.date < first) continue
    const list = byDate.get(w.date) ?? []
    list.push(w)
    byDate.set(w.date, list)
  }
  const cols: CalDay[][] = []
  for (let wk = 0; wk < weeks; wk++) {
    const col: CalDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(first, wk * 7 + d)
      const ws = byDate.get(date) ?? []
      const lifts = ws.filter((w) => w.kind !== 'ride')
      const main = lifts.sort((a, b) => b.sets.length - a.sets.length)[0]
      const rides = ws.filter((w) => w.kind === 'ride')
      col.push({
        date,
        session: main ? kindOf(main) : null,
        sessionName: main?.name,
        sets: lifts.reduce((t, w) => t + w.sets.length, 0),
        rideMin: rides.reduce((t, w) => t + (w.durationMin ?? 0), 0),
        rides: rides.length,
      })
    }
    cols.push(col)
  }
  return cols
}

/** Sessions, and hours of riding, in the last 28 days up to and including today. */
export function last28(cal: CalDay[][], today: ISODate): { sessions: number; rideHours: number } {
  const from = addDays(today, -27)
  const days = cal.flat().filter((d) => d.date >= from && d.date <= today)
  return {
    sessions: days.filter((d) => d.session).length,
    rideHours: days.reduce((t, d) => t + d.rideMin, 0) / 60,
  }
}

/** Weeks in a row, ending this one or last, with at least `min` sessions. */
export function weekStreak(cal: CalDay[][], today: ISODate, min = 3): number {
  const done = cal.map((col) => col.filter((d) => d.session && d.date <= today).length)
  let i = done.length - 1
  // The week in progress counts once it qualifies, but does not break the
  // streak just because it is only Tuesday.
  if (done[i] < min) i--
  let n = 0
  for (; i >= 0 && done[i] >= min; i--) n++
  return n
}

/* --------------------------------------------------- sets per muscle group */

export const VOLUME_GROUPS: MuscleGroup[] = ['Back', 'Shoulders', 'Chest', 'Legs', 'Biceps', 'Triceps', 'Core']

export interface GroupVolume {
  group: MuscleGroup
  /** Average hard sets a week over the window. */
  perWeek: number
  /** Sets so far in the current week. */
  thisWeek: number
}

/**
 * Hard sets per muscle group per week.
 *
 * Sets, not tonnage: across a range of rep counts the number of hard sets is
 * what tracks muscle growth, and it is the number a plan can be checked
 * against — roughly ten to twenty a week per muscle is the range most of the
 * research lands on. Averaged over the last whole weeks, with the current
 * week shown separately so a Tuesday does not look like a bad week.
 */
export function weeklySets(workouts: Workout[], today: ISODate, weeks = 4): GroupVolume[] {
  const thisMonday = startOfWeek(today)
  const from = addDays(thisMonday, -7 * weeks)
  const window = new Map<MuscleGroup, number>()
  const current = new Map<MuscleGroup, number>()
  for (const w of workouts) {
    if (w.kind === 'ride' || w.date < from || w.date > today) continue
    for (const s of w.sets) {
      if (s.minutes != null || !(s.reps > 0)) continue
      const g = byName(s.exercise)?.group
      if (!g) continue
      const into = w.date >= thisMonday ? current : window
      into.set(g, (into.get(g) ?? 0) + 1)
    }
  }
  return VOLUME_GROUPS.map((group) => ({
    group,
    perWeek: (window.get(group) ?? 0) / weeks,
    thisWeek: current.get(group) ?? 0,
  }))
}

/** Every weighted or repped exercise ever logged, most recently done first. */
export function loggedExercises(workouts: Workout[]): { name: string; last: ISODate; sessions: number }[] {
  const seen = new Map<string, { name: string; last: ISODate; sessions: Set<ISODate> }>()
  for (const w of workouts) {
    if (w.kind === 'ride') continue
    for (const s of w.sets) {
      if (s.minutes != null || s.hardSec != null || !(s.reps > 0)) continue
      const ex = byName(s.exercise)
      if (!ex || ex.group === 'Cardio' || ex.group === 'Mobility') continue
      const name = canonicalName(s.exercise)
      const e = seen.get(name) ?? { name, last: w.date, sessions: new Set<ISODate>() }
      if (w.date > e.last) e.last = w.date
      e.sessions.add(w.date)
      seen.set(name, e)
    }
  }
  return [...seen.values()]
    .map((e) => ({ name: e.name, last: e.last, sessions: e.sessions.size }))
    .sort((a, b) => b.last.localeCompare(a.last) || b.sessions - a.sessions)
}

/* ---------------------------------------------------- beating last time */

export type Verdict = 'up' | 'same' | 'down' | 'new'

export interface LiftCompare {
  name: string
  verdict: Verdict
  now: ExSession
  /** The session it was measured against: the last one at full strength. */
  before: ExSession | null
  /** Beat every session before it on top weight or on estimated max. */
  record: boolean
}

/** Equal to the hundredth of a kilo: lb typed in, converted, never quite exact. */
const sameKg = (a: number, b: number) => Math.abs(a - b) < 0.05

/**
 * Did this lift beat last time — the gym journal's one question.
 *
 * By the rule he trains to: more weight on the top set is progress; at the
 * same top weight, more total reps at that weight is progress. A lighter top
 * set is a step back, even with more reps, because the top weight is the
 * thing double progression moves. Bodyweight work and holds compare their
 * total reps or seconds. Compared against the last session at full strength, so a week
 * logged ill is neither a target nor a setback.
 */
export function judge(now: ExSession, before: ExSession | null): Verdict {
  if (!before) return 'new'
  if (now.topKg > 0 || before.topKg > 0) {
    if (!sameKg(now.topKg, before.topKg)) return now.topKg > before.topKg ? 'up' : 'down'
    const at = (s: ExSession) => s.sets.filter((x) => sameKg(x.kg, s.topKg)).reduce((t, x) => t + x.reps, 0)
    const a = at(now)
    const b = at(before)
    return a > b ? 'up' : a < b ? 'down' : 'same'
  }
  const bandOf = (s: ExSession) => Math.max(-1, ...s.sets.map((x) => x.band ?? -1))
  if (bandOf(now) !== bandOf(before)) return bandOf(now) > bandOf(before) ? 'up' : 'down'
  // Total reps (or seconds, for a hold): one more rep or second anywhere counts.
  return now.reps > before.reps ? 'up' : now.reps < before.reps ? 'down' : 'same'
}

/** Every lift in one session, each against its last full-strength outing. */
export function compareSession(workouts: Workout[], session: Workout): LiftCompare[] {
  const names: string[] = []
  for (const s of session.sets) {
    if (s.minutes != null || s.hardSec != null || !(s.reps > 0)) continue
    const g = byName(s.exercise)?.group
    if (g === 'Cardio' || g === 'Mobility') continue
    const n = canonicalName(s.exercise)
    if (!names.includes(n)) names.push(n)
  }
  const earlier = workouts.filter((w) => w.date < session.date)
  return names.map((name) => {
    const now = exerciseHistory([session], name)[0]
    const past = exerciseHistory(earlier, name)
    const before = [...past].reverse().find((p) => !p.notFull) ?? null
    const record =
      past.length > 0 &&
      ((now.topKg > 0 && past.every((p) => now.topKg > p.topKg + 0.05)) ||
        (now.e1rm > 0 && past.every((p) => now.e1rm > p.e1rm + 0.05)))
    return { name, verdict: judge(now, before), now, before, record }
  })
}

export interface ScoreTally {
  up: number
  same: number
  down: number
  fresh: number
  records: number
}

export function tally(cmp: LiftCompare[]): ScoreTally {
  return {
    up: cmp.filter((c) => c.verdict === 'up').length,
    same: cmp.filter((c) => c.verdict === 'same').length,
    down: cmp.filter((c) => c.verdict === 'down').length,
    fresh: cmp.filter((c) => c.verdict === 'new').length,
    records: cmp.filter((c) => c.record).length,
  }
}

export interface WeekOverload extends ScoreTally {
  weekStart: ISODate
  /** Reps times the weight as typed, the same figure the week card shows. */
  volumeKg: number
  sessions: number
}

/**
 * The overload, week by week.
 *
 * Volume is reps times the weight as typed, matching the week card, so a
 * dumbbell lift counts one dumbbell and bodyweight work counts nothing: the
 * same convention every week, which is all a trend needs. The verdicts tally
 * how many lifts beat, matched or fell short of last time. A session logged
 * as not at full strength adds its volume but no verdicts.
 */
export function overloadByWeek(workouts: Workout[], today: ISODate, weeks = 12): WeekOverload[] {
  const first = addDays(startOfWeek(today), -7 * (weeks - 1))
  const out: WeekOverload[] = []
  for (let i = 0; i < weeks; i++) {
    out.push({ weekStart: addDays(first, 7 * i), volumeKg: 0, sessions: 0, up: 0, same: 0, down: 0, fresh: 0, records: 0 })
  }
  for (const w of workouts) {
    if (w.kind === 'ride' || w.date < first || w.date > today) continue
    const wk = out[Math.floor(daysBetween(first, w.date) / 7)]
    if (!wk) continue
    const lifts = w.sets.filter((s) => s.minutes == null && s.hardSec == null && s.reps > 0)
    if (!lifts.length) continue
    wk.sessions++
    wk.volumeKg += lifts.reduce((t, s) => t + s.reps * s.weightKg, 0)
    if (w.notFullStrength) continue
    const t = tally(compareSession(workouts, w))
    wk.up += t.up
    wk.same += t.same
    wk.down += t.down
    wk.fresh += t.fresh
    wk.records += t.records
  }
  return out
}
