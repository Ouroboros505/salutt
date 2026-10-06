import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Measures the container so the SVG can use real pixel units (no text distortion). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min]
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/** Rounded data-end anchored to the baseline: square at the bottom, 4px at the top. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h)
  return (
    `M${x},${y + h}` +
    `V${y + rr}` +
    `a${rr},${rr} 0 0 1 ${rr},-${rr}` +
    `h${w - 2 * rr}` +
    `a${rr},${rr} 0 0 1 ${rr},${rr}` +
    `V${y + h}Z`
  )
}

export interface Tip {
  x: number
  y: number
  lines: string[]
}

export function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  // Keep the bubble inside the plot rather than letting it clip at the edges.
  const left = Math.max(4, Math.min(width - 4, tip.x))
  const anchor = left < 70 ? 'left' : left > width - 70 ? 'right' : 'center'
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: Math.max(2, tip.y - 12),
        transform:
          anchor === 'center'
            ? 'translate(-50%,-100%)'
            : anchor === 'left'
              ? 'translate(0,-100%)'
              : 'translate(-100%,-100%)',
        background: 'var(--text-primary)',
        color: 'var(--plane)',
        borderRadius: 8,
        padding: '6px 9px',
        fontSize: 11.5,
        lineHeight: 1.35,
        fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 5,
      }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} style={{ fontWeight: i === 0 ? 400 : 600, opacity: i === 0 ? 0.75 : 1 }}>
          {l}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- trend chart */

export interface TrendDatum {
  date: string
  label: string
  raw?: number
  trend: number
  /** Weighed under different conditions: shown, but it moved no trend. */
  off?: boolean
}

/**
 * Weight over time: faint daily readings plus the smoothed trend line that is
 * the actual signal. Two marks, so the legend is always present.
 */
export function TrendChart({
  data,
  height = 170,
  unit = 'kg',
  goal,
}: {
  data: TrendDatum[]
  height?: number
  unit?: string
  goal?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<(Tip & { i: number }) | null>(null)

  const padL = 34
  const padR = 8
  const padT = 10
  const padB = 20

  const clear = useCallback(() => setTip(null), [])
  useEffect(() => {
    document.addEventListener('pointerup', clear)
    return () => document.removeEventListener('pointerup', clear)
  }, [clear])

  if (data.length === 0 || width === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        {width > 0 && <div className="empty">No weigh-ins yet</div>}
      </div>
    )
  }

  const values = data.flatMap((d) => [d.trend, ...(d.raw != null ? [d.raw] : [])])
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  const span = hi - lo || 1
  // Enough room that the highest and lowest readings sit inside the plot with
  // their marks clear of the axis, rather than half-buried in it.
  lo -= span * 0.2
  hi += span * 0.16

  // A goal far below current weight would flatten the data into a sliver at the
  // top of the plot, so it only joins the scale once it is within reach. Out of
  // range it becomes a note on the axis instead of a line.
  const goalInRange = goal != null && goal > lo - span * 0.75 && goal < hi + span * 0.75
  if (goal != null && goalInRange) {
    lo = Math.min(lo, goal - span * 0.1)
    hi = Math.max(hi, goal + span * 0.1)
  }

  const iw = Math.max(1, width - padL - padR)
  const ih = height - padT - padB
  const n = data.length
  const X = (i: number) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
  const Y = (v: number) => padT + ih - ((v - lo) / (hi - lo)) * ih

  const trendPath = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.trend).toFixed(1)}`).join('')
  const ticks = niceTicks(lo, hi, 4)

  // Label the first, last and roughly middle date only — never every point.
  const xLabels = new Set([0, n - 1, Math.floor((n - 1) / 2)])

  const pick = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    let bd = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(X(i) - px)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    const d = data[best]
    setTip({
      i: best,
      x: X(best),
      y: Y(d.trend),
      lines: [
        d.label,
        `Trend ${d.trend.toFixed(1)} ${unit}`,
        ...(d.raw != null ? [`Scale ${d.raw.toFixed(2)} ${unit}`] : []),
        ...(d.off ? ['Not counted in the trend'] : []),
      ],
    })
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="chart"
        width={width}
        height={height}
        role="img"
        aria-label={`Weight trend, ${data.length} weigh-ins, latest ${data[n - 1].trend.toFixed(1)} ${unit}`}
        onPointerDown={pick}
        onPointerMove={pick}
        onPointerLeave={clear}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} />
            <text x={padL - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle">
              {t.toFixed(t % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}

        {goal != null && goalInRange && (
          <g>
            <line
              x1={padL}
              x2={width - padR}
              y1={Y(goal)}
              y2={Y(goal)}
              stroke="var(--success-text)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text x={width - padR} y={Y(goal) - 5} textAnchor="end" fill="var(--success-text)">
              goal
            </text>
          </g>
        )}

        {/* Out of range: a note on the axis, placed away from where a falling
            line ends up so it never collides with the data. */}
        {goal != null && !goalInRange && (
          <text x={padL + 2} y={padT + ih - 2} textAnchor="start" fill="var(--success-text)">
            goal {goal} {unit} ↓
          </text>
        )}

        {/*
          The fit goes underneath and dashed, the measurements on top and
          solid. A smoothed line is an interpretation of the readings; drawing
          it boldly over them says the opposite — that the readings are a
          smudge around the line. Every one of those dots is a morning you
          stood on the scale, and the line is only what was inferred from them.
        */}
        <path
          d={trendPath}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.6}
          strokeDasharray="5 4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />

        {/* The end of the fit, small, so the line has somewhere to stop. */}
        <circle
          cx={X(n - 1)}
          cy={Y(data[n - 1].trend)}
          r={2.6}
          fill="var(--series-1)"
          opacity={0.7}
        />

        {data.map((d, i) =>
          d.raw == null ? null : d.off ? (
            // Hollow: seen, and set aside.
            <circle
              key={i}
              cx={X(i)}
              cy={Y(d.raw)}
              r={4}
              fill="var(--surface-1)"
              stroke="var(--text-muted)"
              strokeWidth={1.6}
            />
          ) : (
            // Ringed in the surface colour so a reading sitting on the line
            // still reads as a separate thing rather than a bulge in it.
            <circle
              key={i}
              cx={X(i)}
              cy={Y(d.raw)}
              r={4}
              fill="var(--text-primary)"
              stroke="var(--surface-1)"
              strokeWidth={1.4}
            />
          ),
        )}

        {tip && (
          <>
            <line className="axisline" x1={tip.x} x2={tip.x} y1={padT} y2={padT + ih} />
            <circle cx={tip.x} cy={tip.y} r={4.5} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
          </>
        )}

        {data.map((d, i) =>
          xLabels.has(i) ? (
            <text key={i} x={X(i)} y={height - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {d.label}
            </text>
          ) : null,
        )}
      </svg>

      {tip && <Tooltip tip={tip} width={width} />}

      <div className="legend">
        <span>
          <svg width="14" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="14"
              y2="4"
              stroke="var(--series-1)"
              strokeWidth="1.6"
              strokeDasharray="5 4"
              strokeLinecap="round"
              opacity="0.7"
            />
          </svg>
          Trend
        </span>
        <span>
          <svg width="12" height="8" aria-hidden="true">
            <circle cx="6" cy="4" r="3.4" fill="var(--text-primary)" />
          </svg>
          Daily reading
        </span>
        {data.some((d) => d.off) && (
          <span>
            <svg width="12" height="8" aria-hidden="true">
              <circle cx="6" cy="4" r="3.4" fill="var(--surface-1)" stroke="var(--text-muted)" strokeWidth="1.4" />
            </svg>
            Not in trend
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- bar chart */

export interface BarDatum {
  label: string
  value: number
  sublabel?: string
}

/** Daily magnitude against a target — one series, target as a reference line. */
export function BarChart({
  data,
  target,
  height = 150,
  unit = 'kcal',
}: {
  data: BarDatum[]
  target?: number
  height?: number
  unit?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)

  const padL = 34
  const padR = 8
  const padT = 10
  const padB = 20

  if (data.length === 0 || width === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        {width > 0 && <div className="empty">Nothing logged yet</div>}
      </div>
    )
  }

  const hi = Math.max(...data.map((d) => d.value), target ?? 0) * 1.12 || 1
  const iw = Math.max(1, width - padL - padR)
  const ih = height - padT - padB
  const n = data.length
  const slot = iw / n
  const bw = Math.max(3, Math.min(26, slot - 3)) // >=2px surface gap between bars
  const X = (i: number) => padL + slot * i + (slot - bw) / 2
  const Y = (v: number) => padT + ih - (v / hi) * ih

  const ticks = niceTicks(0, hi, 3)
  const labelEvery = Math.ceil(n / 6)

  const tipLines = (d: BarDatum): string[] => {
    const head = d.sublabel ?? d.label
    const value = `${Math.round(d.value)} ${unit}`
    if (target == null || d.value === 0) return [head, value]
    const diff = Math.round(d.value - target)
    return [head, value, `${diff >= 0 ? '+' : ''}${diff} vs target`]
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        className="chart"
        width={width}
        height={height}
        role="img"
        aria-label={`${unit} per day, ${n} days`}
        onMouseLeave={() => setTip(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} />
            <text x={padL - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle">
              {t >= 1000 ? `${Math.round(t / 100) / 10}k` : t}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, ih - (Y(d.value) - padT))
          if (h === 0) return null
          return (
            <path
              key={i}
              d={barPath(X(i), Y(d.value), bw, h)}
              fill="var(--series-1)"
              onPointerDown={() =>
                setTip({
                  x: X(i) + bw / 2,
                  y: Y(d.value),
                  lines: tipLines(d),
                })
              }
              onMouseEnter={() =>
                setTip({
                  x: X(i) + bw / 2,
                  y: Y(d.value),
                  lines: tipLines(d),
                })
              }
            />
          )
        })}

        {target != null && target > 0 && (
          <g>
            <line
              x1={padL}
              x2={width - padR}
              y1={Y(target)}
              y2={Y(target)}
              stroke="var(--text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text x={width - padR} y={Y(target) - 5} textAnchor="end" fill="var(--text-secondary)">
              target
            </text>
          </g>
        )}

        <line className="axisline" x1={padL} x2={width - padR} y1={padT + ih} y2={padT + ih} />

        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={X(i) + bw / 2} y={height - 5} textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {tip && <Tooltip tip={tip} width={width} />}
    </div>
  )
}
