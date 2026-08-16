import { useEffect, useRef, useState } from 'react'
import { db, type Recipe, type RecipeItem } from '../db/db'
import { scale, searchLocal } from '../db/ops'
import { loadFoodDb, searchFoodDb } from '../lib/foodDb'
import type { FoodHit } from '../lib/foodApi'
import { finishedWeight, per100, recipeTotals, servingGrams, waterLossPct } from '../lib/recipes'
import { parseRecipeText, type ParsedLine } from '../lib/parseRecipe'
import { Field, Icon, Sheet } from './ui'

type Draft = Omit<Recipe, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>

const EMPTY: Draft = { name: '', items: [], cookedG: 0, servings: undefined, notes: '' }

/**
 * Building a meal prep: ingredients in, finished weight measured, portions out.
 *
 * The finished weight is the field that matters and the one people skip, so it
 * is given its own card with the water loss shown next to it — an implausible
 * figure there is the fastest way to spot a mistyped number.
 */
export default function RecipeEditor({
  recipe,
  onClose,
  toast,
}: {
  recipe?: Recipe
  onClose: () => void
  toast: (m: string) => void
}) {
  const [draft, setDraft] = useState<Draft>(recipe ? { ...recipe } : EMPTY)
  const [picking, setPicking] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const totals = recipeTotals(draft.items)
  const weight = finishedWeight(draft)
  const p100 = per100(draft)
  const loss = waterLossPct(draft)
  const perServing = servingGrams(draft)

  const save = async () => {
    const row = {
      ...draft,
      name: draft.name.trim(),
      items: draft.items,
      cookedG: draft.cookedG || 0,
    }
    if (recipe?.id) {
      await db.recipes.update(recipe.id, row)
    } else {
      await db.recipes.add({ ...row, useCount: 0, lastUsed: 0, createdAt: Date.now() })
    }
    toast(recipe ? 'Recipe updated' : 'Recipe saved')
    onClose()
  }

  if (pasting) {
    return (
      <PasteRecipe
        onClose={() => setPasting(false)}
        onDone={(items) => {
          setDraft((d) => ({ ...d, items: [...d.items, ...items] }))
          setPasting(false)
        }}
      />
    )
  }

  if (picking) {
    return (
      <IngredientPicker
        onClose={() => setPicking(false)}
        onAdd={(item) => {
          setDraft((d) => ({ ...d, items: [...d.items, item] }))
          setPicking(false)
        }}
      />
    )
  }

  return (
    <Sheet title={recipe ? draft.name || 'Recipe' : 'New meal prep'} onClose={onClose}>
      <Field label="Name">
        <input
          autoFocus={!recipe}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Chicken and rice tray, lentil chilli…"
        />
      </Field>

      <div className="card tight">
        <div className="card-head">
          <h3>Ingredients</h3>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setPasting(true)}>
              Paste list
            </button>
            <button className="btn sm" onClick={() => setPicking(true)}>
              <Icon.plus /> Add
            </button>
          </div>
        </div>

        {draft.items.length === 0 ? (
          <div className="empty">
            Add everything that goes in, at raw weight — or paste the whole list at once.
          </div>
        ) : (
          <div>
            {draft.items.map((item, i) => (
              <div className="item" key={i}>
                <div className="grow">
                  <div className="item-title truncate">{item.name}</div>
                  <div className="tiny muted num">
                    {item.grams} g · {Math.round(item.kcal)} kcal · P {Math.round(item.protein)} C{' '}
                    {Math.round(item.carbs)} F {Math.round(item.fat)}
                  </div>
                </div>
                <button
                  className="iconbtn"
                  aria-label={`Remove ${item.name}`}
                  onClick={() =>
                    setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })
                  }
                >
                  <Icon.close />
                </button>
              </div>
            ))}
            <div className="row between small num" style={{ paddingTop: 8 }}>
              <span className="muted">Raw total</span>
              <span>
                {Math.round(totals.grams)} g · {Math.round(totals.kcal)} kcal
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="card tight">
        <h3>Finished dish</h3>
        <div className="grid-2">
          <Field label="Cooked weight (g)">
            <input
              type="number"
              inputMode="numeric"
              value={draft.cookedG || ''}
              placeholder={String(Math.round(totals.grams) || '')}
              onChange={(e) => setDraft({ ...draft, cookedG: parseFloat(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Portions" hint="optional">
            <input
              type="number"
              inputMode="numeric"
              value={draft.servings ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, servings: parseInt(e.target.value) || undefined })
              }
            />
          </Field>
        </div>

        <div className="tiny muted">
          Weigh the tray after cooking. Water leaves as it cooks, so the finished dish is lighter
          than what went in and denser per gram — scaling off the raw total would overstate every
          portion. Leave it blank to use the raw total anyway.
        </div>

        {loss !== null && (
          <div
            className="tiny"
            style={{ color: loss < -5 || loss > 60 ? 'var(--serious)' : 'var(--text-muted)' }}
          >
            {loss >= 0
              ? `Lost ${loss.toFixed(0)}% of its weight cooking.`
              : `Gained ${Math.abs(loss).toFixed(0)}% — expected for anything that absorbs water, odd otherwise.`}
            {(loss < -5 || loss > 60) && ' Worth double-checking that number.'}
          </div>
        )}
      </div>

      {draft.items.length > 0 && weight > 0 && (
        <div className="card tight">
          <h3>What a portion costs</h3>
          <div className="grid-3">
            <Cell label="Per 100 g" value={`${Math.round(p100.kcal)}`} sub="kcal" />
            <Cell label="Protein" value={`${p100.protein.toFixed(1)}`} sub="g / 100 g" />
            <Cell
              label={perServing ? 'One portion' : 'Whole dish'}
              value={`${Math.round(perServing ?? weight)}`}
              sub="g"
            />
          </div>
          {perServing && (
            <div className="small secondary num">
              One portion ({perServing} g) ={' '}
              <strong>{Math.round((p100.kcal * perServing) / 100)} kcal</strong> · P{' '}
              {((p100.protein * perServing) / 100).toFixed(0)} C{' '}
              {((p100.carbs * perServing) / 100).toFixed(0)} F{' '}
              {((p100.fat * perServing) / 100).toFixed(0)}
            </div>
          )}
        </div>
      )}

      <button
        className="btn primary block"
        disabled={!draft.name.trim() || draft.items.length === 0}
        onClick={save}
      >
        {recipe ? 'Save changes' : 'Save meal prep'}
      </button>

      {recipe?.id &&
        (confirmDelete ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn grow" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn danger grow"
              onClick={async () => {
                await db.recipes.delete(recipe.id!)
                toast('Recipe deleted')
                onClose()
              }}
            >
              Delete for good
            </button>
          </div>
        ) : (
          <button className="btn danger block" onClick={() => setConfirmDelete(true)}>
            <Icon.trash /> Delete recipe
          </button>
        ))}
    </Sheet>
  )
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stack tight">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- paste */

/**
 * Parts of a food that are not the food itself.
 *
 * "3 eggs" matches egg yolk and egg white ahead of egg whole, because all
 * three carry a portion and the names are equally close. Unless a part was
 * actually asked for, prefer the one that is not a part.
 */
const PART_WORDS = ['yolk', 'white', 'skin', 'shell', 'powder', 'powdered', 'dried', 'substitute', 'juice']

interface Resolved {
  line: ParsedLine
  hit: FoodHit | null
  grams: number
  include: boolean
}

/**
 * Pasting a whole ingredient list at once.
 *
 * Everything it works out is shown before anything is added — matched food,
 * resolved weight, and how sure it is — because a parser that quietly guesses
 * wrong is worse than typing the list by hand.
 */
function PasteRecipe({
  onDone,
  onClose,
}: {
  onDone: (items: RecipeItem[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Resolved[] | null>(null)
  const [busy, setBusy] = useState(false)

  const resolve = async () => {
    setBusy(true)
    try {
      const entries = await loadFoodDb()
      const parsed = parseRecipeText(text)
      const out: Resolved[] = []

      for (const line of parsed) {
        const mine = await searchLocal(line.query, 5)
        const candidates: FoodHit[] = [...mine, ...searchFoodDb(line.query, entries, 5)]

        // For a counted line the match has to know what one piece weighs —
        // but preferring any entry with a portion picks egg *yolk* for "3
        // eggs", because that one happens to carry one. So prefer an entry
        // whose portion is named after what was actually asked for.
        const wanted = [line.countUnit, ...line.query.toLowerCase().split(/\s+/)]
          .filter((w): w is string => !!w && w.length > 2)
          .map((w) => w.replace(/s$/, ''))

        const askedFor = (word: string) => line.query.toLowerCase().includes(word)
        const unwantedParts = PART_WORDS.filter((w) => !askedFor(w))

        const usable = candidates
          .filter((c) => c.portions.length > 0)
          .map((c, rank) => {
            const name = c.name.toLowerCase()
            let score = -rank
            if (c.portions.some((portion) => wanted.some((w) => portion.label.toLowerCase().includes(w)))) {
              score += 10
            }
            if (unwantedParts.some((w) => name.includes(w))) score -= 20
            if (name.includes('whole')) score += 4
            return { c, score }
          })
          .sort((a, b) => b.score - a.score)

        const hit: FoodHit | null =
          (line.count != null ? usable[0]?.c : undefined) ?? candidates[0] ?? null

        let grams = line.grams ?? 0
        if (grams === 0 && line.count != null && hit) {
          // "3 eggs" only becomes a weight if the food knows what one weighs.
          const named = line.countUnit
            ? hit.portions.find((p) => p.label.toLowerCase().includes(line.countUnit!.replace(/s$/, '')))
            : undefined
          const chosen = named ?? hit.portions[0]
          if (chosen) grams = line.count * chosen.grams
        }
        out.push({ line, hit, grams: Math.round(grams), include: !!hit && grams > 0 })
      }
      setRows(out)
    } finally {
      setBusy(false)
    }
  }

  if (rows) {
    const ready = rows.filter((r) => r.include && r.hit && r.grams > 0)
    return (
      <Sheet title="Check the list" onClose={() => setRows(null)}>
        <div className="tiny muted">
          Uncheck anything wrong, fix the weights, then add. Nothing is saved until you do.
        </div>

        <div className="card tight">
          {rows.map((r, i) => (
            <div key={i} className="stack tight" style={{ paddingBlock: 8, borderBottom: '1px solid var(--grid)' }}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={r.include}
                  disabled={!r.hit}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (i === j ? { ...x, include: e.target.checked } : x)))
                  }
                  style={{ width: 20, height: 20, flex: 'none' }}
                />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="item-title truncate">{r.hit?.name ?? r.line.query}</div>
                  <div className="tiny muted truncate">
                    {r.line.raw}
                    {!r.hit && ' · no match found'}
                    {r.line.note && r.hit ? ` · ${r.line.note}` : ''}
                  </div>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={r.grams || ''}
                  placeholder="g"
                  onChange={(e) =>
                    setRows(
                      rows.map((x, j) =>
                        i === j ? { ...x, grams: parseFloat(e.target.value) || 0 } : x,
                      ),
                    )
                  }
                  style={{ width: 74, flex: 'none' }}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          className="btn primary block"
          disabled={ready.length === 0}
          onClick={() =>
            onDone(
              ready.map((r) => ({
                name: r.hit!.name,
                brand: r.hit!.brand,
                grams: r.grams,
                ...scale(r.hit!, r.grams),
              })),
            )
          }
        >
          Add {ready.length} ingredient{ready.length === 1 ? '' : 's'}
        </button>
        <button className="btn ghost block muted" onClick={() => setRows(null)}>
          Back to the text
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet title="Paste the ingredients" onClose={onClose}>
      <div className="tiny muted">
        One per line, however you wrote them down. Weights, counts and spoons are all understood;
        anything it cannot work out gets flagged rather than guessed at.
      </div>
      <textarea
        autoFocus
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'1kg chicken breast\n500 g white rice\n2 tbsp olive oil\n3 eggs\n400g black beans'}
        style={{ fontFamily: 'inherit' }}
      />
      <button className="btn primary block" disabled={!text.trim() || busy} onClick={resolve}>
        {busy ? 'Reading…' : 'Read the list'}
      </button>
    </Sheet>
  )
}

/* ---------------------------------------------------------------- picker */

/** Choosing an ingredient and its raw weight. */
function IngredientPicker({
  onAdd,
  onClose,
}: {
  onAdd: (item: RecipeItem) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<FoodHit[]>([])
  const [chosen, setChosen] = useState<FoodHit | null>(null)
  const [grams, setGrams] = useState('100')
  const entries = useRef<Awaited<ReturnType<typeof loadFoodDb>> | null>(null)

  useEffect(() => {
    let alive = true
    void loadFoodDb().then((e) => {
      if (alive) entries.current = e
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const q = query.trim()
      if (q.length < 2) {
        setHits([])
        return
      }
      // Your own foods first — a meal prep is built from things you buy.
      const mine = await searchLocal(q, 8)
      const bundled = entries.current ? searchFoodDb(q, entries.current, 20) : []
      if (!alive) return
      const mineHits: FoodHit[] = mine.map((f) => ({ ...f }))
      const seen = new Set(mineHits.map((f) => f.name.toLowerCase()))
      setHits([...mineHits, ...bundled.filter((b) => !seen.has(b.name.toLowerCase()))])
    })()
    return () => {
      alive = false
    }
  }, [query])

  if (chosen) {
    const g = parseFloat(grams) || 0
    const macros = scale(chosen, g)
    return (
      <Sheet title={chosen.name} onClose={() => setChosen(null)}>
        <Field label="Raw weight (g)" hint="What goes into the pot, before cooking">
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </Field>
        <div className="row between small num">
          <span className="muted">{macros.kcal} kcal</span>
          <span>
            P {macros.protein} C {macros.carbs} F {macros.fat}
          </span>
        </div>
        <button
          className="btn primary block"
          disabled={g <= 0}
          onClick={() =>
            onAdd({
              foodId: undefined,
              name: chosen.name,
              brand: chosen.brand,
              grams: g,
              ...macros,
            })
          }
        >
          Add to recipe
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet title="Add ingredient" onClose={onClose}>
      <div style={{ position: 'relative' }}>
        <input
          autoFocus
          type="search"
          placeholder="Search foods…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
        <span
          style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}
        >
          <Icon.search />
        </span>
      </div>

      <div className="card tight">
        {hits.length === 0 ? (
          <div className="empty">{query.trim().length < 2 ? 'Type to search' : 'No matches'}</div>
        ) : (
          <div>
            {hits.slice(0, 25).map((h, i) => (
              <button key={i} className="item" onClick={() => setChosen(h)}>
                <div className="grow">
                  <div className="item-title truncate">{h.name}</div>
                  <div className="tiny muted truncate">
                    {h.brand ? `${h.brand} · ` : ''}
                    {Math.round(h.kcal)} kcal / 100 g
                  </div>
                </div>
                <span className="muted">
                  <Icon.chevron />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
