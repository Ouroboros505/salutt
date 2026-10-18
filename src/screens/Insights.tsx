import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Settings } from '../db/db'
import { addDays, formatShort, todayISO } from '../lib/date'
import {
  adaptiveTDEE,
  ageFrom,
  bmrMifflin,
  computeTargets,
  KCAL_PER_KG,
  trendSlopeKgPerWeek,
  usualActivity,
  weightTrend,
  goalPerWeek,
} from '../lib/metrics'
import { BarChart } from '../components/charts'
import { Segmented } from '../components/ui'

const RANGES = [
  { value: '14', label: '14 d' },
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
]

export default function Insights({ settings }: { settings: Settings }) {
  const [range, setRange] = useState('30')
  const days = Number(range)

  const entries = useLiveQuery(() => db.entries.toArray(), []) ?? []
  const weighIns = useLiveQuery(() => db.weighIns.toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.toArray(), []) ?? []

  const trend = weightTrend(weighIns, settings.trendHalfLifeDays)
  const currentKg = trend.at(-1)?.trend ?? null
  const tdee = adaptiveTDEE(entries, trend)
  const targets = computeTargets(settings, currentKg, tdee)
  const rate = trendSlopeKgPerWeek(trend)
  // Maintenance is an average day, rides and gym included. Taking the usual
  // logged activity back out gives the quiet day, which is what a trip or a
  // week off the bike actually burns. Only once the activity is fully trusted:
  // a half-logged window would subtract too little and flatter the rest day.
  const usual = usualActivity(workouts, todayISO())
  const restDay = tdee && usual && usual.trust >= 1 ? Math.round(tdee.kcal - usual.mean) : null

  const formulaTDEE = currentKg
    ? Math.round(bmrMifflin(currentKg, settings.heightCm, ageFrom(settings.birthDate), settings.sex) * settings.activity)
    : null

  // Daily calorie totals across the window, including the days with nothing.
  const from = addDays(todayISO(), -(days - 1))
  // Carbohydrate, fat and fibre ride along with the other two. Protein was the
  // only macro averaged here, which left the question "am I actually eating the
  // carbs the target assumes?" with nowhere to be answered — and since carbs
  // are whatever remains once protein and fat are set, that is the number that
  // quietly tells you whether the day added up.
  type Totals = { kcal: number; protein: number; carbs: number; fat: number; fiber: number }
  const zero = (): Totals => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
  const byDay = new Map<string, Totals>()
  for (const e of entries) {
    if (e.date < from) continue
    const cur = byDay.get(e.date) ?? zero()
    byDay.set(e.date, {
      kcal: cur.kcal + e.kcal,
      protein: cur.protein + e.protein,
      carbs: cur.carbs + (e.carbs ?? 0),
      fat: cur.fat + (e.fat ?? 0),
      fiber: cur.fiber + (e.fiber ?? 0),
    })
  }

  const series = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    const v = byDay.get(date) ?? zero()
    return {
      date, label: formatShort(date), sublabel: formatShort(date),
      value: v.kcal, protein: v.protein, carbs: v.carbs, fat: v.fat, fiber: v.fiber,
    }
  })

  // Averages exclude today: it is still being eaten, so counting it drags every
  // figure down all morning and reads as a fall in intake that has not happened.
  // The chart still draws it — a part-day is worth seeing, just not averaging.
  const logged = series.filter((s) => s.value > 200 && s.date < todayISO())
  const avgKcal = logged.length ? logged.reduce((t, s) => t + s.value, 0) / logged.length : 0
  const mean = (pick: (s: (typeof series)[number]) => number) =>
    logged.length ? logged.reduce((t, s) => t + pick(s), 0) / logged.length : 0
  const avgProtein = mean((s) => s.protein)
  const avgCarbs = mean((s) => s.carbs)
  const avgFat = mean((s) => s.fat)
  const avgFiber = mean((s) => s.fiber)
  // Bodyweight for the per-kilo figures: the trend, not a raw morning, so the
  // ratio does not jump around on water.
  const kgNow = currentKg ?? settings.startWeightKg ?? 75
  // The goal in kilograms, after a share-of-bodyweight one is resolved.
  const goal = goalPerWeek(settings, kgNow)
  const adherence = Math.round((logged.length / days) * 100)
  const onTarget = logged.filter((s) => Math.abs(s.value - targets.kcal) <= 150).length

  const expectedRate = tdee ? ((avgKcal - tdee.kcal) * 7) / KCAL_PER_KG : null

  return (
    <div className="screen">
      {/* ------------------------------------------------ adaptive TDEE */}
      <div className="card">
        <div className="card-head">
          <h2>Your maintenance</h2>
          {tdee && (
            <span className="tiny muted">
              {tdee.confidence} confidence · {tdee.loggedDays}/{tdee.windowDays} days
            </span>
          )}
        </div>

        {tdee ? (
          <>
            <div className="hero num">
              {tdee.kcal.toLocaleString()} <span className="hero-unit">kcal / day</span>
            </div>
            <div className="small secondary">
              Measured from {tdee.loggedDays} logged days: you averaged{' '}
              <strong className="num">{tdee.meanIntake.toLocaleString()}</strong> kcal while your trend weight
              moved <strong className="num">{tdee.trendChangeKg >= 0 ? '+' : ''}{tdee.trendChangeKg.toFixed(2)} kg</strong>{' '}
              over {tdee.days} days.
            </div>
            {restDay != null && usual && (
              <div className="small secondary">
                A day with no rides or gym burns about{' '}
                <strong className="num">{restDay.toLocaleString()}</strong>; your usual day adds{' '}
                <strong className="num">{Math.round(usual.mean)}</strong> kcal of logged activity on top. Anything
                logged beyond that is added to the day one for one.
              </div>
            )}
            {formulaTDEE && (
              <div className="tiny muted">
                The Mifflin-St Jeor formula would have guessed {formulaTDEE.toLocaleString()} kcal — a{' '}
                {Math.abs(tdee.kcal - formulaTDEE)} kcal difference. Yours is the one measured on you.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hero num muted">—</div>
            <div className="small secondary">
              Needs about 10 logged days and 2 weeks of weigh-ins. Until then the target uses a formula
              estimate.
            </div>
          </>
        )}

        <div className="grid-3">
          <Stat label="Target" value={targets.kcal.toLocaleString()} sub={targets.basis} />
          <Stat
            label="Actual rate"
            value={rate != null ? `${rate > 0 ? '+' : ''}${rate.toFixed(2)}` : '—'}
            sub="kg / week"
          />
          <Stat
            label="Goal rate"
            value={`${goal > 0 ? '+' : ''}${Math.round(goal * 100) / 100}`}
            sub={settings.goalPctPerWeek ? `kg / week · ${Math.round(settings.goalPctPerWeek * 1000) / 10}% of weight` : 'kg / week'}
          />
        </div>

        {expectedRate != null && rate != null && Math.abs(expectedRate - rate) > 0.25 && (
          <div className="tiny muted">
            Your intake predicts {expectedRate >= 0 ? '+' : ''}
            {expectedRate.toFixed(2)} kg/week but the scale says {rate > 0 ? '+' : ''}
            {rate.toFixed(2)}. That gap is usually unlogged food, portion estimates, or too little data
            yet — not a broken metabolism.
          </div>
        )}
      </div>

      {/* ------------------------------------------------ intake */}
      <div className="card">
        <div className="card-head">
          <h2>Daily intake</h2>
        </div>
        <Segmented value={range} options={RANGES} onChange={setRange} />
        <BarChart data={series} target={targets.kcal} />
        <div className="tiny muted">
          The dashed line is your target. Single days matter far less than where the average sits.
        </div>
      </div>

      {/* ------------------------------------------------ adherence */}
      <div className="card tight">
        <h3>Last {days} days</h3>
        <div className="grid-2">
          <Stat label="Days logged" value={`${logged.length}/${days}`} sub={`${adherence}%`} />
          <Stat label="Within ±150 kcal" value={String(onTarget)} sub="days" />
          <Stat label="Average intake" value={Math.round(avgKcal).toLocaleString()} sub="kcal" />
          {/*
            Grams are what you log, so they stay the headline — but a gram
            figure compares to nothing. Every reference worth checking against,
            in a paper or a plan or an argument online, is written as a share of
            calories or per kilo of bodyweight. Those are the units underneath,
            and they also settle a confusion grams create: eating fewer total
            calories drags every gram figure below its target at once, and only
            the percentage shows whether the diet's shape actually changed.
          */}
          <Stat
            label="Average protein"
            value={Math.round(avgProtein).toString()}
            sub={avgKcal > 0 ? `${(avgProtein / kgNow).toFixed(2)} g/kg · ${Math.round((avgProtein * 4 * 100) / avgKcal)}% of kcal` : `of ${targets.protein} g target`}
          />
          <Stat
            label="Average carbs"
            value={Math.round(avgCarbs).toString()}
            sub={avgKcal > 0 ? `${Math.round((avgCarbs * 4 * 100) / avgKcal)}% of kcal · ${(avgCarbs / kgNow).toFixed(1)} g/kg` : `of ${targets.carbs} g target`}
          />
          <Stat
            label="Average fat"
            value={Math.round(avgFat).toString()}
            sub={avgKcal > 0 ? `${Math.round((avgFat * 9 * 100) / avgKcal)}% of kcal · target ${Math.round(settings.fatPctKcal * 100)}%` : `of ${targets.fat} g target`}
          />
          {/* Fibre has no field on Targets — it is derived from the calorie
              target at 14 g per 1000, the same rule Today uses, so the bar
              moves with the diet rather than sitting at a flat 30. */}
          <Stat
            label="Average fibre"
            value={Math.round(avgFiber).toString()}
            sub={avgKcal > 0 ? `${((avgFiber * 1000) / avgKcal).toFixed(0)} g per 1000 kcal · guideline 14` : `of ${Math.round((targets.kcal * 14) / 1000)} g target`}
          />
        </div>
        {adherence < 70 && logged.length > 0 && (
          <div className="tiny muted">
            Under 70% of days logged makes the maintenance estimate shaky — missing days read as if you
            ate nothing, so they are excluded rather than averaged in.
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stack tight">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  )
}
