import type { DayTarget, Entry, ISODate, Measurement, Settings, Trip, WeighIn } from '../db/db'
import { addDays, daysBetween, todayISO } from './date'
import { inTrip, inTripWater, settingsOn, tripDaysIn, tripSegment, tripSettling } from './trip'

/** Energy density of body tissue lost/gained, kcal per kg. */
export const KCAL_PER_KG = 7700

export function bmrMifflin(kg: number, cm: number, age: number, sex: 'male' | 'female'): number {
  const base = 10 * kg + 6.25 * cm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

export function ageFrom(birthDate: ISODate | undefined, on: ISODate = todayISO()): number {
  if (!birthDate) return 30
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [ny, nm, nd] = on.split('-').map(Number)
  let age = ny - by
  if (nm < bm || (nm === bm && nd < bd)) age--
  return age
}

export function bmi(kg: number, cm: number): number {
  const m = cm / 100
  return kg / (m * m)
}

/**
 * The most recent value for each measurement, which is not the same thing as
 * the most recent record.
 *
 * They move at completely different speeds — a waist shifts every week on a
 * cut, a neck barely moves in a month — and nobody sensibly measures all six
 * every time. But the body-fat estimate needs a waist and a neck together, so
 * reading a single record makes a week of waist-only logging silently delete
 * the estimate. A month-old neck paired with today's waist is a small
 * inaccuracy; having no estimate at all is a larger one.
 *
 * Expects newest first.
 */
export function latestMeasures(newestFirst: Measurement[]): Partial<Measurement> {
  const out: Partial<Measurement> = {}
  for (const k of ['waist', 'hips', 'chest', 'shoulders', 'neck', 'arm', 'thigh'] as const) {
    const found = newestFirst.find((m) => m[k] != null)
    if (found) out[k] = found[k]
  }
  return out
}

/**
 * US Navy body-fat estimate from tape measurements. Rough (±3-4 %) but it
 * moves in the right direction and needs no scale electronics.
 */
export function navyBodyFat(
  sex: 'male' | 'female',
  heightCm: number,
  waistCm?: number,
  neckCm?: number,
  hipsCm?: number,
): number | null {
  if (!waistCm || !neckCm) return null
  if (sex === 'male') {
    const v = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450
    return isFinite(v) ? v : null
  }
  if (!hipsCm) return null
  const v = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipsCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450
  return isFinite(v) ? v : null
}

/**
 * The most a day's deficit can take out of fat, before it starts taking muscle.
 *
 * Adipose tissue can only release energy so fast, and the rate is roughly
 * proportional to how much of it there is — about 31 kcal per pound of fat per
 * day in Alpert's model of the limit. That is why a rate chosen as safe at the
 * start of a cut stops being safe near the end: the percentage of bodyweight
 * barely moves, and the fat behind it halves.
 *
 * It is an upper bound from a starvation model rather than a recommendation,
 * so the warning below fires well before the line rather than on it.
 */
const KCAL_PER_KG_FAT_PER_DAY = 31 / 0.453592

/** Kilograms a week that fat alone can pay for, at a given fat mass. */
export function fatLossCeiling(fatMassKg: number): number {
  return (fatMassKg * KCAL_PER_KG_FAT_PER_DAY * 7) / KCAL_PER_KG
}

export interface FatBudget {
  bodyFatPct: number
  fatMassKg: number
  /** Which estimate it used, because the two disagree and it matters. */
  source: 'tape' | 'scale'
  ceilingKgPerWeek: number
  goalKgPerWeek: number
  /** The goal as a share of what fat can supply. Over 1 means muscle pays. */
  usage: number
  level: 'ok' | 'close' | 'over'
  /** The share of bodyweight that would sit at 80% of the ceiling. */
  safePctPerWeek: number
}

/**
 * Whether the rate being asked for is one the body can still pay for in fat.
 *
 * The tape is preferred over the scale when there is one, because bioimpedance
 * reads a man's body fat optimistically and an optimistic fat mass raises the
 * ceiling — which is the wrong direction for a warning to be wrong in.
 */
export function fatBudget(
  weightKg: number,
  goalKgPerWeek: number,
  opts: { tapePct?: number | null; scalePct?: number | null },
): FatBudget | null {
  const tape = opts.tapePct != null && isFinite(opts.tapePct) ? opts.tapePct : null
  const scale = opts.scalePct != null && isFinite(opts.scalePct) ? opts.scalePct : null
  const bodyFatPct = tape ?? scale
  if (bodyFatPct == null || !(weightKg > 0)) return null
  const fatMassKg = weightKg * (bodyFatPct / 100)
  const ceilingKgPerWeek = fatLossCeiling(fatMassKg)
  const asked = Math.abs(goalKgPerWeek)
  const usage = ceilingKgPerWeek > 0 ? asked / ceilingKgPerWeek : Infinity
  return {
    bodyFatPct,
    fatMassKg,
    source: tape != null ? 'tape' : 'scale',
    ceilingKgPerWeek,
    goalKgPerWeek,
    usage,
    level: usage >= 1 ? 'over' : usage >= 0.8 ? 'close' : 'ok',
    safePctPerWeek: (ceilingKgPerWeek * 0.8) / weightKg,
  }
}

export interface TrendPoint {
  date: ISODate
  /** Raw scale reading for this day, if there was one. */
  raw?: number
  /** Smoothed trend weight — this is the number that actually matters. */
  trend: number
  /** One standard deviation of uncertainty on the trend, when the estimator provides it. */
  sd?: number
  /** The estimated rate of change in kg/day, when the estimator provides it. */
  slopePerDay?: number
  /**
   * Taken outside the usual conditions, so it was not allowed to move the
   * trend. Present only on the charting series; the maths never sees these.
   */
  off?: boolean
}

/**
 * Smoothed weight, in the spirit of the Hacker's Diet but de-lagged.
 *
 * Daily weight is dominated by water, gut contents and glycogen, so some
 * smoothing is essential. A plain exponential average is smooth but *lags*:
 * while you are losing steadily it sits systematically above your real weight
 * by roughly (half-life / ln 2) x rate — about 0.9 kg at a 10-day half-life
 * and 0.45 kg/week. That is a big enough error to make the headline number
 * dishonest.
 *
 * Brown's double exponential smoothing removes that lag: smoothing the
 * smoothed series again measures the lag, and 2*s1 - s2 adds it back. Measured
 * over 400 simulated cuts, this cut the error on the displayed weight from
 * 0.86 kg to 0.20 kg while staying nearly as smooth day to day.
 *
 * The smoothing factor is derived from the gap between weigh-ins rather than
 * assumed to be one day, so skipping days does not distort the curve.
 */
export interface StoolOffset {
  /** Kilograms a full colon adds, measured from your own readings. */
  kg: number
  /** Readings that carried the flag, split by state. */
  after: number
  before: number
}

/**
 * How much a loaded colon weighs, on you specifically.
 *
 * Cannot be a simple average of the two groups: weight is falling, so if the
 * unemptied readings happen to cluster early in a cut they look heavier for a
 * reason that has nothing to do with stool. Fitting weight against day AND
 * state at once separates the two — the slope absorbs the diet, and what is
 * left on the state term is the colon.
 *
 * Returns null until there is enough of both to mean anything. Four each is
 * not a lot, but the alternative is a correction invented from two readings,
 * and a wrong correction is worse than none: it moves every number.
 */
export function stoolOffset(weighIns: WeighIn[]): StoolOffset | null {
  const known = weighIns.filter((w) => w.afterStool !== undefined && !w.offProtocol)
  const after = known.filter((w) => w.afterStool).length
  const before = known.length - after
  if (after < 4 || before < 4) return null

  // Least squares on kg = a + b*day + c*after, solved through the normal
  // equations for three unknowns.
  const t0 = known[0].date
  const rows = known.map((w) => ({ x: daysBetween(t0, w.date), s: w.afterStool ? 1 : 0, y: w.kg }))
  const n = rows.length
  const S = (f: (r: (typeof rows)[0]) => number) => rows.reduce((a, r) => a + f(r), 0)
  const [Sx, Ss, Sy] = [S((r) => r.x), S((r) => r.s), S((r) => r.y)]
  const [Sxx, Sss, Sxs] = [S((r) => r.x * r.x), S((r) => r.s * r.s), S((r) => r.x * r.s)]
  const [Sxy, Ssy] = [S((r) => r.x * r.y), S((r) => r.s * r.y)]

  // Centre both predictors, which reduces the fit to a 2x2 solve.
  const mx = Sx / n
  const ms = Ss / n
  const cxx = Sxx - n * mx * mx
  const css = Sss - n * ms * ms
  const cxs = Sxs - n * mx * ms
  const cxy = Sxy - (Sx * Sy) / n
  const csy = Ssy - (Ss * Sy) / n
  const det = cxx * css - cxs * cxs
  if (!(Math.abs(det) > 1e-9)) return null
  const c = (cxy * -cxs + csy * cxx) / det

  // Emptying cannot make you heavier, and it cannot plausibly be a kilo. A
  // figure outside that is measuring something else — a change of scale, a
  // holiday — and is not worth trusting over no correction at all.
  const kg = -c
  if (!(kg > 0) || kg > 0.8) return null
  return { kg, after, before }
}

/**
 * The weight trend as a Kalman filter over a local-linear model.
 *
 * The body is modelled as having a true weight and a true rate of change, both
 * hidden; the scale shows the true weight plus a morning's noise. Each reading
 * updates the belief about both, weighted by how sure the filter currently is
 * against how noisy mornings are known to be — which is measured from this
 * body's own history rather than assumed, as the innovation variance the
 * readings actually show.
 *
 * What this buys over the weighted fit that preceded it:
 *
 *  - The noise scale is learned, not chosen. A person whose mornings swing a
 *    kilo and one whose swing is 300 g get different smoothing, each right.
 *  - Uncertainty is carried honestly. Every point knows how sure it is, the
 *    gap of a trip widens it, and the days after the gap narrow it again —
 *    nothing special-cased, it falls out of the propagation.
 *  - The rate is a state, not an afterthought: estimated jointly with the
 *    level, so it neither lags the level nor whips around on one reading.
 *
 * The rate is given a slow random walk (RATE_DRIFT_PER_DAY), which is the knob
 * that says how quickly a real change of course — a diet break, an illness, a
 * creatine start — should be believed. Too small and the filter argues with a
 * genuine turn; too large and it chases noise. A few hundredths of a kg/day of
 * drift per day sits between the two. Both drifts were tuned on synthetic
 * series averaged over ten noise seeds: 0.012 catches a genuine change of
 * course in about a week while adding only 0.08 kg/wk of error to a steady
 * rate, and the smaller level drift routes movement to the rate state, where
 * a moving body's movement belongs.
 */
const RATE_DRIFT_PER_DAY = 0.012 // kg/day of plausible daily change in the rate itself
const LEVEL_DRIFT_PER_DAY = 0.02 // kg/day of unmodelled wander in true weight
const DEFAULT_NOISE_SD = 0.55 // kg; a typical morning's swing, until measured

export function weightTrendKalman(weighIns: WeighIn[], _halfLifeDays?: number): TrendPoint[] {
  const sorted = [...weighIns].filter((w) => !w.offProtocol).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return []

  const off = stoolOffset(weighIns)
  const adjusted = !off
    ? sorted
    : sorted.map((w) => (w.afterStool === false ? { ...w, kg: w.kg - off.kg } : w))

  // Measurement noise, learned from the data itself: the median absolute
  // day-to-day move, scaled to a standard deviation (MAD x 1.4826, over root
  // two because a difference holds two mornings' noise). The median makes one
  // wild morning unable to poison the estimate of how wild mornings are.
  let noiseSd = DEFAULT_NOISE_SD
  if (adjusted.length >= 6) {
    const diffs: number[] = []
    for (let i = 1; i < adjusted.length; i++) {
      const gap = daysBetween(adjusted[i - 1].date, adjusted[i].date)
      if (gap >= 1 && gap <= 3) diffs.push(Math.abs(adjusted[i].kg - adjusted[i - 1].kg))
    }
    if (diffs.length >= 5) {
      diffs.sort((a, b) => a - b)
      const mad = diffs[Math.floor(diffs.length / 2)]
      noiseSd = Math.max(0.2, Math.min(1.2, (mad * 1.4826) / Math.SQRT2))
    }
  }
  const R = noiseSd * noiseSd

  // State [level, rate]; covariance P. Begun at the first reading, knowing
  // nothing about the rate — the filter is honest about that via P.
  let x0 = adjusted[0].kg
  let x1 = 0
  let p00 = R
  let p01 = 0
  let p11 = 0.02 * 0.02

  const out: TrendPoint[] = []
  let prevDate = adjusted[0].date
  for (let i = 0; i < adjusted.length; i++) {
    const w = adjusted[i]
    const dt = i === 0 ? 0 : Math.max(1, daysBetween(prevDate, w.date))

    if (dt > 0) {
      // Predict: the level advances along the rate; uncertainty grows with
      // time, so a long gap (a trip) widens the band exactly as it should.
      x0 = x0 + x1 * dt
      const q00 = LEVEL_DRIFT_PER_DAY * LEVEL_DRIFT_PER_DAY * dt
      const q11 = RATE_DRIFT_PER_DAY * RATE_DRIFT_PER_DAY * dt
      const np00 = p00 + 2 * dt * p01 + dt * dt * p11 + q00
      const np01 = p01 + dt * p11
      p00 = np00
      p01 = np01
      p11 = p11 + q11
    }

    // Update against the morning's reading.
    const innov = w.kg - x0
    const S = p00 + R
    const k0 = p00 / S
    const k1 = p01 / S
    x0 += k0 * innov
    x1 += k1 * innov
    const np00 = (1 - k0) * p00
    const np01 = (1 - k0) * p01
    const np11 = p11 - k1 * p01
    p00 = np00
    p01 = np01
    p11 = np11

    out.push({
      date: w.date,
      raw: w.kg,
      trend: x0,
      sd: Math.sqrt(Math.max(0, p00)),
      slopePerDay: x1,
    })
    prevDate = w.date
  }
  return out
}

export function weightTrend(weighIns: WeighIn[], halfLifeDays: number): TrendPoint[] {
  /**
   * Delegates to the Kalman filter, which superseded both the smoother and
   * the weighted fit below. The halfLifeDays parameter is kept so no call
   * site changes; the filter learns its own timescale from the noise instead.
   */
  return weightTrendKalman(weighIns, halfLifeDays)
}

/**
 * Every reading, whether or not the trend was allowed to learn from it.
 *
 * The chart and the trend answer different questions. The trend leaves out
 * anything measured under different conditions; the chart must still show it,
 * because you stood on the scale and the number is real. So the exclusion list
 * is taken from what the trend actually used rather than restated here — when
 * the trend learns a new reason to set a reading aside, that reading keeps
 * appearing on the chart instead of silently vanishing from the app.
 */
export function weightSeries(weighIns: WeighIn[], halfLifeDays: number): TrendPoint[] {
  const counted = weightTrend(weighIns, halfLifeDays)
  const used = new Set(counted.map((p) => p.date))
  const skipped = weighIns.filter((w) => !used.has(w.date))
  if (skipped.length === 0) return counted

  const byDate = new Map(counted.map((p) => [p.date, p]))
  for (const w of skipped) {
    // A day cannot be both counted and skipped; if it somehow is, the counted
    // one wins rather than being overwritten by the reading it excluded.
    if (!byDate.has(w.date)) byDate.set(w.date, { date: w.date, raw: w.kg, trend: NaN, off: true })
  }

  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  // Carry the last real trend across each skipped day. A leading skipped day
  // has no trend behind it, so it borrows the first one ahead instead.
  let last = counted[0]?.trend ?? skipped[0].kg
  for (const p of merged) {
    if (Number.isNaN(p.trend)) p.trend = last
    else last = p.trend
  }
  return merged
}

/** Least-squares slope of trend weight, converted to kg per week. */
/**
 * How far back the "Rate" figure looks.
 *
 * Exported so the number and the label under it cannot drift apart: the Body
 * screen prints the window from this same constant.
 *
 * Eight weeks, not the three it used to be. Three weeks swung from -0.37 to
 * -0.66 kg/week inside a month of steady eating (Sep-Oct 2026), because one
 * water drop entering or leaving the window was a fifth of everything in it,
 * and the goal date on the Body screen jumped by a month with it. Over eight
 * weeks the same data read -0.60 to -0.68. A real change of pace still shows,
 * just over a few weeks instead of overnight.
 */
export const RATE_WINDOW_DAYS = 56

/**
 * How far back maintenance and the usual day's activity are measured.
 *
 * The same eight weeks as the rate, for the same reason: at 28 days the
 * maintenance figure wandered over 110 kcal in a month with nothing real
 * changing, and the daily target wandered with it. The two halves of the
 * energy sum also have to describe the same days. Maintenance is everything
 * spent on an average day of the window, and the usual activity is the part
 * of it that was logged, so measuring one over four weeks and the other over
 * two quietly mixed different months into one figure.
 */
export const MAINTENANCE_WINDOW_DAYS = 56

export function trendSlopeKgPerWeek(
  points: TrendPoint[],
  windowDays = RATE_WINDOW_DAYS,
  trips?: Trip[],
): number | null {
  if (points.length < 2) return null
  const last = points[points.length - 1].date
  const from = addDays(last, -windowDays)
  const win = points.filter((p) => p.date >= from && !inTripWater(trips, p.date))
  if (win.length < 3) return null
  const slope = pooledSlopePerDay(win, trips)
  return slope == null ? null : slope * 7
}

/**
 * Least-squares slope in kg per day, with each stretch between trips allowed
 * its own level.
 *
 * Without a trip in the window this is the ordinary fit. With one, a single
 * line drawn from before the trip to after it would read a week of travel
 * water as a change of pace; fitting the stretches separately and pooling
 * their slopes keeps the pace and drops the step.
 */
function pooledSlopePerDay(points: { date: ISODate; trend: number }[], trips?: Trip[]): number | null {
  const segs = new Map<number, { x: number; y: number }[]>()
  for (const p of points) {
    const k = tripSegment(trips, p.date)
    if (!segs.has(k)) segs.set(k, [])
    segs.get(k)!.push({ x: daysBetween(points[0].date, p.date), y: p.trend })
  }
  let num = 0
  let den = 0
  for (const seg of segs.values()) {
    if (seg.length < 2) continue
    const mx = seg.reduce((a, q) => a + q.x, 0) / seg.length
    const my = seg.reduce((a, q) => a + q.y, 0) / seg.length
    for (const q of seg) {
      num += (q.x - mx) * (q.y - my)
      den += (q.x - mx) ** 2
    }
  }
  return den > 1e-9 ? num / den : null
}

export interface AdaptiveTDEE {
  kcal: number
  /** Span in days between the first and last weigh-in used. */
  days: number
  /** Calendar days the window covers (span + 1) — the adherence denominator. */
  windowDays: number
  loggedDays: number
  meanIntake: number
  trendChangeKg: number
  confidence: 'low' | 'medium' | 'high'
}

/**
 * Your real maintenance calories, measured rather than predicted.
 *
 * Over a window, energy balance says:
 *   mean intake - TDEE = (tissue change in kcal) / days
 * so rearranged, TDEE = mean intake - (trend kg change x 7700) / days.
 *
 * This is the whole point of logging intake and weight together: after a few
 * weeks it beats any BMR formula, because it is measured on you.
 */
export function adaptiveTDEE(
  entries: Entry[],
  trend: TrendPoint[],
  windowDays = MAINTENANCE_WINDOW_DAYS,
  minLoggedDays = 10,
  trips?: Trip[],
): AdaptiveTDEE | null {
  if (trend.length < 2) return null

  const end = trend[trend.length - 1].date
  const from = addDays(end, -windowDays)
  // A trip's days, and the week of water after it, measure the trip.
  const win = trend.filter((p) => p.date >= from && !inTripWater(trips, p.date))
  if (win.length < 2) return null

  const start = win[0]
  const finish = win[win.length - 1]
  const days = daysBetween(start.date, finish.date)
  if (days < 7) return null

  // Only count days that were actually logged; averaging in zero-calorie
  // days because you forgot to log would fake a deficit that never happened.
  const byDay = new Map<ISODate, number>()
  for (const e of entries) {
    if (e.date < start.date || e.date > finish.date || inTrip(trips, e.date)) continue
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.kcal)
  }
  const intakes = [...byDay.values()].filter((v) => v > 200)
  if (intakes.length < minLoggedDays) return null

  const meanIntake = intakes.reduce((a, b) => a + b, 0) / intakes.length

  /**
   * The window's rate of change, fitted rather than measured end to end.
   *
   * Subtracting the first trend point from the last looked equivalent and was
   * not. The filter seeds itself at the first reading, so `trend[0]` carries no
   * smoothing at all — it is one raw morning wearing the trend's name. His
   * happened to be a light one, and 0.43 kg of noise spread over seventeen days
   * is 195 kcal a day of phantom maintenance, which is most of the gap between
   * this figure and every other estimate of it.
   *
   * A least-squares slope through the whole window uses every point instead of
   * two, so a wobble at either end moves it barely at all.
   */
  const slopeKgPerDay = pooledSlopePerDay(win, trips) ?? (finish.trend - start.trend) / days
  const kcal = meanIntake - slopeKgPerDay * KCAL_PER_KG

  // `days` is the span between the endpoints; the window covers one more
  // calendar day than that, which is what adherence should be measured against.
  const coverage = intakes.length / Math.max(1, days + 1 - tripDaysIn(trips, start.date, finish.date))
  const confidence: AdaptiveTDEE['confidence'] =
    days >= 21 && coverage >= 0.8 ? 'high' : days >= 14 && coverage >= 0.6 ? 'medium' : 'low'

  return {
    kcal: Math.round(kcal),
    days,
    windowDays: days + 1,
    loggedDays: intakes.length,
    meanIntake: Math.round(meanIntake),
    // Reported as the fitted change across the window, so it agrees with the
    // figure the maintenance was actually solved from.
    trendChangeKg: slopeKgPerDay * days,
    confidence,
  }
}

export interface Targets {
  kcal: number
  protein: number
  carbs: number
  fat: number
  /** Where the calorie number came from, so the UI can be honest about it. */
  basis: 'manual' | 'adaptive' | 'formula'
  tdee: number
  /** The figure for an average day, before today's own energy was worked out. */
  baseKcal: number
  /** Today's computed expenditure, when there is enough logged to compute it. */
  energy: DayEnergy | null
  /** The weekly goal actually in force, after a percentage one is resolved. */
  goalKgPerWeek: number
}

/**
 * The weekly goal in kilograms, whichever way it was expressed.
 *
 * A share of bodyweight is resolved against the trend rather than the morning
 * reading, so the target does not move with half a kilo of overnight water.
 */
export function goalPerWeek(settings: Pick<Settings, 'goalKgPerWeek' | 'goalPctPerWeek'>, kg: number): number {
  return settings.goalPctPerWeek ? -(kg * settings.goalPctPerWeek) : settings.goalKgPerWeek
}

/**
 * A day's expenditure, computed rather than assumed — and then anchored.
 *
 * The parts that can be computed are computed: resting metabolism from body
 * and age, the cost of digesting what was eaten, and the riding and training
 * that were logged. What cannot be computed is everything else a body does —
 * walking about, standing, fidgeting, carrying shopping. That is 200-900 kcal
 * a day between people, it moves when you diet, and nothing you can log
 * measures it.
 *
 * So it is not guessed at. It is solved: whatever makes the computed average
 * equal the maintenance that was actually measured from intake against the
 * weight trend. The shape of the week comes from the computation, the level
 * from the measurement, and each part does what it is good at.
 *
 * The anchor also absorbs systematic error for free. If every activity
 * estimate runs 25% high, the residual solves 25% lower and the average still
 * lands on the measurement — leaving only the day-to-day variation, which is
 * the part worth acting on.
 */
export interface DayEnergy {
  /** Resting metabolic rate, from body and age. */
  bmr: number
  /** Thermic effect of the food eaten. */
  digestion: number
  /** Logged riding and training. */
  activity: number
  /** Everything else, solved so the average matches the measurement. */
  rest: number
  total: number
  /** True when the residual came from a real maintenance measurement. */
  anchored: boolean
  /** How completely activity has been logged lately, 0 to 1. */
  trust: number
  /**
   * Plausible bounds on the unloggable part, for when there is no measurement
   * to solve it against. Showing a range is honest where a single number would
   * be invented — the spread is most of what is uncertain about the day.
   */
  restLow: number
  restHigh: number
  /** Days with something logged, for saying so plainly. */
  logged: number
  days: number
}

/** Roughly a tenth of intake goes on digesting it, across a mixed diet. */
const TEF_FRACTION = 0.1

/**
 * Only a sanity limit now: a ride logged twice, a session left running for
 * hours. Real days, even a four-hour hike, sit under it.
 */
const MAX_DAILY_SWING = 800

export function dayEnergy(
  settings: Settings,
  kg: number,
  intakeKcal: number,
  activityKcal: number,
  maintenance: number | null,
  usual: UsualActivity | null,
  meanIntake: number | null,
): DayEnergy {
  const meanActivity = usual?.mean ?? 0
  const bmr = bmrMifflin(kg, settings.heightCm, ageFrom(settings.birthDate), settings.sex)
  const digestion = TEF_FRACTION * intakeKcal

  // The residual is whatever the measurement says is unaccounted for, on an
  // average day. Without a measurement to anchor to, fall back to the activity
  // multiplier — a stated assumption rather than a solved one.
  let rest: number
  let anchored = false
  if (maintenance != null && meanActivity != null && meanIntake != null) {
    rest = maintenance - bmr - TEF_FRACTION * meanIntake - meanActivity
    anchored = true
  } else {
    // No measurement to solve against, so this is the midpoint of the range
    // below rather than a figure with any authority.
    rest = 300
  }
  // A negative residual would mean the body does nothing at all beyond what is
  // logged, which is never true; it means the activity estimates run high.
  rest = Math.max(0, rest)

  const total = bmr + digestion + activityKcal + rest
  return {
    bmr: Math.round(bmr),
    digestion: Math.round(digestion),
    activity: Math.round(activityKcal),
    rest: Math.round(rest),
    total: Math.round(total),
    anchored,
    trust: usual?.trust ?? 0,
    logged: usual?.logged ?? 0,
    days: usual?.days ?? MAINTENANCE_WINDOW_DAYS,
    // Non-exercise movement runs 150-450 for someone who is on their feet a
    // normal amount; anchoring collapses it to one number.
    restLow: anchored ? Math.round(rest) : 150,
    restHigh: anchored ? Math.round(rest) : 450,
  }
}

export interface UsualActivity {
  /** Mean kcal per day across the window, unlogged days counted as zero. */
  mean: number
  /** Days with something logged, out of the window. */
  logged: number
  days: number
  /**
   * How far to trust it, 0 to 1.
   *
   * A day with nothing logged is ambiguous — nothing done, or nothing
   * recorded — and the app cannot tell which. Counting it as zero is right
   * when you log consistently and badly wrong when you do not: log two rides
   * in a fortnight and the "average day" collapses to 57 kcal, every ordinary
   * day then looks exceptional, and the target inflates by 350. So the
   * computed figure is blended in as coverage improves rather than switched
   * on at some arbitrary threshold.
   */
  trust: number
}

/**
 * The usual day's activity, as a rolling mean.
 *
 * Days with nothing logged count as zero rather than being skipped: a day off
 * the bike is a real quiet day, and dropping it would quietly raise the
 * baseline every time you rested. What guards against under-logging is `trust`,
 * not exclusion.
 */
export function usualActivity(
  workouts: { date: ISODate; kcal?: number }[],
  today: ISODate,
  windowDays = MAINTENANCE_WINDOW_DAYS,
  trips?: Trip[],
): UsualActivity | null {
  const start = new Date(today)
  start.setDate(start.getDate() - windowDays)
  const from = start.toISOString().slice(0, 10)
  const byDay = new Map<string, number>()
  for (const w of workouts) {
    if (w.date <= from || w.date >= today || inTrip(trips, w.date)) continue
    byDay.set(w.date, (byDay.get(w.date) ?? 0) + (w.kcal ?? 0))
  }
  if (byDay.size < 3) return null
  let total = 0
  for (const v of byDay.values()) total += v
  // Days away were not quiet days at home; they leave the window entirely.
  const days = windowDays - tripDaysIn(trips, addDays(from, 1), addDays(today, -1))
  const coverage = byDay.size / days
  // Nothing below a third of days; full weight from four days in five.
  const trust = Math.max(0, Math.min(1, (coverage - 0.33) / (0.8 - 0.33)))
  return { mean: total / days, logged: byDay.size, days, trust }
}

export function computeTargets(
  settings: Settings,
  currentKg: number | null,
  adaptive: AdaptiveTDEE | null,
  energy: DayEnergy | null = null,
): Targets {
  const kg = currentKg ?? 75
  const age = ageFrom(settings.birthDate)
  const bmr = bmrMifflin(kg, settings.heightCm, age, settings.sex)
  const formulaTDEE = bmr * settings.activity

  // The adaptive number is only trusted once there is enough data behind it.
  const useAdaptive = adaptive && adaptive.confidence !== 'low'
  const tdee = useAdaptive ? adaptive!.kcal : formulaTDEE

  const goal = goalPerWeek(settings, kg)
  let kcal: number
  let basis: Targets['basis']
  if (settings.kcalTargetOverride) {
    kcal = settings.kcalTargetOverride
    basis = 'manual'
  } else {
    kcal = tdee + (goal * KCAL_PER_KG) / 7
    basis = useAdaptive ? 'adaptive' : 'formula'
  }

  const baseKcal = Math.round(kcal)
  // With a day's energy worked out, the target is that day's expenditure less
  // the deficit the goal asks for — rather than an average day's figure. It is
  // blended in by how completely the activity has been logged, since a sparse
  // log makes every ordinary day look exceptional.
  if (energy) {
    const deficit = settings.kcalTargetOverride
      ? tdee - settings.kcalTargetOverride
      : -(goal * KCAL_PER_KG) / 7
    /**
     * The deficit is a flat number, not a share of the day.
     *
     * It was a share, on the reasoning that subtracting the same 585 kcal
     * makes a rest day proportionally harsher than a training day. True, but
     * it answers a question nobody asked: the goal set here is a *rate*, and a
     * rate is a fixed number of grams a day that does not care whether they
     * were earned on a bike or on a sofa. Holding a share instead delivered
     * 74 g on a quiet day and 94 g on a heavy one against a goal of 85, and
     * made the day's plan unreadable before anything had been logged.
     *
     * Flat also gives the dynamic target its plain meaning back — move more,
     * eat more, one for one — where a share handed over a bonus on top of the
     * extra expenditure and quietly forgave the quiet days.
     *
     * What protects a rest day is not a smaller deficit but the floor below:
     * the target never drops under resting metabolism, whatever the goal asks.
     */
    const computed = energy.total - deficit
    kcal = baseKcal + energy.trust * (computed - baseKcal)
    /**
     * Only the upside is limited, and only against logging mistakes.
     *
     * Move more, eat more, one for one: a day above the usual one gets all of
     * its extra back. A flat 300 kcal cap stood here first and starved exactly
     * the days that needed food: on 2026-10-16 (gym, four rides, ~600 kcal
     * above a usual day) it held the target at 2,207 against 3,200 burned.
     * Handing back three quarters replaced it for an evening and was no better
     * in kind: the card read "155 over" in red while "Down by" read 84 g of 82
     * planned in green, because the two were pricing two different burns.
     * With all of it handed back they are one sum, so they cannot disagree; a
     * systematic error in the activity estimates is corrected where it
     * belongs, by the measured maintenance.
     *
     * The limit is for a ride logged twice or a session left running. Below,
     * the protection is the resting-metabolism floor rather than a distance
     * from the average, and capping the downside would break the flat deficit
     * on exactly the quiet days it is meant to hold.
     */
    kcal = Math.min(baseKcal + MAX_DAILY_SWING, kcal)
  }

  /**
   * Never below resting metabolism.
   *
   * A flat 1500 was under this body's own BMR, so the safety net sat lower
   * than the floor it was meant to be protecting. Eating beneath what you burn
   * lying still is not a deficit worth having on any day of the week.
   */
  const floor = Math.max(settings.sex === 'male' ? 1500 : 1200, Math.round(bmr))
  kcal = Math.max(floor, Math.round(kcal))

  const protein =
    settings.proteinMode === 'pctKcal'
      ? Math.round((kcal * (settings.proteinPctKcal ?? 0.3)) / 4)
      : Math.round(settings.proteinGPerKg * kg)
  const fat = Math.round((kcal * settings.fatPctKcal) / 9)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))

  return { kcal, protein, carbs, fat, basis, tdee: Math.round(tdee), baseKcal, energy, goalKgPerWeek: goal }
}

/** Projected date of reaching a goal weight at the current measured rate. */
export function projectGoal(
  currentTrendKg: number,
  goalKg: number,
  ratePerWeek: number | null,
): { weeks: number; date: ISODate } | null {
  if (!ratePerWeek || ratePerWeek === 0) return null
  const delta = goalKg - currentTrendKg
  if (Math.sign(delta) !== Math.sign(ratePerWeek)) return null
  const weeks = delta / ratePerWeek
  if (!isFinite(weeks) || weeks <= 0 || weeks > 520) return null
  return { weeks, date: addDays(todayISO(), Math.round(weeks * 7)) }
}


/**
 * Progress so far, from the scale rather than from arithmetic.
 *
 * A deficit adds up on paper; the trend line is what actually happened. They
 * disagree at first — the early kilo is largely water and glycogen leaving
 * with the carbohydrate, not fat — and they converge over weeks. Reporting the
 * measured one keeps the answer honest when they differ.
 */
export interface Progress {
  /** Kilograms between the first trend point and the latest. */
  changeKg: number
  days: number
  fromKg: number
  toKg: number
  /** Fewer than a fortnight of weights cannot separate fat from water. */
  settled: boolean
}

/**
 * How far the weight has moved since logging began.
 *
 * The baseline is the mean of the first few readings, not the first one. The
 * smoother has nothing behind it on day one, so its first point is simply that
 * morning's number — and a single morning carries the full day-to-day swing,
 * which here is most of a kilogram. Comparing that raw number against a
 * smoothed one at the other end is not comparing like with like: an unusually
 * light first reading books a gain that never happened. Averaging the first
 * few puts both ends of the comparison on the same footing.
 */
const BASELINE_READINGS = 3

export function progressSoFar(trend: TrendPoint[]): Progress | null {
  if (trend.length < 2) return null
  const first = trend[0]
  const last = trend[trend.length - 1]
  /**
   * Raw at the start, smoothed at the end, on purpose.
   *
   * It looks like an inconsistency and is the opposite. The filter seeds at
   * the very first reading and spends its first days climbing toward the real
   * level, so the early trend values are biased low — reading them would
   * understate the change and flatter nobody. By the end it has a fortnight of
   * evidence and the smoothed figure is the better one.
   *
   * So each end uses whichever estimate is actually better there: an average
   * of the first few readings, which the filter cannot yet improve on, against
   * a trend value it has earned. Averaging three of them keeps one heavy
   * morning from setting the whole baseline.
   */
  const head = trend.slice(0, Math.min(BASELINE_READINGS, trend.length))
  const baseline = head.reduce((a, p) => a + (p.raw ?? p.trend), 0) / head.length
  const days = Math.round(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000,
  )
  if (days < 1) return null
  return {
    changeKg: last.trend - baseline,
    days,
    fromKg: baseline,
    toKg: last.trend,
    settled: days >= 14,
  }
}

/** Grams of body tissue a calorie balance accounts for. */
export function gramsFromKcal(kcal: number): number {
  return Math.round((kcal / KCAL_PER_KG) * 1000)
}

/**
 * The rules a finished day was priced under, from what was known by its end.
 *
 * A day is frozen the first time it is opened after it ends, and that used to
 * capture the rules as they stood at that moment — the next morning's
 * weigh-in included. One heavier morning moved the trend, the trend moved the
 * maintenance estimate, and a day he closed 36 under re-read as 4 over: the
 * snapshot was meant to stop exactly that. So everything here is cut off at
 * the day itself, which is what the screen was showing him that night: the
 * weigh-ins and entries up to and including it, and the activity before it.
 */
export function rulesAsOf(
  settings: Settings,
  weighIns: WeighIn[],
  entries: Entry[],
  workouts: { date: ISODate; kcal?: number }[],
  date: ISODate,
): Omit<DayTarget, 'id' | 'date' | 'createdAt' | 'updatedAt'> | null {
  const known = weighIns.filter((w) => w.date <= date)
  const trend = weightTrend(known, settings.trendHalfLifeDays)
  if (!trend.length) return null
  const kg = trend[trend.length - 1].trend
  const { adaptive, usual } = rulesFor(
    settings,
    trend,
    entries.filter((e) => e.date <= date),
    workouts,
    date,
  )
  return {
    goalKgPerWeek: goalPerWeek(settingsOn(settings, date), kg),
    maintenance: adaptive && adaptive.confidence !== 'low' ? adaptive.kcal : null,
    usualMean: usual?.mean ?? 0,
    usualTrust: usual?.trust ?? 0,
    usualLogged: usual?.logged ?? 0,
    usualDays: usual?.days ?? MAINTENANCE_WINDOW_DAYS,
    meanIntake: adaptive?.meanIntake ?? null,
    kg,
  }
}

/**
 * Maintenance and the usual day as they apply on a date.
 *
 * Away, and for two weeks after landing, they are the figures from the day
 * before leaving: a trip has no rides to average and the first week back is
 * water, and either would pull maintenance down for two months. Once settled,
 * the trip's days are simply left out of both windows.
 */
export function rulesFor(
  settings: Settings,
  trend: TrendPoint[],
  entries: Entry[],
  workouts: { date: ISODate; kcal?: number }[],
  date: ISODate,
): { adaptive: AdaptiveTDEE | null; usual: UsualActivity | null } {
  const trips = settings.trips
  const settling = tripSettling(trips, date)
  if (settling) {
    const cut = addDays(settling.from, -1)
    return {
      adaptive: adaptiveTDEE(
        entries.filter((e) => e.date <= cut),
        trend.filter((p) => p.date <= cut),
        undefined,
        undefined,
        trips,
      ),
      usual: usualActivity(workouts, settling.from, undefined, trips),
    }
  }
  return {
    adaptive: adaptiveTDEE(entries, trend, undefined, undefined, trips),
    usual: usualActivity(workouts, date, undefined, trips),
  }
}

export interface EstimatePoint {
  /** The morning this is the weight for. */
  date: ISODate
  kg: number
  /** One standard deviation, from the last trend and the logging since. */
  sd: number
}

/**
 * Weight while away, from the food log alone.
 *
 * Starts at the last trend before leaving and adds each day's balance: what
 * was eaten less what that day burned, at 7,700 kcal a kilo. The burn is the
 * same computed day the target uses, so a logged walk counts here exactly as
 * it raised the target.
 *
 * The uncertainty is mostly logging, and logging errors do not cancel: food
 * cooked by someone else runs under-counted day after day. So a tenth of each
 * day's intake is added to the error in a straight line rather than in
 * quadrature, and a day with nothing logged is assumed to have been on target
 * with a quarter of its burn as the doubt.
 *
 * One point per morning, from the first day away to the morning after the
 * last, and never past today's.
 */
export function tripEstimate(
  settings: Settings,
  trip: Trip,
  trend: TrendPoint[],
  entries: Entry[],
  workouts: { date: ISODate; kcal?: number }[],
  today: ISODate,
): EstimatePoint[] | null {
  const cut = addDays(trip.from, -1)
  const start = [...trend].reverse().find((p) => p.date <= cut)
  if (!start) return null
  const { adaptive, usual } = rulesFor(settings, trend, entries, workouts, trip.from)
  const maintenance = adaptive && adaptive.confidence !== 'low' ? adaptive.kcal : null

  const eaten = new Map<ISODate, number>()
  for (const e of entries) if (e.date >= start.date) eaten.set(e.date, (eaten.get(e.date) ?? 0) + e.kcal)
  const moved = new Map<ISODate, number>()
  for (const w of workouts) if (w.date >= start.date) moved.set(w.date, (moved.get(w.date) ?? 0) + (w.kcal ?? 0))

  const last = addDays(trip.to, 1) < today ? addDays(trip.to, 1) : today
  const out: EstimatePoint[] = []
  let kg = start.trend
  let doubt = 0
  for (let d = start.date; d <= last; d = addDays(d, 1)) {
    if (d >= trip.from) out.push({ date: d, kg, sd: Math.sqrt((start.sd ?? 0.15) ** 2 + (doubt / KCAL_PER_KG) ** 2) })
    if (d === last) break
    const deficit = inTrip(settings.trips, d) ? trip.deficitKcal : (-goalPerWeek(settings, kg) * KCAL_PER_KG) / 7
    const logged = eaten.get(d) ?? 0
    const burn = (intake: number) =>
      dayEnergy(settings, kg, intake, moved.get(d) ?? 0, maintenance, usual, adaptive?.meanIntake ?? null).total
    if (logged > 200) {
      kg += (logged - burn(logged)) / KCAL_PER_KG
      doubt += 0.1 * logged
    } else {
      // Nothing logged: assume the day went to plan, and doubt it.
      kg -= deficit / KCAL_PER_KG
      doubt += 0.25 * burn(0)
    }
  }
  return out
}
