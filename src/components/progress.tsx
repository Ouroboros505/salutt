import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ISODate, type Workout } from '../db/db'
import { formatShort } from '../lib/date'
import { BAND_LEVELS, byName, repUnit, toDisplayWeight } from '../lib/program'
import {
  chartBasis,
  compareSession,
  daysSince,
  overloadByWeek,
  tally,
  last28,
  exerciseHistory,
  isWeighted,
  loggedExercises,
  records,
  strengthChange,
  toBeat,
  trainingCalendar,
  weeklySets,
  weekStreak,
  type CalDay,
  type DayKind,
  type ExSession,
  type LiftCompare,
  type Verdict,
  type WeekOverload,
} from '../lib/progress'
import { niceTicks, Tooltip, useWidth, type Tip } from './charts'
import { Icon, Sheet } from './ui'

/**
 * How the training is going, drawn.
 *
 * Two places use these. In a session, one tap on an exercise shows what to
 * beat and how it has moved — small, because it is read between sets. On the
 * Train screen there is room for the rest: the calendar of what was trained
 * when, the weekly sets per muscle, and every lift with its own history.
 *
 * Everything is in the units he lifts in, from the number he typed, and every
 * chart is plain SVG on the app's own colour tokens so it follows the theme.
 */

type Unit = 'kg' | 'lb'

const KIND_COLOR: Record<DayKind, string> = {
  push: 'var(--series-1)',
  pull: 'var(--series-3)',
  legs: 'var(--series-2)',
  core: 'var(--series-5)',
  ride: 'var(--series-4)',
}
const KIND_LABEL: Record<DayKind, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core & cardio',
  ride: 'Ride',
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const w = (kg: number, unit: Unit) => toDisplayWeight(kg, unit) ?? kg

/** A smooth path through points (Catmull-Rom as cubic Béziers), never overshooting much. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const t = 0.18
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`
  }
  return d
}

function setsText(s: ExSession, unit: Unit, secs: boolean): string {
  return s.sets
    .map((x) =>
      x.kg > 0
        ? `${x.reps}×${fmt(w(x.kg, unit))}`
        : x.band != null
          ? `${x.reps} ${BAND_LEVELS[x.band]?.label ?? ''} band`
          : `${x.reps}${secs ? 's' : ''}`,
    )
    .join(' · ')
}

/* ============================================================ the lift sheet */

export function ExerciseProgress({
  name,
  unit,
  today,
  full = false,
  onClose,
}: {
  name: string
  unit: Unit
  today: ISODate
  /** The Train view: whole history and the session list. */
  full?: boolean
  onClose: () => void
}) {
  const all = useLiveQuery(() => db.workouts.toArray(), [])
  // In a session, today's sets are still a draft and not in the table; what is
  // shown is everything before today, which is exactly the thing to beat.
  const history = useMemo(
    () => exerciseHistory((all ?? []).filter((x) => full || x.date < today), name),
    [all, name, today, full],
  )
  const secs = repUnit(byName(name)?.reps ?? '') === 's'
  const weighted = isWeighted(history)
  const basis = chartBasis(name)

  if (all === undefined) return <Sheet title={name} onClose={onClose}><div className="empty">Loading…</div></Sheet>
  if (!history.length)
    return (
      <Sheet title={name} onClose={onClose}>
        <div className="empty">No history for this one yet. Log it once and this fills in.</div>
      </Sheet>
    )

  const next = toBeat(history)
  const rec = records(history)
  const change = strengthChange(history, today)
  const since = daysSince(history, today)
  const shown = full ? history : history.slice(-12)

  return (
    <Sheet title={name} onClose={onClose}>
      {next && <NextTarget next={next} unit={unit} secs={secs} />}

      <div className="row" style={{ gap: 8 }}>
        <StatTile
          label="Best"
          value={
            rec.heaviest
              ? `${fmt(w(rec.heaviest.kg, unit))}`
              : rec.mostReps
                ? `${rec.mostReps.reps}`
                : '–'
          }
          unit={rec.heaviest ? `${unit} × ${rec.heaviest.reps}` : secs ? 's' : 'reps'}
          sub={
            rec.heaviest
              ? `${formatShort(rec.heaviest.date)}${basis.label === 'on the bar' ? ' · per side' : basis.label ? ` · ${basis.label}` : ''}`
              : rec.mostReps
                ? formatShort(rec.mostReps.date)
                : ''
          }
        />
        {weighted && rec.bestE1rm ? (
          <StatTile
            label="Est. 1-rep max"
            value={fmt(Math.round(w(rec.bestE1rm.kg, unit)))}
            unit={basis.label === 'on the bar' ? `${unit} on bar` : basis.label === 'each hand' ? `${unit} each` : unit}
            badge={change}
          />
        ) : (
          <StatTile label="Sessions" value={String(history.length)} unit="" sub="logged" />
        )}
        <StatTile
          label="Last done"
          value={since === 0 ? 'Today' : since === 1 ? '1' : String(since ?? '–')}
          unit={since != null && since > 0 ? (since === 1 ? 'day ago' : 'days ago') : ''}
          sub={`${history.length} session${history.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="card tight stack tight">
        <div className="row between">
          <span className="stat-label">{weighted ? 'Top weight & estimated max' : secs ? 'Longest hold' : 'Best set'}</span>
          {weighted && (
            <span className="tiny muted row" style={{ gap: 10 }}>
              <span className="row" style={{ gap: 4 }}>
                <span className="swatch" style={{ background: 'var(--accent)' }} /> top set
              </span>
              <span className="row" style={{ gap: 4 }}>
                <span className="swatch" style={{ background: 'var(--series-5)', opacity: 0.6 }} /> est. max
              </span>
            </span>
          )}
        </div>
        <StrengthChart history={shown} unit={unit} weighted={weighted} secs={secs} height={full ? 210 : 170} onBar={basis.label === 'on the bar'} />
      </div>

      <div className="card tight stack tight">
        <div className="row between">
          <span className="stat-label">Every set, last {Math.min(shown.length, full ? 10 : 6)} sessions</span>
          <span className="tiny muted">
            {secs ? 'bar = seconds held' : weighted ? `bar = reps · darker = heavier${basis.label === 'on the bar' ? ' · weights per side' : ''}` : 'bar = reps'}
          </span>
        </div>
        <SetLadder history={shown.slice(-(full ? 10 : 6))} unit={unit} secs={secs} />
      </div>

      {full && (
        <div className="card tight">
          <div className="stat-label" style={{ paddingBottom: 6 }}>All sessions</div>
          {[...history].reverse().map((s) => (
            <div key={s.date} className="row between small" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span className="muted num" style={{ width: 54, flex: 'none' }}>{formatShort(s.date)}</span>
              <span className="grow num truncate">{setsText(s, unit, secs)}</span>
              {s.notFull && <span className="tiny" style={{ color: 'var(--warning)' }}>not 100%</span>}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

function NextTarget({ next, unit, secs }: { next: NonNullable<ReturnType<typeof toBeat>>; unit: Unit; secs: boolean }) {
  const top = fmt(w(next.last.topKg, unit))
  const atTop = next.last.sets.filter((s) => s.kg === next.last.topKg)
  const lowest = Math.min(...atTop.map((s) => s.reps))
  const title =
    next.headline === 'up'
      ? `Move up from ${top} ${unit}`
      : next.headline === 'rep'
        ? `${next.targetReps} reps at ${top} ${unit}`
        : `${next.targetReps}${secs ? ' s' : ' reps'}`
  const why =
    next.headline === 'up'
      ? `Every set at ${top} ${unit} reached 15 on ${formatShort(next.last.date)}. Next weight up, and the reps start over.`
      : next.headline === 'rep'
        ? `On your lowest set at ${top} ${unit} — it was ${lowest} on ${formatShort(next.last.date)}.`
        : `One more than your best set on ${formatShort(next.last.date)}.`
  return (
    <div
      className="card tight"
      style={{
        background:
          next.headline === 'up'
            ? 'linear-gradient(135deg, color-mix(in srgb, var(--series-3) 22%, transparent), transparent 70%)'
            : 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent 70%)',
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
            background: next.headline === 'up' ? 'var(--series-3)' : 'var(--accent)',
            color: '#fff',
            fontWeight: 700,
          }}
        >
          {next.headline === 'up' ? '▲' : '+1'}
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="stat-label">To beat today</div>
          <div style={{ fontSize: 19, fontWeight: 650 }} className="num">{title}</div>
          <div className="tiny muted">{why}</div>
        </div>
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  unit,
  sub,
  badge,
}: {
  label: string
  value: string
  unit: string
  sub?: string
  badge?: number | null
}) {
  return (
    <div className="card tight grow" style={{ minWidth: 0, padding: '10px 11px' }}>
      <div className="stat-label truncate">{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 650, lineHeight: 1.15 }}>
        {value} <span className="tiny secondary" style={{ fontWeight: 400 }}>{unit}</span>
      </div>
      {badge != null ? (
        <span
          className="tiny num"
          style={{
            display: 'inline-block',
            marginTop: 3,
            padding: '1px 6px',
            borderRadius: 99,
            background: badge >= 0 ? 'color-mix(in srgb, var(--good) 16%, transparent)' : 'color-mix(in srgb, var(--critical) 16%, transparent)',
            color: badge >= 0 ? 'var(--success-text)' : 'var(--critical)',
          }}
        >
          {badge >= 0 ? '▲' : '▼'} {Math.abs(Math.round(badge * 100))}% · 4 wk
        </span>
      ) : (
        sub && <div className="tiny muted truncate">{sub}</div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- strength chart */

/**
 * The top set of every session, with the estimated max behind it.
 *
 * The top weight is a step line, because that is how double progression
 * moves: flat while the reps climb, then a step. Each dot grows with the reps
 * done at that weight, so the climb within a step is visible too. Behind it,
 * the estimated one-rep max as a soft area — the one line that rises with
 * either reps or weight, so it shows progress the step line hides.
 */
function StrengthChart({
  history,
  unit,
  weighted,
  secs,
  height,
  onBar = false,
}: {
  history: ExSession[]
  unit: Unit
  weighted: boolean
  secs: boolean
  height: number
  onBar?: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<(Tip & { i: number }) | null>(null)
  const padL = 34
  const padR = 10
  const padT = 14
  const padB = 22
  const W = Math.max(0, width - padL - padR)
  const H = height - padT - padB

  const t = (d: ISODate) => new Date(d + 'T12:00:00').getTime()
  const t0 = t(history[0].date)
  const t1 = Math.max(t(history[history.length - 1].date), t0 + 86400000)
  const x = (d: ISODate) => (history.length === 1 ? padL + W / 2 : padL + ((t(d) - t0) / (t1 - t0)) * W)

  const top = history.map((s) => (weighted ? w(s.topLoad, unit) : s.bestReps))
  const est = history.map((s) => w(s.e1rm, unit))
  const lo = Math.min(...top) * (weighted ? 0.85 : 0.8)
  const hi = Math.max(...(weighted ? est : top)) * 1.06
  const ticks = niceTicks(lo, hi, 3)
  const y0 = Math.min(lo, ticks[0] ?? lo)
  const y1 = Math.max(hi, ticks[ticks.length - 1] ?? hi)
  const y = (v: number) => padT + H - ((v - y0) / (y1 - y0 || 1)) * H

  const estPts: [number, number][] = history.map((s, i) => [x(s.date), y(est[i])])
  // Steps: across at the old weight to the next session, then up.
  let step = ''
  history.forEach((s, i) => {
    const px = x(s.date)
    const py = y(top[i])
    step += i === 0 ? `M${px},${py}` : ` H${px} V${py}`
  })
  const maxReps = Math.max(...history.map((s) => s.topReps), 1)
  let best = -Infinity

  const pick = (clientX: number, rect: DOMRect) => {
    const mx = clientX - rect.left
    let bi = 0
    history.forEach((s, i) => {
      if (Math.abs(x(s.date) - mx) < Math.abs(x(history[bi].date) - mx)) bi = i
    })
    const s = history[bi]
    setTip({
      i: bi,
      x: x(s.date),
      y: y(top[bi]),
      lines: [
        formatShort(s.date) + (s.notFull ? ' · not 100%' : ''),
        setsText(s, unit, secs),
        ...(weighted ? [`est. max ${Math.round(est[bi])} ${unit}`] : []),
      ],
    })
  }

  return (
    <div
      ref={ref}
      style={{ position: 'relative', height, touchAction: 'pan-y' }}
      onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerMove={(e) => e.buttons && pick(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerLeave={() => setTip(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="est-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-5)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--series-5)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="top-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <text x={padL - 6} y={padT - 4} textAnchor="end" fontSize="9" fill="var(--text-muted)">
            {weighted ? (onBar ? `${unit} on bar` : unit) : secs ? 's' : 'reps'}
          </text>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={padL + W} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeDasharray="2 4" />
              <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-muted)">
                {fmt(v)}
              </text>
            </g>
          ))}
          {weighted && history.length > 1 && (
            <>
              <path d={`${smooth(estPts)} V${padT + H} H${estPts[0][0]} Z`} fill="url(#est-fill)" />
              <path d={smooth(estPts)} fill="none" stroke="var(--series-5)" strokeOpacity="0.7" strokeWidth="1.6" />
            </>
          )}
          {!weighted && history.length > 1 && (
            <path d={`${step} V${padT + H} H${x(history[0].date)} Z`} fill="url(#top-fill)" />
          )}
          <path d={step} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          {history.map((s, i) => {
            const isPr = top[i] > best
            if (isPr) best = top[i]
            const r = 3 + (s.topReps / maxReps) * 3
            const up = i > 0 && top[i] > top[i - 1]
            return (
              <g key={s.date}>
                {isPr && i > 0 && <circle cx={x(s.date)} cy={y(top[i])} r={r + 4} fill="var(--accent)" opacity="0.18" />}
                <circle
                  cx={x(s.date)}
                  cy={y(top[i])}
                  r={r}
                  fill={s.notFull ? 'var(--raised)' : 'var(--accent)'}
                  stroke={s.notFull ? 'var(--warning)' : 'var(--raised)'}
                  strokeWidth="1.5"
                />
                {up && weighted && (
                  <text x={x(s.date)} y={y(top[i]) - r - 5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--success-text)">
                    ▲{fmt(top[i])}
                  </text>
                )}
              </g>
            )
          })}
          {tip && <line x1={tip.x} x2={tip.x} y1={padT} y2={padT + H} stroke="var(--axis)" />}
          <text x={padL} y={height - 5} fontSize="10" fill="var(--text-muted)">
            {formatShort(history[0].date)}
          </text>
          {history.length > 1 && (
            <text x={padL + W} y={height - 5} fontSize="10" textAnchor="end" fill="var(--text-muted)">
              {formatShort(history[history.length - 1].date)}
            </text>
          )}
        </svg>
      )}
      {tip && <Tooltip tip={tip} width={width} />}
    </div>
  )
}

/* ---------------------------------------------------------------- set ladder */

/**
 * Every set of the last few sessions, side by side.
 *
 * One column per session, one bar per set: the height is the reps, the shade
 * is the weight. Double progression reads straight off it — bars climbing to
 * the dashed line at fifteen, then a darker column starting lower when the
 * weight goes up.
 */
function SetLadder({ history, unit, secs }: { history: ExSession[]; unit: Unit; secs: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = 132
  const padT = 12
  const padB = 30
  const H = height - padT - padB
  const n = history.length
  const colW = n ? width / n : 0
  const maxReps = Math.max(15, ...history.flatMap((s) => s.sets.map((x) => x.reps)))
  const kgs = history.flatMap((s) => s.sets.map((x) => x.kg))
  const kLo = Math.min(...kgs)
  const kHi = Math.max(...kgs)
  const shade = (kg: number) => (kHi > kLo ? 0.35 + 0.65 * ((kg - kLo) / (kHi - kLo)) : 0.85)
  const yCeil = padT + H - (15 / maxReps) * H

  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block' }}>
          {!secs && (
            <>
              <line x1={0} x2={width} y1={yCeil} y2={yCeil} stroke="var(--series-3)" strokeDasharray="3 4" strokeOpacity="0.8" />
              <text x={width} y={yCeil - 3} textAnchor="end" fontSize="9" fill="var(--success-text)">15</text>
            </>
          )}
          {history.map((s, ci) => {
            const gap = 3
            const inner = Math.min(colW - 10, s.sets.length * 16)
            const bw = Math.max(5, (inner - gap * (s.sets.length - 1)) / s.sets.length)
            const x0 = ci * colW + (colW - (bw * s.sets.length + gap * (s.sets.length - 1))) / 2
            return (
              <g key={s.date}>
                {s.sets.map((st, si) => {
                  const h = Math.max(3, (st.reps / maxReps) * H)
                  const bx = x0 + si * (bw + gap)
                  const by = padT + H - h
                  return (
                    <g key={si}>
                      <rect x={bx} y={by} width={bw} height={h} rx={Math.min(4, bw / 2)} fill="var(--accent)" opacity={st.kg > 0 ? shade(st.kg) : 0.75} />
                      {bw >= 11 && (
                        <text x={bx + bw / 2} y={by - 3} textAnchor="middle" fontSize="8.5" fill="var(--text-secondary)" className="num">
                          {st.reps}
                        </text>
                      )}
                    </g>
                  )
                })}
                <text x={ci * colW + colW / 2} y={height - 17} textAnchor="middle" fontSize="9.5" fill="var(--text-muted)">
                  {formatShort(s.date)}
                </text>
                <text x={ci * colW + colW / 2} y={height - 5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-secondary)" className="num">
                  {s.topKg > 0 ? `${fmt(w(s.topKg, unit))}` : secs ? `${s.bestReps}s` : `${s.bestReps}`}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/* ============================================================== Train view */

/** The Train screen's progress section: calendar, muscle volume, every lift. */
export function TrainProgress({ unit, today }: { unit: Unit; today: ISODate }) {
  const all = useLiveQuery(() => db.workouts.toArray(), [])
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  if (!all) return null
  const lifts = loggedExercises(all)

  return (
    <>
      <OverloadCard workouts={all} today={today} unit={unit} />
      <div className="card stack tight">
        <h3>Training calendar</h3>
        <TrainingCalendar workouts={all} today={today} />
      </div>
      <div className="card stack tight">
        <h3>Sets per muscle, per week</h3>
        <MuscleVolume workouts={all} today={today} />
      </div>
      <div className="card tight">
        <div className="row between" style={{ paddingBottom: 4 }}>
          <h3>Your lifts</h3>
          <span className="tiny muted">tap for the full story</span>
        </div>
        {(showAll ? lifts : lifts.slice(0, 8)).map((l) => (
          <LiftRow key={l.name} name={l.name} workouts={all} unit={unit} today={today} onOpen={() => setOpen(l.name)} />
        ))}
        {lifts.length > 8 && (
          <button className="btn ghost block muted" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${lifts.length}`}
          </button>
        )}
      </div>
      {open && <ExerciseProgress name={open} unit={unit} today={today} full onClose={() => setOpen(null)} />}
    </>
  )
}

function LiftRow({
  name,
  workouts,
  unit,
  today,
  onOpen,
}: {
  name: string
  workouts: Workout[]
  unit: Unit
  today: ISODate
  onOpen: () => void
}) {
  const h = useMemo(() => exerciseHistory(workouts, name), [workouts, name])
  const weighted = isWeighted(h)
  const change = weighted ? strengthChange(h, today) : null
  const last = h[h.length - 1]
  const vals = h.slice(-10).map((s) => (weighted ? s.e1rm : s.bestReps))
  const secs = repUnit(byName(name)?.reps ?? '') === 's'
  return (
    <button className="item" onClick={onOpen}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="item-title truncate">{name}</div>
        <div className="tiny muted truncate num">
          {last ? `${formatShort(last.date)} · ${setsText(last, unit, secs)}` : ''}
        </div>
      </div>
      <Sparkline values={vals} />
      <span
        className="tiny num"
        style={{
          width: 46,
          textAlign: 'right',
          flex: 'none',
          color: change == null ? 'var(--text-muted)' : change >= 0 ? 'var(--success-text)' : 'var(--critical)',
        }}
      >
        {change == null ? '' : `${change >= 0 ? '+' : '−'}${Math.abs(Math.round(change * 100))}%`}
      </span>
      <span className="muted"><Icon.chevron /></span>
    </button>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const Wd = 64
  const Hd = 24
  if (values.length < 2) return <div style={{ width: Wd, flex: 'none' }} />
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pts: [number, number][] = values.map((v, i) => [
    2 + (i / (values.length - 1)) * (Wd - 4),
    Hd - 3 - ((v - lo) / (hi - lo || 1)) * (Hd - 6),
  ])
  const up = values[values.length - 1] >= values[0]
  const color = up ? 'var(--series-3)' : 'var(--critical)'
  return (
    <svg width={Wd} height={Hd} style={{ flex: 'none' }}>
      <path d={`${smooth(pts)} V${Hd} H${pts[0][0]} Z`} fill={color} opacity="0.12" />
      <path d={smooth(pts)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.2" fill={color} />
    </svg>
  )
}

/* ---------------------------------------------------------------- calendar */

/**
 * Twelve weeks of training on one grid, a column a week.
 *
 * Each day is coloured by what the session was — push, pull, legs, or core
 * and cardio — worked out from the sets in it, not its name. A small amber
 * dot marks a day with a ride, so the commute is there without drowning the
 * lifting. Gaps read at a glance: the cold, a trip, a week that slipped.
 */
function TrainingCalendar({ workouts, today }: { workouts: Workout[]; today: ISODate }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const weeks = 12
  const cal = useMemo(() => trainingCalendar(workouts, today, weeks), [workouts, today])
  const padL = 16
  const padT = 14
  const gap = 4
  const cell = width > 0 ? Math.min(24, (width - padL - gap * (weeks - 1)) / weeks) : 0
  const height = padT + 7 * cell + 6 * gap + 2

  const { sessions: last4, rideHours } = last28(cal, today)
  const streak = weekStreak(cal, today)
  const used = new Set(cal.flat().map((d) => d.session).filter(Boolean) as DayKind[])

  const show = (d: CalDay, cx: number, cy: number) =>
    setTip({
      x: cx,
      y: cy,
      lines: [
        formatShort(d.date),
        d.session ? `${KIND_LABEL[d.session]}${d.sessionName ? ` · ${d.sessionName}` : ''}` : 'Rest day',
        ...(d.rides ? [`${d.rides} ride${d.rides === 1 ? '' : 's'} · ${d.rideMin} min`] : []),
      ],
    })

  return (
    <div className="stack tight">
      <div className="row" style={{ gap: 8 }}>
        <MiniStat value={String(last4)} label="sessions, 28 days" />
        <MiniStat value={String(streak)} label={`week streak (3+)`} />
        <MiniStat value={rideHours.toFixed(1)} label="h riding, 28 days" />
      </div>
      <div ref={ref} style={{ position: 'relative', height }} onPointerLeave={() => setTip(null)}>
        {width > 0 && (
          <svg width={width} height={height} style={{ display: 'block' }}>
            {['M', '', 'W', '', 'F', '', 'S'].map((l, i) =>
              l ? (
                <text key={i} x={0} y={padT + i * (cell + gap) + cell * 0.7} fontSize="9" fill="var(--text-muted)">
                  {l}
                </text>
              ) : null,
            )}
            {cal.map((col, wi) => {
              const first = col[0].date
              const showMonth = wi === 0 || first.slice(5, 7) !== cal[wi - 1][0].date.slice(5, 7)
              return (
                <g key={wi}>
                  {showMonth && (
                    <text x={padL + wi * (cell + gap)} y={9} fontSize="9" fill="var(--text-muted)">
                      {new Date(first + 'T12:00:00').toLocaleString(undefined, { month: 'short' })}
                    </text>
                  )}
                  {col.map((d, di) => {
                    const cx = padL + wi * (cell + gap)
                    const cy = padT + di * (cell + gap)
                    const future = d.date > today
                    return (
                      <g key={d.date} onPointerDown={() => !future && show(d, cx + cell / 2, cy)}>
                        <rect
                          x={cx}
                          y={cy}
                          width={cell}
                          height={cell}
                          rx={Math.min(6, cell / 3.5)}
                          fill={d.session ? KIND_COLOR[d.session] : 'var(--ghost)'}
                          opacity={future ? 0.35 : d.session ? 0.92 : 1}
                          stroke={d.date === today ? 'var(--text-primary)' : 'none'}
                          strokeWidth={1.5}
                        />
                        {d.rides > 0 && (
                          <circle cx={cx + cell - 4.5} cy={cy + cell - 4.5} r={Math.max(2, cell / 9)} fill="var(--series-4)" stroke="var(--raised)" strokeWidth="1" />
                        )}
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
        )}
        {tip && <Tooltip tip={tip} width={width} />}
      </div>
      <div className="row tiny muted" style={{ gap: 12, flexWrap: 'wrap' }}>
        {(['push', 'pull', 'legs', 'core'] as DayKind[])
          .filter((k) => used.has(k))
          .map((k) => (
            <span key={k} className="row" style={{ gap: 4 }}>
              <span className="swatch" style={{ background: KIND_COLOR[k], borderRadius: 3 }} /> {KIND_LABEL[k]}
            </span>
          ))}
        <span className="row" style={{ gap: 4 }}>
          <span className="swatch" style={{ background: 'var(--series-4)', borderRadius: 99 }} /> Ride
        </span>
      </div>
    </div>
  )
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="grow" style={{ minWidth: 0, background: 'var(--ghost)', borderRadius: 10, padding: '7px 9px' }}>
      <div className="num" style={{ fontSize: 17, fontWeight: 650, lineHeight: 1.1 }}>{value}</div>
      <div className="tiny muted truncate">{label}</div>
    </div>
  )
}

/* ------------------------------------------------------------ muscle volume */

/**
 * Hard sets a week for each muscle, against the range that grows muscle.
 *
 * The shaded band is ten to twenty sets a week, where most of the research on
 * muscle growth lands. The bar is the average over the last four whole weeks;
 * the ring is this week so far. Back and shoulders lead, because the plan is
 * built for width — this is where it shows whether the training actually
 * matches the goal.
 */
function MuscleVolume({ workouts, today }: { workouts: Workout[]; today: ISODate }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const rows = useMemo(() => weeklySets(workouts, today), [workouts, today])
  const labelW = 72
  const valW = 34
  const rowH = 24
  const top = 16
  const height = top + rows.length * rowH + 4
  const maxV = Math.max(24, ...rows.map((r) => Math.max(r.perWeek, r.thisWeek))) * 1.05
  const W = Math.max(0, width - labelW - valW)
  const x = (v: number) => labelW + (v / maxV) * W
  const colour = (v: number) => (v < 10 ? 'var(--serious)' : v <= 20 ? 'var(--series-3)' : 'var(--series-4)')
  const vTaper = new Set(['Back', 'Shoulders'])

  return (
    <div className="stack tight">
      <div ref={ref} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} style={{ display: 'block' }}>
            <rect x={x(10)} y={top - 4} width={x(20) - x(10)} height={rows.length * rowH + 2} rx="6" fill="var(--series-3)" opacity="0.1" />
            <text x={(x(10) + x(20)) / 2} y={10} textAnchor="middle" fontSize="9" fill="var(--success-text)">
              growth zone 10–20
            </text>
            {[10, 20].map((v) => (
              <line key={v} x1={x(v)} x2={x(v)} y1={top - 4} y2={top + rows.length * rowH - 2} stroke="var(--series-3)" strokeOpacity="0.35" strokeDasharray="2 3" />
            ))}
            {rows.map((r, i) => {
              const cy = top + i * rowH + rowH / 2 - 2
              return (
                <g key={r.group}>
                  <text x={0} y={cy + 4} fontSize="11" fontWeight={vTaper.has(r.group) ? 650 : 400} fill="var(--text-secondary)">
                    {r.group}
                  </text>
                  <rect x={labelW} y={cy - 5} width={W} height={10} rx="5" fill="var(--ghost)" />
                  <rect x={labelW} y={cy - 5} width={Math.max(0, x(r.perWeek) - labelW)} height={10} rx="5" fill={colour(r.perWeek)} />
                  {r.thisWeek > 0 && (
                    <circle cx={x(r.thisWeek)} cy={cy} r="5.5" fill="var(--raised)" stroke="var(--text-primary)" strokeWidth="1.6" />
                  )}
                  <text x={width} y={cy + 4} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--text-primary)" className="num">
                    {fmt(Math.round(r.perWeek * 10) / 10)}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div className="tiny muted">
        Bar: average hard sets a week, last 4 weeks. Ring: this week so far. Back and shoulders are in bold, the
        two that build the V.
      </div>
    </div>
  )
}

/* ======================================================== beating last time */

const VERDICT: Record<Verdict, { mark: string; color: string; label: string }> = {
  up: { mark: '▲', color: 'var(--series-3)', label: 'beat it' },
  same: { mark: '=', color: 'var(--text-muted)', label: 'matched' },
  down: { mark: '▼', color: 'var(--serious)', label: 'below' },
  new: { mark: '✦', color: 'var(--series-5)', label: 'first time' },
}

/** What changed, in the words a training journal would use. */
function whyText(c: LiftCompare, unit: Unit, secs: boolean): string {
  const { now, before } = c
  if (!before) return 'First time logged — next session has a number to beat.'
  if (now.topKg > 0 || before.topKg > 0) {
    const a = fmt(w(before.topKg, unit))
    const b = fmt(w(now.topKg, unit))
    if (Math.abs(now.topKg - before.topKg) >= 0.05) {
      return now.topKg > before.topKg ? `Top weight up: ${a} → ${b} ${unit}` : `Top weight down: ${a} → ${b} ${unit}`
    }
    const at = (x: ExSession) => x.sets.filter((y) => Math.abs(y.kg - x.topKg) < 0.05).reduce((t, y) => t + y.reps, 0)
    const d = at(now) - at(before)
    return d === 0 ? `Same reps at ${b} ${unit}` : `${d > 0 ? '+' : '−'}${Math.abs(d)} rep${Math.abs(d) === 1 ? '' : 's'} at ${b} ${unit}`
  }
  const d = now.reps - before.reps
  const u = secs ? 's' : ' reps'
  return d === 0 ? `Same total, ${now.reps}${u}` : `${d > 0 ? '+' : '−'}${Math.abs(d)}${u} in total`
}

/**
 * The session, lift by lift, against last time.
 *
 * Shown the moment a session is logged, because that is when the answer is
 * wanted, and again from the Train screen for any past session. The headline
 * is the count that beat last time; the bar under it is the whole session at
 * a glance; each row says what moved, in plain words.
 */
export function SessionScorecard({ workout, unit, onClose }: { workout: Workout; unit: Unit; onClose: () => void }) {
  const all = useLiveQuery(() => db.workouts.toArray(), [])
  const cmp = useMemo(() => (all ? compareSession(all, workout) : []), [all, workout])
  if (!all) return null
  const t = tally(cmp)
  const judged = t.up + t.same + t.down
  const segs: [Verdict, number][] = [
    ['up', t.up],
    ['same', t.same],
    ['down', t.down],
    ['new', t.fresh],
  ]
  const headline =
    judged === 0
      ? 'A first session for these lifts'
      : t.up === judged
        ? `Every lift beat last time`
        : `${t.up} of ${judged} lifts beat last time`

  return (
    <Sheet title="Session scorecard" onClose={onClose}>
      <div
        className="card tight stack tight"
        style={{
          background:
            judged > 0 && t.up / judged >= 0.6
              ? 'linear-gradient(135deg, color-mix(in srgb, var(--series-3) 22%, transparent), transparent 70%)'
              : undefined,
        }}
      >
        <div className="stat-label">{workout.name} · {formatShort(workout.date)}</div>
        <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>
          {headline}
          {judged > 0 && t.up === judged ? ' 🔥' : ''}
        </div>
        <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', background: 'var(--ghost)' }}>
          {segs.map(([v, n]) =>
            n > 0 ? <div key={v} style={{ flex: n, background: VERDICT[v].color, opacity: v === 'same' ? 0.5 : 1 }} /> : null,
          )}
        </div>
        <div className="row tiny" style={{ gap: 12, flexWrap: 'wrap' }}>
          {segs.map(([v, n]) =>
            n > 0 ? (
              <span key={v} style={{ color: VERDICT[v].color, fontWeight: 600 }}>
                {VERDICT[v].mark} {n} {VERDICT[v].label}
              </span>
            ) : null,
          )}
          {t.records > 0 && (
            <span style={{ color: 'var(--series-4)', fontWeight: 600 }}>
              ★ {t.records} record{t.records === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {workout.notFullStrength && (
          <div className="tiny" style={{ color: 'var(--warning)' }}>
            Logged as not at full strength: shown for the record, but it will not count against you or
            become a target.
          </div>
        )}
      </div>

      <div className="card tight">
        {cmp.map((c) => {
          const v = VERDICT[c.verdict]
          const secs = repUnit(byName(c.name)?.reps ?? '') === 's'
          return (
            <div key={c.name} className="row" style={{ gap: 10, padding: '9px 0', borderTop: '1px solid var(--border)', alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: c.verdict === 'same' ? 'var(--text-secondary)' : '#fff',
                  background: c.verdict === 'same' ? 'var(--ghost)' : v.color,
                }}
              >
                {v.mark}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="small truncate" style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.record && (
                    <span className="tiny" style={{ color: 'var(--series-4)', fontWeight: 700, flex: 'none' }}>★ Record</span>
                  )}
                </div>
                <div className="tiny" style={{ color: c.verdict === 'same' ? 'var(--text-secondary)' : v.color }}>{whyText(c, unit, secs)}</div>
                <div className="tiny num truncate" style={{ color: 'var(--text-secondary)' }}>now {setsText(c.now, unit, secs)}</div>
                {c.before && (
                  <div className="tiny muted num truncate">
                    was {setsText(c.before, unit, secs)} · {formatShort(c.before.date)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {cmp.length === 0 && <div className="empty">No lifts in this session to compare.</div>}
      </div>

      <button className="btn primary block" onClick={onClose}>
        Done
      </button>
    </Sheet>
  )
}

/**
 * Progressive overload, week by week.
 *
 * Two panels on one time axis, rather than one chart with two scales: the
 * volume on top, and underneath, every lift of the week stacked by whether it
 * beat, matched or fell short of last time. A healthy block is a tall green
 * column under a rising volume bar; a week of red is visible from across the
 * room. Below the chart, the last sessions, each opening its own scorecard.
 */
function OverloadCard({ workouts, today, unit }: { workouts: Workout[]; today: ISODate; unit: Unit }) {
  const weeks = useMemo(() => overloadByWeek(workouts, today, 10), [workouts, today])
  const recent = useMemo(
    () =>
      workouts
        .filter((x) => x.kind !== 'ride' && x.sets.some((s) => s.minutes == null && s.hardSec == null && s.reps > 0))
        .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))
        .slice(0, 5),
    [workouts],
  )
  const [open, setOpen] = useState<Workout | null>(null)
  const cur = weeks[weeks.length - 1]
  // Volume compares the last two finished weeks: this week is never finished,
  // and set against a whole one it always reads as a drop.
  const last = weeks[weeks.length - 2]
  const before = weeks[weeks.length - 3]
  const judged = (k: WeekOverload) => k.up + k.same + k.down

  return (
    <div className="card stack tight">
      <h3>Progressive overload</h3>
      <div className="row" style={{ gap: 8 }}>
        <MiniStat value={judged(cur) ? `${cur.up}/${judged(cur)}` : '–'} label="beat it, this week" />
        <MiniStat value={String(cur.records)} label="PRs, this week" />
        <MiniStat
          value={
            last && before && before.volumeKg > 0
              ? `${last.volumeKg >= before.volumeKg ? '+' : '−'}${Math.abs(Math.round(((last.volumeKg - before.volumeKg) / before.volumeKg) * 100))}%`
              : '–'
          }
          label="volume, last wk"
        />
      </div>
      <OverloadChart weeks={weeks} unit={unit} />
      <div className="stat-label" style={{ paddingTop: 6 }}>Last sessions</div>
      {recent.map((r) => (
        <SessionRow key={r.id ?? r.date + r.name} workout={r} workouts={workouts} onOpen={() => setOpen(r)} />
      ))}
      {open && <SessionScorecard workout={open} unit={unit} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SessionRow({ workout, workouts, onOpen }: { workout: Workout; workouts: Workout[]; onOpen: () => void }) {
  const t = useMemo(() => tally(compareSession(workouts, workout)), [workouts, workout])
  return (
    <button className="item" onClick={onOpen}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="item-title truncate">{workout.name}</div>
        <div className="tiny muted">{formatShort(workout.date)}{workout.notFullStrength ? ' · not 100%' : ''}</div>
      </div>
      <span className="tiny num row" style={{ gap: 8, flex: 'none', fontWeight: 600 }}>
        {t.up > 0 && <span style={{ color: VERDICT.up.color }}>▲{t.up}</span>}
        {t.same > 0 && <span style={{ color: VERDICT.same.color }}>={t.same}</span>}
        {t.down > 0 && <span style={{ color: VERDICT.down.color }}>▼{t.down}</span>}
        {t.fresh > 0 && <span style={{ color: VERDICT.new.color }}>✦{t.fresh}</span>}
        {t.records > 0 && <span style={{ color: 'var(--series-4)' }}>★{t.records}</span>}
      </span>
      <span className="muted"><Icon.chevron /></span>
    </button>
  )
}

function OverloadChart({ weeks, unit }: { weeks: WeekOverload[]; unit: Unit }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const padL = 34
  const topH = 74
  const gap = 14
  const botH = 70
  const padB = 18
  const height = topH + gap + botH + padB
  const n = weeks.length
  const W = Math.max(0, width - padL)
  const col = n ? W / n : 0
  const bw = Math.max(6, Math.min(26, col * 0.62))
  const vols = weeks.map((k) => w(k.volumeKg, unit))
  const vMax = Math.max(1, ...vols)
  const vTicks = niceTicks(0, vMax, 2).filter((v) => v > 0)
  const counts = weeks.map((k) => k.up + k.same + k.down + k.fresh)
  const cMax = Math.max(1, ...counts)
  const yV = (v: number) => topH - (v / vMax) * (topH - 8)
  const yC = (c: number) => topH + gap + botH - (c / cMax) * botH
  const k = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))

  return (
    <div ref={ref} style={{ position: 'relative', height }} onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block' }}>
          <text x={padL - 6} y={8} textAnchor="end" fontSize="9" fill="var(--text-muted)">{unit}</text>
          {vTicks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={width} y1={yV(v)} y2={yV(v)} stroke="var(--grid)" strokeDasharray="2 4" />
              <text x={padL - 6} y={yV(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--text-muted)">{k(v)}</text>
            </g>
          ))}
          <text x={padL - 6} y={topH + gap + 8} textAnchor="end" fontSize="9" fill="var(--text-muted)">lifts</text>
          {weeks.map((wk, i) => {
            const cx = padL + i * col + (col - bw) / 2
            const current = i === n - 1
            let yy = topH + gap + botH
            const stack: [Verdict, number][] = [
              ['up', wk.up],
              ['same', wk.same],
              ['down', wk.down],
              ['new', wk.fresh],
            ]
            return (
              <g
                key={wk.weekStart}
                onPointerDown={() =>
                  setTip({
                    x: cx + bw / 2,
                    y: Math.min(yV(vols[i]), topH),
                    lines: [
                      `Week of ${formatShort(wk.weekStart)}${current ? ' (so far)' : ''}`,
                      `${Math.round(vols[i]).toLocaleString()} ${unit} · ${wk.sessions} session${wk.sessions === 1 ? '' : 's'}`,
                      `▲${wk.up}  =${wk.same}  ▼${wk.down}${wk.fresh ? `  ✦${wk.fresh}` : ''}${wk.records ? `  ★${wk.records}` : ''}`,
                    ],
                  })
                }
              >
                <rect x={padL + i * col} y={0} width={col} height={height - padB} fill="transparent" />
                <rect
                  x={cx}
                  y={yV(vols[i])}
                  width={bw}
                  height={Math.max(0, topH - yV(vols[i]))}
                  rx={Math.min(5, bw / 2)}
                  fill="var(--accent)"
                  opacity={current ? 0.45 : 0.9}
                />
                {stack.map(([v, c]) => {
                  if (!c) return null
                  const h = (c / cMax) * botH
                  yy -= h
                  return (
                    <rect
                      key={v}
                      x={cx}
                      y={yy}
                      width={bw}
                      height={Math.max(1, h - 1.5)}
                      rx={2}
                      fill={VERDICT[v].color}
                      opacity={(v === 'same' ? 0.45 : 0.9) * (current ? 0.6 : 1)}
                    />
                  )
                })}
                {wk.records > 0 && (
                  <text x={cx + bw / 2} y={yC(counts[i]) - 3} textAnchor="middle" fontSize="9" fill="var(--series-4)" fontWeight="700">
                    ★{wk.records}
                  </text>
                )}
                {(i % 2 === n % 2 || current) && (
                  <text x={cx + bw / 2} y={height - 4} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
                    {current ? 'now' : formatShort(wk.weekStart)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {tip && <Tooltip tip={tip} width={width} />}
      <div className="row tiny muted" style={{ gap: 10, flexWrap: 'wrap', paddingTop: 2 }}>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: 'var(--accent)' }} /> volume</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: VERDICT.up.color }} /> beat last time</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: VERDICT.same.color, opacity: 0.5 }} /> matched</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: VERDICT.down.color }} /> below</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: VERDICT.new.color }} /> first time</span>
        <span style={{ color: 'var(--series-4)' }}>★ records</span>
      </div>
      <div style={{ height: 6 }} />
    </div>
  )
}

