import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Measurement, type Settings } from '../db/db'
import { addDays, formatShort, todayISO } from '../lib/date'
import { bmi, navyBodyFat, projectGoal, trendSlopeKgPerWeek, weightTrend } from '../lib/metrics'
import { TrendChart } from '../components/charts'
import { Field, Icon, Segmented, Sheet } from '../components/ui'
import ScaleSync from '../components/ScaleSync'
import { bodyFatBand } from '../lib/bodyComp'

const RANGES = [
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: '365', label: '1 y' },
  { value: 'all', label: 'All' },
]

const TAPE: { key: keyof Measurement; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'chest', label: 'Chest' },
  { key: 'neck', label: 'Neck' },
  { key: 'arm', label: 'Arm' },
  { key: 'thigh', label: 'Thigh' },
]

export default function Body({ settings, toast }: { settings: Settings; toast: (m: string) => void }) {
  const [range, setRange] = useState('90')
  const [weighing, setWeighing] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const weighIns = useLiveQuery(() => db.weighIns.orderBy('date').toArray(), []) ?? []
  const measurements = useLiveQuery(() => db.measurements.orderBy('date').reverse().toArray(), []) ?? []

  const full = weightTrend(weighIns, settings.trendHalfLifeDays)
  const from = range === 'all' ? '0000-00-00' : addDays(todayISO(), -Number(range))
  const shown = full.filter((p) => p.date >= from)

  const latest = full.at(-1)
  const rate = trendSlopeKgPerWeek(full)
  const last = measurements[0]

  const week = pastTrend(full, 7)
  const month = pastTrend(full, 30)

  const bf =
    last && latest
      ? navyBodyFat(settings.sex, settings.heightCm, last.waist, last.neck, last.hips)
      : null

  const projection =
    latest && settings.goalWeightKg ? projectGoal(latest.trend, settings.goalWeightKg, rate) : null

  // Most recent weigh-in that actually carries body-composition data — a later
  // manual entry should not blank out numbers the scale gave you last week.
  const lastScan = [...weighIns].reverse().find((w) => w.impedance != null)
  const fatPct = lastScan?.bodyFatPct ?? bf

  return (
    <div className="screen">
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="stat-label">Trend weight</div>
            <div className="hero num">
              {latest ? latest.trend.toFixed(1) : '—'} <span className="hero-unit">kg</span>
            </div>
            {latest?.raw != null && (
              <div className="tiny muted num">
                last reading {latest.raw.toFixed(1)} kg · {formatShort(latest.date)}
              </div>
            )}
          </div>
          {/* Always offered, even where Bluetooth is unavailable — the sheet
              explains why rather than the button silently vanishing. */}
          <div className="stack tight" style={{ alignItems: 'flex-end' }}>
            <button className="btn primary" onClick={() => setSyncing(true)}>
              <Icon.bluetooth /> Sync scale
            </button>
            <button className="btn sm" onClick={() => setWeighing(true)}>
              <Icon.plus /> Enter manually
            </button>
          </div>
        </div>

        <div className="grid-3">
          <Stat label="7 days" value={week} />
          <Stat label="30 days" value={month} />
          <div className="stack tight">
            <div className="stat-label">Rate</div>
            <div
              className={`stat-value num ${rate == null ? '' : rate < 0 ? 'delta-good' : rate > 0 ? 'delta-bad' : ''}`}
            >
              {rate != null ? `${rate > 0 ? '+' : ''}${rate.toFixed(2)}` : '—'}
            </div>
            <div className="tiny muted">kg / week</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Weight</h2>
        </div>
        <Segmented value={range} options={RANGES} onChange={setRange} />
        <TrendChart
          data={shown.map((p) => ({ date: p.date, label: formatShort(p.date), raw: p.raw, trend: p.trend }))}
          goal={settings.goalWeightKg}
        />
        {projection && (
          <div className="small secondary">
            At this rate you reach {settings.goalWeightKg} kg around{' '}
            <strong>{formatShort(projection.date)}</strong> ({Math.round(projection.weeks)} weeks).
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Measurements</h2>
          <button className="btn sm" onClick={() => setMeasuring(true)}>
            <Icon.plus /> Log
          </button>
        </div>

        {last ? (
          <>
            <div className="grid-3">
              {TAPE.map((t) => {
                const v = last[t.key] as number | undefined
                const prev = measurements.slice(1).find((m) => m[t.key] != null)
                const pv = prev ? (prev[t.key] as number) : undefined
                const d = v != null && pv != null ? v - pv : null
                return (
                  <div key={String(t.key)} className="stack tight">
                    <div className="stat-label">{t.label}</div>
                    <div className="stat-value num">{v != null ? v.toFixed(1) : '—'}</div>
                    {d != null && d !== 0 && (
                      <div className={`tiny num ${d < 0 ? 'delta-good' : 'delta-bad'}`}>
                        {d > 0 ? '+' : ''}
                        {d.toFixed(1)} cm
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="tiny muted">Last measured {formatShort(last.date)} · centimetres</div>
          </>
        ) : (
          <div className="empty">
            No measurements yet. Waist is the single most useful one — it tracks fat loss when the scale
            stalls.
          </div>
        )}
      </div>

      <div className="card tight">
        <div className="card-head">
          <h3>Composition</h3>
          {lastScan && (
            <span className="tiny muted">from the scale · {formatShort(lastScan.date)}</span>
          )}
        </div>

        <div className="grid-3">
          <Cell label="BMI" value={latest ? bmi(latest.trend, settings.heightCm).toFixed(1) : '—'} />
          <Cell
            label="Body fat"
            value={fatPct != null ? `${fatPct.toFixed(1)}%` : '—'}
            sub={
              fatPct == null
                ? undefined
                : lastScan?.bodyFatPct != null
                  ? bodyFatBand(fatPct, settings.sex)
                  : 'tape estimate'
            }
          />
          <Cell
            label="Lean mass"
            value={
              lastScan?.fatFreeKg != null
                ? lastScan.fatFreeKg.toFixed(1)
                : latest && fatPct != null
                  ? (latest.trend * (1 - fatPct / 100)).toFixed(1)
                  : '—'
            }
            sub="kg"
          />
        </div>

        {/* The rest only exists once the scale has supplied an impedance reading. */}
        {lastScan?.impedance != null && (
          <div className="grid-3">
            <Cell label="Muscle" value={fmt(lastScan.muscleKg)} sub="kg" />
            <Cell label="Water" value={pct(lastScan.waterPct)} />
            <Cell label="Bone" value={fmt(lastScan.boneKg)} sub="kg" />
            <Cell label="Visceral" value={fmt(lastScan.visceralFat)} sub="index 1-30" />
            <Cell label="Protein" value={pct(lastScan.proteinPct)} />
            <Cell label="Subcut. fat" value={pct(lastScan.subcutaneousFatPct)} />
          </div>
        )}

        <div className="tiny muted">
          {lastScan?.impedance != null
            ? 'Impedance readings drift with hydration, so single figures wobble — the direction over weeks is the real signal. BMI ignores how much of you is muscle; treat waist and the trend line as the honest numbers.'
            : 'BMI ignores how much of you is muscle — treat waist and the trend line as the real signals. Sync the scale for body fat, muscle and water.'}
        </div>
      </div>

      {syncing && (
        <ScaleSync settings={settings} onClose={() => setSyncing(false)} toast={toast} />
      )}
      {weighing && <WeighInSheet onClose={() => setWeighing(false)} toast={toast} />}
      {measuring && <MeasureSheet last={last} onClose={() => setMeasuring(false)} toast={toast} />}
    </div>
  )
}

const fmt = (v?: number) => (v == null ? '—' : String(v))
const pct = (v?: number) => (v == null ? '—' : `${v}%`)

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stack tight">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="stack tight">
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${value == null ? '' : value < 0 ? 'delta-good' : value > 0 ? 'delta-bad' : ''}`}>
        {value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`}
      </div>
      <div className="tiny muted">kg</div>
    </div>
  )
}

/** Change in trend weight over the last n days, or null without enough history. */
function pastTrend(points: { date: string; trend: number }[], days: number): number | null {
  if (points.length < 2) return null
  const latest = points[points.length - 1]
  const cutoff = addDays(latest.date, -days)
  const before = [...points].reverse().find((p) => p.date <= cutoff)
  if (!before) return null
  return latest.trend - before.trend
}

function WeighInSheet({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [date, setDate] = useState(todayISO())
  const [kg, setKg] = useState('')
  const [bfp, setBfp] = useState('')

  const existing = useLiveQuery(() => db.weighIns.where('date').equals(date).first(), [date])
  const value = parseFloat(kg)

  return (
    <Sheet title="Weigh in" onClose={onClose}>
      <Field label="Date">
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field
        label="Weight (kg)"
        hint={existing ? `Replaces the ${existing.kg} kg already logged for this day.` : undefined}
      >
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          step="0.1"
          value={kg}
          onChange={(e) => setKg(e.target.value)}
          placeholder={existing ? String(existing.kg) : '75.4'}
        />
      </Field>
      <Field label="Body fat % (optional)" hint="From the scale's app, if you trust it.">
        <input type="number" inputMode="decimal" step="0.1" value={bfp} onChange={(e) => setBfp(e.target.value)} />
      </Field>

      <button
        className="btn primary block"
        disabled={!(value > 20 && value < 400)}
        onClick={async () => {
          await db.weighIns.put({
            ...(existing?.id ? { id: existing.id } : {}),
            date,
            kg: value,
            bodyFatPct: bfp ? parseFloat(bfp) : undefined,
            source: 'manual',
            createdAt: Date.now(),
          })
          toast('Weight saved')
          onClose()
        }}
      >
        Save
      </button>

      <div className="tiny muted">
        Weigh at the same time each day — first thing, after the bathroom, before eating. Consistency
        matters far more than the individual number.
      </div>
    </Sheet>
  )
}

function MeasureSheet({
  last,
  onClose,
  toast,
}: {
  last?: Measurement
  onClose: () => void
  toast: (m: string) => void
}) {
  const [date, setDate] = useState(todayISO())
  const [vals, setVals] = useState<Record<string, string>>({})

  return (
    <Sheet title="Measurements" onClose={onClose}>
      <Field label="Date">
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="grid-2">
        {TAPE.map((t) => (
          <Field key={String(t.key)} label={`${t.label} (cm)`}>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={vals[String(t.key)] ?? ''}
              placeholder={last?.[t.key] != null ? String(last[t.key]) : ''}
              onChange={(e) => setVals({ ...vals, [String(t.key)]: e.target.value })}
            />
          </Field>
        ))}
      </div>

      <button
        className="btn primary block"
        disabled={Object.values(vals).every((v) => !v)}
        onClick={async () => {
          const num = (k: string) => (vals[k] ? parseFloat(vals[k]) : undefined)
          const existing = await db.measurements.where('date').equals(date).first()
          await db.measurements.put({
            ...(existing?.id ? { id: existing.id } : {}),
            date,
            waist: num('waist'),
            hips: num('hips'),
            chest: num('chest'),
            neck: num('neck'),
            arm: num('arm'),
            thigh: num('thigh'),
            createdAt: Date.now(),
          })
          toast('Measurements saved')
          onClose()
        }}
      >
        Save
      </button>

      <div className="tiny muted">
        Measure relaxed, at the same landmark each time — waist at the navel, arm at mid-bicep.
      </div>
    </Sheet>
  )
}
