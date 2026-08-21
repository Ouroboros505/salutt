import { useState } from 'react'
import type { WeighIn } from '../db/db'
import {
  COMP_METRICS,
  GROUP_COLOR,
  compSeries,
  verdict,
  type CompMetric,
  type CompPoint,
} from '../lib/composition'
import { useWidth } from './charts'
import { formatShort } from '../lib/date'

/**
 * The scale's derived numbers over time, each drawn inside its own noise band.
 *
 * The band is ±1 standard deviation of day-to-day precision — the width the
 * reading wanders on hydration alone, with nothing real changing underneath.
 * A line that stays inside its band across the window has not actually moved;
 * one that walks out of it has. That is the whole point of showing them: so a
 * flat week reads as "too soon to tell", not "no progress".
 */
function MiniChart({ metric, points }: { metric: CompMetric; points: CompPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = 84
  const padX = 8
  const padT = 8
  const padB = 8
  const color = GROUP_COLOR[metric.group]
  const sd = metric.noiseSd

  if (points.length === 0) return null

  const v = verdict(points, sd)
  const cur = points[points.length - 1].value

  // Scale y to hold every band, so a whisker never clips at the edge.
  const los = points.map((p) => p.value - sd)
  const his = points.map((p) => p.value + sd)
  let lo = Math.min(...los)
  let hi = Math.max(...his)
  const span = hi - lo || Math.max(sd, 1)
  lo -= span * 0.12
  hi += span * 0.12

  const n = points.length
  const iw = Math.max(1, width - padX * 2)
  const ih = height - padT - padB
  const X = (i: number) => padX + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
  const Y = (val: number) => padT + ih - ((val - lo) / (hi - lo)) * ih

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join('')
  // The ±1 SD ribbon: forward along the tops, back along the bottoms.
  const ribbon =
    points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value + sd).toFixed(1)}`).join('') +
    points
      .slice()
      .reverse()
      .map((p, j) => `L${X(n - 1 - j).toFixed(1)},${Y(p.value - sd).toFixed(1)}`)
      .join('') +
    'Z'

  // Direction colour for the net change, only once it clears the noise.
  const dir =
    !v || !v.signal || metric.good === 'none'
      ? 'muted'
      : (v.delta < 0) === (metric.good === 'down')
        ? 'good'
        : 'bad'
  const deltaText = v
    ? `${v.delta > 0 ? '+' : ''}${v.delta.toFixed(metric.dp)}${metric.unit}`
    : ''

  return (
    <div className="comp-card">
      <div className="comp-head">
        <span className="comp-label">{metric.label}</span>
        <span className="comp-val num" style={{ color }}>
          {cur.toFixed(metric.dp)}
          {metric.unit && <small>{metric.unit}</small>}
        </span>
      </div>
      <div ref={ref} style={{ position: 'relative' }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${metric.label} over time`}>
            <path d={ribbon} fill={color} opacity={0.12} />
            {points.map((p, i) => (
              <g key={i} stroke={color} strokeWidth={1.3} opacity={0.55}>
                {/* whisker: ±1 SD noise band */}
                <line x1={X(i)} x2={X(i)} y1={Y(p.value - sd)} y2={Y(p.value + sd)} />
                <line x1={X(i) - 2.5} x2={X(i) + 2.5} y1={Y(p.value + sd)} y2={Y(p.value + sd)} />
                <line x1={X(i) - 2.5} x2={X(i) + 2.5} y1={Y(p.value - sd)} y2={Y(p.value - sd)} />
              </g>
            ))}
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <circle key={i} cx={X(i)} cy={Y(p.value)} r={i === n - 1 ? 3.4 : 2.4} fill={color} />
            ))}
          </svg>
        )}
      </div>
      <div className="comp-foot">
        {v ? (
          <span className={`comp-delta ${dir}`}>
            {deltaText} · {v.signal ? 'real change' : 'within noise'}
          </span>
        ) : (
          <span className="comp-delta muted">one reading — need more</span>
        )}
      </div>
    </div>
  )
}

export function CompositionCharts({ weighIns, fromDate }: { weighIns: WeighIn[]; fromDate: string }) {
  const [open, setOpen] = useState(false)
  // Only metrics the scale actually recorded in this window are worth a chart.
  const present = COMP_METRICS.filter((m) => compSeries(weighIns, m.key, fromDate).length > 0)
  if (present.length === 0) {
    return (
      <div className="empty">
        No composition readings yet. They come from a scale sync — a manual weight alone has none.
      </div>
    )
  }

  const first = present.map((m) => compSeries(weighIns, m.key, fromDate))
  const dates = first[0]
  const spanLabel =
    dates.length >= 2 ? `${formatShort(dates[0].date)} – ${formatShort(dates[dates.length - 1].date)}` : ''

  return (
    <>
      <div className="tiny muted" style={{ marginBottom: 10 }}>
        Shaded band and whiskers are ±1 SD of day-to-day noise — mostly hydration. A line that stays
        inside its band has not really moved yet. Read weeks, not mornings.{' '}
        <button className="linkbtn" onClick={() => setOpen((o) => !o)}>
          {open ? 'less' : 'why so noisy?'}
        </button>
      </div>
      {open && (
        <div className="note-block tiny">
          The scale measures two things — your weight and your body's electrical resistance — and
          computes the rest. Resistance moves with water, so a salty meal or a hard session shifts
          every number at once. Against a DEXA scan these read about 4 points low on fat, but that
          offset is steady, so the <em>direction</em> is still worth watching even when the absolute
          value is off. {spanLabel && <>Showing {spanLabel}.</>}
        </div>
      )}
      <div className="comp-grid">
        {COMP_METRICS.map((m) => {
          const pts = compSeries(weighIns, m.key, fromDate)
          return pts.length ? <MiniChart key={String(m.key)} metric={m} points={pts} /> : null
        })}
      </div>
    </>
  )
}
