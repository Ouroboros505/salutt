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
  weightTrend,
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

  const trend = weightTrend(weighIns, settings.trendHalfLifeDays)
  const currentKg = trend.at(-1)?.trend ?? null
  const tdee = adaptiveTDEE(entries, trend)
  const targets = computeTargets(settings, currentKg, tdee)
  const rate = trendSlopeKgPerWeek(trend)

  const formulaTDEE = currentKg
    ? Math.round(bmrMifflin(currentKg, settings.heightCm, ageFrom(settings.birthDate), settings.sex) * settings.activity)
    : null

  // Daily calorie totals across the window, including the days with nothing.
  const from = addDays(todayISO(), -(days - 1))
  const byDay = new Map<string, { kcal: number; protein: number }>()
  for (const e of entries) {
    if (e.date < from) continue
    const cur = byDay.get(e.date) ?? { kcal: 0, protein: 0 }
    byDay.set(e.date, { kcal: cur.kcal + e.kcal, protein: cur.protein + e.protein })
  }

  const series = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    const v = byDay.get(date)
    return { date, label: formatShort(date), sublabel: formatShort(date), value: v?.kcal ?? 0, protein: v?.protein ?? 0 }
  })

  const logged = series.filter((s) => s.value > 200)
  const avgKcal = logged.length ? logged.reduce((t, s) => t + s.value, 0) / logged.length : 0
  const avgProtein = logged.length ? logged.reduce((t, s) => t + s.protein, 0) / logged.length : 0
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
            value={`${settings.goalKgPerWeek > 0 ? '+' : ''}${settings.goalKgPerWeek}`}
            sub="kg / week"
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
          <Stat
            label="Average protein"
            value={Math.round(avgProtein).toString()}
            sub={`of ${targets.protein} g target`}
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
