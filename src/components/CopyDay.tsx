import { useEffect, useState } from 'react'
import type { ISODate } from '../db/db'
import { mealsOn, repeatMeal, type PastMeal } from '../db/ops'
import { formatDay } from '../lib/date'
import { Icon, Sheet } from './ui'

/**
 * Copying part of a day rather than all of it.
 *
 * A whole day repeats exactly about never — the lunch box does, most of the
 * rest does not. Copying everything and deleting four sections is worse than
 * naming the one you wanted, which is what the button used to force.
 *
 * Nothing is preselected. A copy that arrives already ticked is one tap from
 * duplicating a day nobody asked for, and the undo for that is six deletions.
 */
export default function CopyDay({
  from,
  to,
  onClose,
  toast,
}: {
  from: ISODate
  to: ISODate
  onClose: () => void
  toast: (m: string) => void
}) {
  const [meals, setMeals] = useState<PastMeal[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void mealsOn(from).then(setMeals)
  }, [from])

  const toggle = (name: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const chosen = (meals ?? []).filter((m) => picked.has(m.meal))
  const kcal = chosen.reduce((t, m) => t + m.kcal, 0)
  const items = chosen.reduce((t, m) => t + m.items, 0)

  return (
    <Sheet title={`Copy from ${formatDay(from).toLowerCase()}`} onClose={onClose}>
      {meals === null ? (
        <div className="empty">Loading…</div>
      ) : meals.length === 0 ? (
        <div className="empty">Nothing was logged that day.</div>
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setPicked(new Set(meals.map((m) => m.meal)))}>
              Everything
            </button>
            {picked.size > 0 && (
              <button className="btn sm ghost" onClick={() => setPicked(new Set())}>
                None
              </button>
            )}
          </div>

          <div className="card tight">
            {meals.map((m) => (
              <div className="row" key={m.meal} style={{ gap: 8 }}>
                <button
                  className={`tickbox${picked.has(m.meal) ? ' on' : ''}`}
                  aria-label={`${m.meal} ${picked.has(m.meal) ? 'selected' : 'not selected'}`}
                  aria-pressed={picked.has(m.meal)}
                  onClick={() => toggle(m.meal)}
                >
                  {picked.has(m.meal) ? <Icon.check /> : null}
                </button>
                <button
                  className="grow"
                  style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', minWidth: 0 }}
                  onClick={() => toggle(m.meal)}
                >
                  <div className="small truncate">{m.meal}</div>
                  <div className="tiny muted num truncate">
                    {m.items} item{m.items === 1 ? '' : 's'} · {Math.round(m.kcal)} kcal
                  </div>
                </button>
              </div>
            ))}
          </div>

          <div className="tiny muted">
            Weights come across exactly as they were logged. If today's box weighed something else,
            change the grams after.
          </div>

          <button
            className="btn primary block"
            disabled={picked.size === 0 || busy}
            onClick={async () => {
              setBusy(true)
              try {
                let n = 0
                for (const m of chosen) n += await repeatMeal(m, to)
                toast(`Copied ${n} item${n === 1 ? '' : 's'} from ${formatDay(from).toLowerCase()}`)
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {picked.size === 0
              ? 'Pick what to copy'
              : `Copy ${picked.size} meal${picked.size === 1 ? '' : 's'} · ${items} items · ${Math.round(kcal)} kcal`}
          </button>
        </>
      )}
    </Sheet>
  )
}
