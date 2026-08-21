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
import { useWidth, niceTicks } from './charts'
import { formatShort } from '../lib/date'

/**
 * One scale metric over time, drawn as a proper chart: a scaled y-axis with
 * gridlines, dated x-axis, and a ±1 SD error bar on every reading.
 *
 * The error bar is day-to-day precision — the width the number wanders on
 * hydration alone. When consecutive bars overlap, the change between them is
 * inside the noise and means nothing; when they pull apart, it is real. That
 * comparison is the entire reason these are worth plotting, so the axis is
 * scaled to the data-plus-error, not zoomed so far in that noise looks like
 * signal.
 */
function MiniChart({ metric, points }: { metric: CompMetric; points: CompPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = 138
  const padL = 34
  const padR = 10
  const padT = 10
  const padB = 22
  const color = GROUP_COLOR[metric.group]
  const sd = metric.noiseSd

  if (points.length === 0) return null

  const v = verdict(points, sd)
  const cur = points[points.length - 1].value

  // Scale to hold every error bar, then round out to nice tick values.
  let lo = Math.min(...points.map((p) => p.value - sd))
  let hi = Math.max(...points.map((p) => p.value + sd))
  const span = hi - lo || Math.max(sd, 1)
  lo -= span * 0.15
  hi += span * 0.15
  const ticks = niceTicks(lo, hi, 3)
  lo = Math.min(lo, ticks[0])
  hi = Math.max(hi, ticks[ticks.length - 1])

  const n = points.length
  const iw = Math.max(1, width - padL - padR)
  const ih = height - padT - padB
  const X = (i: number) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
  const Y = (val: number) => padT + ih - ((val - lo) / (hi - lo)) * ih
  const fmtTick = (t: number) => t.toFixed(t % 1 === 0 ? 0 : 1)

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join('')

  // First, middle and last date only — never every point.
  const xLabelIdx = new Set([0, n - 1, Math.floor((n - 1) / 2)])

  const dir =
    !v || !v.signal || metric.good === 'none'
      ? 'muted'
      : (v.delta < 0) === (metric.good === 'down')
        ? 'good'
        : 'bad'
  const deltaText = v ? `${v.delta > 0 ? '+' : ''}${v.delta.toFixed(metric.dp)}${metric.unit}` : ''

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
          <svg className="chart" width={width} height={height} role="img" aria-label={`${metric.label} over time with ±1 SD error bars`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} />
                <text x={padL - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle">
                  {fmtTick(t)}
                </text>
              </g>
            ))}

            {/* One SD of day-to-day noise, drawn on every reading. */}
            {points.map((p, i) => (
              <g key={i} stroke={color} strokeWidth={1.4}>
                <line x1={X(i)} x2={X(i)} y1={Y(p.value - sd)} y2={Y(p.value + sd)} opacity={0.9} />
                <line x1={X(i) - 3} x2={X(i) + 3} y1={Y(p.value + sd)} y2={Y(p.value + sd)} opacity={0.9} />
                <line x1={X(i) - 3} x2={X(i) + 3} y1={Y(p.value - sd)} y2={Y(p.value - sd)} opacity={0.9} />
              </g>
            ))}

            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={X(i)}
                cy={Y(p.value)}
                r={i === n - 1 ? 3.6 : 2.6}
                fill={color}
                stroke="var(--surface-1)"
                strokeWidth={1.2}
              />
            ))}

            {points.map((p, i) =>
              xLabelIdx.has(i) ? (
                <text
                  key={`x${i}`}
                  x={X(i)}
                  y={height - 6}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                >
                  {formatShort(p.date)}
                </text>
              ) : null,
            )}
          </svg>
        )}
      </div>
      <div className="comp-foot">
        {v ? (
          <span className={`comp-delta ${dir}`}>
            {deltaText} over range · {v.signal ? 'real change' : 'within noise'}
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
  const present = COMP_METRICS.filter((m) => compSeries(weighIns, m.key, fromDate).length > 0)
  if (present.length === 0) {
    return (
      <div className="empty">
        No composition readings yet. They come from a scale sync — a manual weight alone has none.
      </div>
    )
  }

  const sample = compSeries(weighIns, present[0].key, fromDate)
  const spanLabel =
    sample.length >= 2 ? `${formatShort(sample[0].date)} – ${formatShort(sample[sample.length - 1].date)}` : ''

  return (
    <>
      <div className="tiny muted" style={{ marginBottom: 10 }}>
        Error bars are ±1 SD of day-to-day noise — mostly hydration. Where a reading's bar overlaps
        the next, the change is inside the noise; when the bars pull apart, it is real.{' '}
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
