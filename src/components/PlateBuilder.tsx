import { useState } from 'react'
import { db, type ISODate, type Meal } from '../db/db'
import {
  OIL_GRAMS,
  OIL_PER100,
  PLATE,
  plateError,
  plateTotals,
  type PlateItem,
} from '../lib/plate'
import { Icon, NumberInput } from './ui'

/**
 * A meal somebody else cooked, sized against your hand.
 *
 * No searching and no recipe, because neither is available at a party. Pick
 * what was on the plate and how much of it there was, and the arithmetic is
 * done on generic stand-ins — which is honest, since nobody can tell you what
 * went in the tray anyway.
 */
export default function PlateBuilder({
  date,
  meal,
  onDone,
  toast,
}: {
  date: ISODate
  meal: Meal
  onDone: () => void
  toast: (m: string) => void
}) {
  const [items, setItems] = useState<PlateItem[]>([])
  const [oiled, setOiled] = useState(true)
  const [saving, setSaving] = useState(false)

  const totals = plateTotals(items, oiled)
  const error = plateError(items, oiled)

  const add = (key: string, label: string, per100: PlateItem['per100'], grams: number) =>
    setItems((xs) => [...xs, { key: `${key}-${xs.length}`, label, grams, per100 }])

  const save = async () => {
    setSaving(true)
    try {
      const rows = oiled
        ? [...items, { key: 'oil', label: 'Cooked in oil', grams: OIL_GRAMS, per100: OIL_PER100 }]
        : items
      for (const i of rows) {
        const f = i.grams / 100
        const r = (v: number) => Math.round(v * f * 10) / 10
        await db.entries.add({
          date,
          meal,
          name: i.label,
          grams: i.grams,
          amountLabel: `${i.grams} g, estimated`,
          kcal: Math.round(i.per100.kcal * f),
          protein: r(i.per100.protein),
          carbs: r(i.per100.carbs),
          fat: r(i.per100.fat),
          fiber: r(i.per100.fiber),
          createdAt: Date.now(),
        })
      }
      toast(`${meal} logged — about ${Math.round(totals.kcal)} kcal`)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="tiny muted">
        Nothing here was weighed and nothing needs to be. Pick what was on the plate and match each
        one to your hand — the answer is a range, which is all an estimate can honestly be.
      </div>

      {items.length > 0 && (
        <div className="card tight">
          {items.map((i) => (
            <div className="row" key={i.key} style={{ gap: 8, paddingBlock: 6 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="item-title truncate">{i.label}</div>
                <div className="tiny muted num">{Math.round((i.per100.kcal * i.grams) / 100)} kcal</div>
              </div>
              <div style={{ width: 88, flex: 'none' }}>
                <NumberInput
                  value={i.grams || undefined}
                  unit="g"
                  onChange={(v) =>
                    setItems((xs) => xs.map((x) => (x.key === i.key ? { ...x, grams: v ?? 0 } : x)))
                  }
                />
              </div>
              <button
                className="iconbtn"
                aria-label={`Remove ${i.label}`}
                onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}
              >
                <Icon.close />
              </button>
            </div>
          ))}
        </div>
      )}

      {PLATE.map((cat) => (
        <div className="card tight" key={cat.key}>
          <h3>{cat.label}</h3>
          {cat.choices.map((choice) => (
            <div className="stack tight" key={choice.label} style={{ paddingBlock: 4 }}>
              <div className="tiny muted">
                {choice.label} <span className="num">· {Math.round(choice.per100.kcal)} kcal/100 g</span>
              </div>
              <div className="scroll-x">
                {cat.sizes.map((size) => (
                  <button
                    key={size.label}
                    className="chip"
                    onClick={() => add(cat.key, choice.label, choice.per100, size.grams)}
                    title={size.hint}
                  >
                    {size.label} <span className="muted num">{size.grams} g</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={oiled}
          onChange={(e) => setOiled(e.target.checked)}
          style={{ width: 20, height: 20, flex: 'none', marginTop: 2 }}
        />
        <span className="small">
          Cooked in oil or butter
          <span className="tiny muted" style={{ display: 'block' }}>
            Adds a teaspoon, {Math.round((OIL_PER100.kcal * OIL_GRAMS) / 100)} kcal. Anything cooked
            for a crowd was cooked in fat, and leaving it out is the commonest way one of these
            meals is undercounted.
          </span>
        </span>
      </label>

      <div className="card tight">
        <div className="row between">
          <span className="stat-label">About</span>
          <span className="stat-value num">{Math.round(totals.kcal)} kcal</span>
        </div>
        <div className="row between small num">
          <span>Protein {Math.round(totals.protein)} g</span>
          <span>Carbs {Math.round(totals.carbs)} g</span>
          <span>Fat {Math.round(totals.fat)} g</span>
        </div>
        {items.length > 0 && (
          <div className="tiny muted num">
            give or take {error} kcal — judging a plate by eye lands within about 30%
          </div>
        )}
      </div>

      <button className="btn primary block" disabled={saving || items.length === 0} onClick={save}>
        Log about {Math.round(totals.kcal)} kcal to {meal}
      </button>
    </>
  )
}
