import type { Entry, ISODate, Settings, WeighIn } from '../db/db'
import { addDays, daysBetween, todayISO } from './date'

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

export interface TrendPoint {
  date: ISODate
  /** Raw scale reading for this day, if there was one. */
  raw?: number
  /** Smoothed trend weight — this is the number that actually matters. */
  trend: number
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

export function weightTrend(weighIns: WeighIn[], halfLifeDays: number): TrendPoint[] {
  // A reading taken under different conditions measures something else.
  const sorted = [...weighIns].filter((w) => !w.offProtocol).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return []

  // Put every reading on the same footing before smoothing. A colon that is
  // sometimes full and sometimes not is noise, and noise is the only thing
  // that actually costs anything here — a constant offset cancels in the
  // slope, an inconsistent one does not. Readings with no flag are left as
  // they are rather than guessed at.
  const off = stoolOffset(weighIns)
  let adjusted: WeighIn[]
  if (off) {
    adjusted = sorted.map((w) => (w.afterStool === false ? { ...w, kg: w.kg - off.kg } : w))
  } else {
    // No offset measured yet, so a reading taken on a full colon cannot be
    // corrected — only recognised. Smoothing it in with the rest is the same
    // mistake as counting an off-protocol reading: it measures something else,
    // and a couple of them early on bend the whole line. Left out entirely
    // while there are still enough comparable readings to describe the trend;
    // below that, a bent line beats no line.
    const comparable = sorted.filter((w) => w.afterStool !== false)
    adjusted = comparable.length >= 3 ? comparable : sorted
  }

  /**
   * A line fitted through the recent readings, weighted towards the newest.
   *
   * This replaced a double exponential smoother, which had a fault visible on
   * any short log: it seeds itself at the first reading, so the whole line is
   * pinned to a single morning. Here that morning happened to be a light one,
   * and the trend spent a week climbing away from it before it could turn —
   * a hump that was in the algorithm and not in the body. It also lagged, and
   * reported a third of the real rate of loss.
   *
   * Fitting a line instead has no seed to be wrong about. Each point gets the
   * line through everything up to that day, with weights halving every
   * `halfLifeDays` into the past, so old readings fade rather than anchor. The
   * fit carries a slope, which is what stops it lagging behind a body that is
   * genuinely moving.
   *
   * Below three readings there is no slope worth estimating, so it falls back
   * to the weighted average — flat, but honest about knowing nothing yet.
   */
  const out: TrendPoint[] = []
  for (let i = 0; i < adjusted.length; i++) {
    const here = adjusted[i].date
    let sw = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (let j = 0; j <= i; j++) {
      const age = daysBetween(adjusted[j].date, here)
      const wgt = Math.pow(0.5, age / halfLifeDays)
      const x = -age
      const y = adjusted[j].kg
      sw += wgt
      sx += wgt * x
      sy += wgt * y
      sxx += wgt * x * x
      sxy += wgt * x * y
    }
    const mean = sy / sw
    let value = mean
    if (i >= 2) {
      const den = sxx - (sx * sx) / sw
      if (Math.abs(den) > 1e-9) {
        const slope = (sxy - (sx * sy) / sw) / den
        // Evaluated at today, where x is zero, so the fitted value is just the
        // intercept: the weighted mean carried forward along the slope.
        value = mean - slope * (sx / sw)
      }
    }
    out.push({ date: here, raw: adjusted[i].kg, trend: value })
  }
  return out
}

/**
 * The trend, plus the readings the trend refuses to use.
 *
 * `weightTrend` drops an off-protocol weigh-in outright, which is right for
 * every number derived from it and wrong for the picture: you stepped on the
 * scale, the app said it saved, and then the dot was nowhere. Silence looks
 * like data loss even when the reasoning is sound.
 *
 * So the excluded readings come back here as points carrying the trend value
 * they did not change — flat across the gap, which is the honest shape, since
 * ignoring a reading means the trend genuinely learned nothing that day. They
 * are flagged `off` so the chart can draw them apart from the real series, and
 * this function is deliberately not what the statistics run on.
 */
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
export function trendSlopeKgPerWeek(points: TrendPoint[], windowDays = 21): number | null {
  if (points.length < 2) return null
  const last = points[points.length - 1].date
  const from = addDays(last, -windowDays)
  const win = points.filter((p) => p.date >= from)
  if (win.length < 3) return null

  const x = win.map((p) => daysBetween(win[0].date, p.date))
  const y = win.map((p) => p.trend)
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my)
    den += (x[i] - mx) ** 2
  }
  if (den === 0) return null
  return (num / den) * 7
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
  windowDays = 28,
  minLoggedDays = 10,
): AdaptiveTDEE | null {
  if (trend.length < 2) return null

  const end = trend[trend.length - 1].date
  const from = addDays(end, -windowDays)
  const win = trend.filter((p) => p.date >= from)
  if (win.length < 2) return null

  const start = win[0]
  const finish = win[win.length - 1]
  const days = daysBetween(start.date, finish.date)
  if (days < 7) return null

  // Only count days that were actually logged; averaging in zero-calorie
  // days because you forgot to log would fake a deficit that never happened.
  const byDay = new Map<ISODate, number>()
  for (const e of entries) {
    if (e.date < start.date || e.date > finish.date) continue
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.kcal)
  }
  const intakes = [...byDay.values()].filter((v) => v > 200)
  if (intakes.length < minLoggedDays) return null

  const meanIntake = intakes.reduce((a, b) => a + b, 0) / intakes.length
  const trendChangeKg = finish.trend - start.trend
  const kcal = meanIntake - (trendChangeKg * KCAL_PER_KG) / days

  // `days` is the span between the endpoints; the window covers one more
  // calendar day than that, which is what adherence should be measured against.
  const coverage = intakes.length / (days + 1)
  const confidence: AdaptiveTDEE['confidence'] =
    days >= 21 && coverage >= 0.8 ? 'high' : days >= 14 && coverage >= 0.6 ? 'medium' : 'low'

  return {
    kcal: Math.round(kcal),
    days,
    windowDays: days + 1,
    loggedDays: intakes.length,
    meanIntake: Math.round(meanIntake),
    trendChangeKg,
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

/** How far a single day's target may sit from the week's base figure. */
const MAX_DAILY_SWING = 300

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
    days: usual?.days ?? 14,
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
  days = 14,
): UsualActivity | null {
  const start = new Date(today)
  start.setDate(start.getDate() - days)
  const from = start.toISOString().slice(0, 10)
  const byDay = new Map<string, number>()
  for (const w of workouts) {
    if (w.date <= from || w.date >= today) continue
    byDay.set(w.date, (byDay.get(w.date) ?? 0) + (w.kcal ?? 0))
  }
  if (byDay.size < 3) return null
  let total = 0
  for (const v of byDay.values()) total += v
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

  let kcal: number
  let basis: Targets['basis']
  if (settings.kcalTargetOverride) {
    kcal = settings.kcalTargetOverride
    basis = 'manual'
  } else {
    kcal = tdee + (settings.goalKgPerWeek * KCAL_PER_KG) / 7
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
      : -(settings.goalKgPerWeek * KCAL_PER_KG) / 7
    /**
     * The deficit is held as a share of the day, not as a flat number.
     *
     * Subtracting the same 585 kcal from every day sounds fair and is not: it
     * is 22% of a long training day and 29% of a quiet one, which quietly
     * makes rest days the harshest of the week. That is backwards — rest is
     * when the repair happens, and the literature on losing weight without
     * losing muscle puts the useful ceiling near 500 kcal a day rather than
     * near a percentage that drifts with whatever you happened to do.
     */
    const share = tdee > 0 ? Math.min(0.4, deficit / tdee) : 0
    const computed = energy.total * (1 - share)
    kcal = baseKcal + energy.trust * (computed - baseKcal)
    /**
     * And the day is not allowed to wander far from the base.
     *
     * Training and rest days are meant to differ by roughly 300-600 kcal, the
     * difference coming out of carbohydrate. Left uncapped this arithmetic
     * produced a 644 kcal spread between a couch day and a heavy one, which is
     * further than the evidence supports and further than anyone can eat to
     * without the low days feeling like punishment.
     */
    kcal = Math.min(baseKcal + MAX_DAILY_SWING, Math.max(baseKcal - MAX_DAILY_SWING, kcal))
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

  return { kcal, protein, carbs, fat, basis, tdee: Math.round(tdee), baseKcal, energy }
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
