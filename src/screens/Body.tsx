import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Measurement, type Settings } from '../db/db'
import { addDays, formatShort, todayISO } from '../lib/date'
import {
  bmi,
  navyBodyFat,
  projectGoal,
  stoolOffset,
  trendSlopeKgPerWeek,
  weightSeries,
  weightTrend,
} from '../lib/metrics'
import { TrendChart } from '../components/charts'
import { CompositionCharts } from '../components/Composition'
import { Field, Icon, NumberInput, Segmented, Sheet } from '../components/ui'
import MeasureGuide from '../components/MeasureGuide'
import type { ListenerState } from '../lib/useScaleListener'
import type { ScaleReading } from '../lib/scale'
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

export default function Body({
  settings,
  toast,
  launch,
  onLaunchHandled,
  onSyncScale,
  picking,
  scaleState,
  scaleLive,
}: {
  settings: Settings
  toast: (m: string) => void
  launch?: 'weigh' | null
  onLaunchHandled?: () => void
  onSyncScale: () => void
  picking: boolean
  scaleState: ListenerState
  scaleLive: ScaleReading | null
}) {
  const [range, setRange] = useState('90')
  const [compRange, setCompRange] = useState('90')
  const [weighing, setWeighing] = useState(false)
  const [measuring, setMeasuring] = useState(false)

  // Opened from the "Weigh in" icon shortcut.
  useEffect(() => {
    if (launch !== 'weigh') return
    setWeighing(true)
    onLaunchHandled?.()
  }, [launch, onLaunchHandled])

  const weighIns = useLiveQuery(() => db.weighIns.orderBy('date').toArray(), []) ?? []
  const measurements = useLiveQuery(() => db.measurements.orderBy('date').reverse().toArray(), []) ?? []

  const full = weightTrend(weighIns, settings.trendHalfLifeDays)
  // The chart shows every reading; every number below it uses only the ones
  // the trend was allowed to learn from.
  const from = range === 'all' ? '0000-00-00' : addDays(todayISO(), -Number(range))
  const compFrom = compRange === 'all' ? '0000-00-00' : addDays(todayISO(), -Number(compRange))
  const shown = weightSeries(weighIns, settings.trendHalfLifeDays).filter((p) => p.date >= from)

  const latest = full.at(-1)
  // The newest reading there is, counted or not. The trend deliberately leaves
  // some readings out, but "last reading" means the last time you stood on the
  // scale — saying otherwise reads as the app having lost this morning's.
  const lastReading = weighIns.reduce<(typeof weighIns)[number] | undefined>(
    (best, w) => (best == null || w.date > best.date ? w : best),
    undefined,
  )
  const lastCounted = lastReading != null && full.some((p) => p.date === lastReading.date)
  const rate = trendSlopeKgPerWeek(full)
  /**
   * The most recent value for each measurement, which is not the same as the
   * most recent record.
   *
   * They move at completely different speeds: a waist shifts every week on a
   * cut, a neck barely moves in a month, and nobody sensibly measures all six
   * every time. But the body-fat estimate needs a waist and a neck together,
   * and reading one record meant a week of waist-only logging silently deleted
   * the estimate — the number vanished and nothing said why.
   *
   * So each field carries forward from the last time it was taken. A month-old
   * neck paired with today's waist is a small inaccuracy; showing nothing at
   * all was a larger one.
   */
  const last = measurements.length
    ? (['waist', 'hips', 'chest', 'neck', 'arm', 'thigh'] as const).reduce(
        (acc, k) => {
          const found = measurements.find((m) => m[k] != null)
          if (found) acc[k] = found[k]
          return acc
        },
        { ...measurements[0] } as Measurement,
      )
    : undefined

  const stool = stoolOffset(weighIns)
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
            {lastReading != null && (
              <div className="tiny muted num">
                last reading {lastReading.kg.toFixed(2)} kg · {formatShort(lastReading.date)}
                {!lastCounted && <span className="tiny muted"> · not in the trend</span>}
              </div>
            )}
          </div>
          {/* Always offered, even where Bluetooth is unavailable — the sheet
              explains why rather than the button silently vanishing. */}
          <div className="stack tight" style={{ alignItems: 'flex-end' }}>
            <button className="btn primary" onClick={onSyncScale} disabled={picking}>
              <Icon.bluetooth /> {picking ? 'Looking…' : 'Sync scale'}
            </button>
            <button className="btn sm" onClick={() => setWeighing(true)}>
              <Icon.plus /> Enter manually
            </button>
            <ScaleStatus state={scaleState} live={scaleLive} />
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
          data={shown.map((p) => ({
            date: p.date,
            label: formatShort(p.date),
            raw: p.raw,
            trend: p.trend,
            off: p.off,
          }))}
          goal={settings.goalWeightKg}
        />
        {projection && (
          <div className="small secondary">
            At this rate you reach {settings.goalWeightKg} kg around{' '}
            <strong>{formatShort(projection.date)}</strong> ({Math.round(projection.weeks)} weeks).
          </div>
        )}
        {stool && (
          <div className="tiny muted">
            A full bowel weighs <strong className="num">{stool.kg.toFixed(2)} kg</strong> on you,
            measured from {stool.after + stool.before} weigh-ins. Readings taken before are
            corrected by that much, so a day you have not been does not read as a gain.
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Body composition</h2>
        </div>
        <Segmented value={compRange} options={RANGES} onChange={setCompRange} />
        <CompositionCharts weighIns={weighIns} fromDate={compFrom} />
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

      {weighing && <WeighInSheet onClose={() => setWeighing(false)} toast={toast} />}
      {measuring && <MeasureSheet last={last} onClose={() => setMeasuring(false)} toast={toast} />}
    </div>
  )
}

/** Ambient state of the background scale connection, shown under the buttons. */
function ScaleStatus({ state, live }: { state: ListenerState; live: ScaleReading | null }) {
  if (state === 'off' || state === 'ready') return null
  const text =
    state === 'connected'
      ? live
        ? `scale ${live.kg.toFixed(2)} kg…`
        : 'scale connected — step on'
      : state === 'connecting'
        ? 'scale waking…'
        : 'watching for the scale'
  return (
    <div
      className="tiny"
      style={{ color: state === 'connected' ? 'var(--success-text)' : 'var(--text-muted)' }}
    >
      {text}
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
  const [offProtocol, setOffProtocol] = useState(false)
  // Tri-state on purpose: not recorded is its own answer, and guessing at it
  // would poison the very average it is meant to measure.
  const [afterStool, setAfterStool] = useState<boolean | undefined>(undefined)

  const existing = useLiveQuery(() => db.weighIns.where('date').equals(date).first(), [date])

  // Open on a day already recorded and the form shows what is there, so this
  // is an edit rather than a blank slate that overwrites by omission. Without
  // it, correcting a flag meant retyping the weight and losing the body
  // composition that came with it.
  useEffect(() => {
    if (!existing) return
    setKg(String(existing.kg))
    setBfp(existing.bodyFatPct != null ? String(existing.bodyFatPct) : '')
    setOffProtocol(!!existing.offProtocol)
    setAfterStool(existing.afterStool)
  }, [existing?.id])

  const value = parseFloat(kg)

  return (
    <Sheet title="Weigh in" onClose={onClose}>
      <Field label="Date">
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field
        label="Weight (kg)"
        hint={
          existing
            ? `Editing the ${existing.kg} kg already logged${existing.source === 'scale' ? ' by the scale — its body composition is kept' : ''}.`
            : undefined
        }
      >
        <NumberInput
          autoFocus
          value={parseFloat(kg) || undefined}
          unit="kg"
          placeholder={existing ? String(existing.kg) : '75.40'}
          onChange={(v) => setKg(v === undefined ? '' : String(v))}
        />
      </Field>
      <Field label="Body fat % (optional)" hint="From the scale's app, if you trust it.">
        <NumberInput
          value={parseFloat(bfp) || undefined}
          unit="%"
          onChange={(v) => setBfp(v === undefined ? '' : String(v))}
        />
      </Field>

      {/* This one CAN be corrected for, which is why it is asked separately.
          A full colon is 100-400 g and whether it is there varies day to day —
          but it varies in a way that repeats, so with enough readings on both
          sides the offset is measurable and can be subtracted. */}
      <Field label="Been to the toilet?" hint="Optional — but answer it often and the trend gets sharper.">
        <div className="scroll-x">
          <button className="chip" aria-pressed={afterStool === true} onClick={() => setAfterStool(afterStool === true ? undefined : true)}>
            Yes, emptied
          </button>
          <button className="chip" aria-pressed={afterStool === false} onClick={() => setAfterStool(afterStool === false ? undefined : false)}>
            Not yet
          </button>
        </div>
      </Field>

      {/* What is left after the bowel is split out: confounds that cannot be
          measured because they never repeat the same way twice. A meal still
          digesting, an evening reading, clothes. These can only be excluded. */}
      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={offProtocol}
          onChange={(e) => setOffProtocol(e.target.checked)}
          style={{ width: 20, height: 20, flex: 'none', marginTop: 2 }}
        />
        <span className="small">
          Unusual — evening, after eating, or dressed
          <span className="tiny muted" style={{ display: 'block' }}>
            Whatever was different from how you normally weigh. A meal still digesting is up to
            800 g against the 57–140 g of fat you are looking for, and unlike the bowel it does
            not repeat, so it can only be left out. Shown on the chart, kept out of the trend.
            Not going to the toilet is not this — answer that above and the reading still counts.
          </span>
        </span>
      </label>

      <button
        className="btn primary block"
        disabled={!(value > 20 && value < 400)}
        onClick={async () => {
          // Patch the fields this form owns and leave the rest alone. A
          // scale reading carries impedance, muscle, water, bone and visceral
          // figures that this form never asks about; replacing the row to
          // change a flag threw all of it away without saying so.
          const patch = {
            date,
            kg: value,
            bodyFatPct: bfp ? parseFloat(bfp) : existing?.bodyFatPct,
            offProtocol: offProtocol || undefined,
            afterStool,
          }
          if (existing?.id != null) await db.weighIns.update(existing.id, patch)
          else
            await db.weighIns.add({
              ...patch,
              source: 'manual',
              createdAt: Date.now(),
            })
          toast('Weight saved')
          onClose()
        }}
      >
        Save
      </button>

      {/* Weighing again is the usual reason to want this: you stepped off,
          went to the toilet, and the reading you kept is no longer the one you
          meant. One row per day, so the way to replace it is to remove it. */}
      {existing?.id != null && (
        <button
          className="btn danger block"
          onClick={async () => {
            await db.weighIns.delete(existing.id!)
            toast(`${formatShort(existing.date)} weigh-in deleted`)
            onClose()
          }}
        >
          <Icon.trash /> Delete this weigh-in
        </button>
      )}

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

  // Which measurement's guide is open. Null when none is.
  const [guide, setGuide] = useState<keyof Measurement | null>(null)

  return (
    <Sheet title="Measurements" onClose={onClose}>
      <Field label="Date">
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="grid-2">
        {TAPE.map((t) => (
          <Field
            key={String(t.key)}
            label={t.label}
            /* A drawing beats a sentence for tape placement, and placement
               drift is the largest error in these numbers. */
            hint={
              <button className="linkbtn" onClick={() => setGuide(t.key)}>
                how?
              </button>
            }
          >
            <NumberInput
              value={vals[String(t.key)] ? parseFloat(vals[String(t.key)]) : undefined}
              unit="cm"
              placeholder={last?.[t.key] != null ? String(last[t.key]) : ''}
              onChange={(v) =>
                setVals({ ...vals, [String(t.key)]: v === undefined ? '' : String(v) })
              }
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

      {guide && <MeasureGuide which={guide} onClose={() => setGuide(null)} />}

      <div className="tiny muted">
        Measure relaxed, at the same landmark each time — waist at the navel, arm at mid-bicep.
      </div>
    </Sheet>
  )
}
