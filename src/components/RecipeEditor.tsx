import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Recipe, type RecipeItem } from '../db/db'
import { scale, searchLocal } from '../db/ops'
import { densityIndex, loadFoodDb, searchFoodDb } from '../lib/foodDb'
import type { FoodHit } from '../lib/foodApi'

/**
 * A candidate ingredient, carrying where it came from.
 *
 * Which source matched is the difference between the exact product you buy and
 * a generic database entry that happens to share a name, so it is kept rather
 * than flattened away — and shown, so a wrong pick is visible before it is
 * baked into a week of lunches.
 */
type Candidate = FoodHit & { foodId?: number; mine: boolean }
import {
  COOK_STYLES,
  DISH_TYPES,
  recipeDensity,
  finishedWeight,
  spreadFor,
  per100,
  recipeTotals,
  servingGrams,
  waterLossPct,
} from '../lib/recipes'
import { parseRecipeText, type ParsedLine } from '../lib/parseRecipe'
import { Field, Icon, NumberInput, Sheet } from './ui'

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

  // Every ingredient's own measured density where the database has one, its
  // category otherwise, combined by volume and then reduced for what boiled off.
  const dbEntries = useLiveQuery(() => loadFoodDb(), [])
  const index = useMemo(() => (dbEntries ? densityIndex(dbEntries) : null), [dbEntries])
  const derived = useMemo(
    () => (index ? recipeDensity(draft, (name) => index.get(name) ?? null) : null),
    [index, draft],
  )
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
            <NumberInput
              value={draft.cookedG || undefined}
              unit="g"
              placeholder={String(Math.round(totals.grams) || '')}
              onChange={(v) => setDraft({ ...draft, cookedG: v ?? 0 })}
            />
          </Field>
          <Field label="Cut into how many portions" hint="optional">
            <NumberInput
              value={draft.servings}
              unit="×"
              placeholder="6"
              onChange={(v) => setDraft({ ...draft, servings: v || undefined })}
            />
          </Field>
        </div>

        <div className="tiny muted">
          Weighing the finished dish is the exact route, but nobody weighs a full pot. Leave it
          blank and say how the pot was run instead — only what evaporates is lost, since water the
          meat gives up stays in the sauce.
        </div>

        {!draft.cookedG && (
          <div className="stack tight">
            <div className="scroll-x">
              {COOK_STYLES.map((c) => (
                <button
                  key={c.label}
                  className="chip"
                  aria-pressed={(draft.cookLossPct ?? -1) === Math.round(c.loss * 100)}
                  onClick={() => setDraft({ ...draft, cookLossPct: Math.round(c.loss * 100) })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {draft.cookLossPct != null && totals.grams > 0 && (
              <div className="tiny muted num">
                {Math.round(totals.grams)} g raw − {draft.cookLossPct}% evaporated ≈{' '}
                <strong>{Math.round(finishedWeight(draft))} g</strong> in the pot
              </div>
            )}
          </div>
        )}

        {/* The one number a lunch is actually built from. */}
        {totals.grams > 0 && (
          <div className="card tight">
            <div className="row between">
              <span className="stat-label">Per 100 g of the finished dish</span>
              <span className="stat-value num">{Math.round(p100.kcal)} kcal</span>
            </div>
            <div className="row between small num">
              <span>Protein {p100.protein.toFixed(1)} g</span>
              <span>Carbs {p100.carbs.toFixed(1)} g</span>
              <span>Fat {p100.fat.toFixed(1)} g</span>
            </div>
          </div>
        )}

        {/* Density is what turns a share of the lunch box into grams, and it
            is worked out from the ingredients rather than picked from a list:
            a weighed container showed the category route 50% out on a chunky
            braise, while the ingredient sum was within a few percent. */}
        <div className="stack tight">
          {derived && (
            <div className="row between">
              <span className="tiny muted num grow">
                From the ingredients: <strong>{derived.density} g/ml</strong>
                {derived.measured > 0.3
                  ? ` · ${Math.round(derived.measured * 100)}% of the batch measured`
                  : ''}
              </span>
              {draft.density !== derived.density && (
                <button className="btn sm" onClick={() => setDraft({ ...draft, density: derived.density })}>
                  Use it
                </button>
              )}
            </div>
          )}
          <div className="tiny muted">Or say what it is like in the box, if you would rather.</div>
          <div className="scroll-x">
            {DISH_TYPES.map((t) => (
              <button
                key={t.label}
                className="chip"
                aria-pressed={draft.density === t.density}
                onClick={() => setDraft({ ...draft, density: t.density })}
              >
                {t.label} <span className="muted num">{t.density}</span>
              </button>
            ))}
          </div>
          {draft.density && (
            <div className="tiny muted num">
              70% of a 750 ml box ={' '}
              <strong>{Math.round(0.7 * 750 * draft.density)} g</strong> ={' '}
              {Math.round((0.7 * 750 * draft.density * p100.kcal) / 100)} kcal, ±
              {Math.round(spreadFor(draft.density) * 100)}%
            </div>
          )}
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
  hit: Candidate | null
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
  // Which row has its search open. Only one at a time — the list is long
  // enough without every row unfolding at once.
  const [fixing, setFixing] = useState<number | null>(null)

  const resolve = async () => {
    setBusy(true)
    try {
      const entries = await loadFoodDb()
      const parsed = parseRecipeText(text)
      const out: Resolved[] = []

      for (const line of parsed) {
        // Seasonings contribute nothing; show them as skipped rather than
        // hunting for a match that the database deliberately does not carry.
        if (line.confidence === 'negligible') {
          out.push({ line, hit: null, grams: 0, include: false })
          continue
        }
        const mine = await searchLocal(line.query, 5)
        const candidates: Candidate[] = [
          ...mine.map((f) => ({ ...f, foodId: f.id, mine: true })),
          ...searchFoodDb(line.query, entries, 5).map((f) => ({ ...f, mine: false })),
        ]

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

        const hit: Candidate | null =
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
    const unmatched = rows.filter((r) => !r.hit && r.line.confidence !== 'negligible').length
    return (
      <Sheet title="Check the list" onClose={() => setRows(null)}>
        <div className="tiny muted">
          Uncheck anything wrong, fix the weights, and use Change on anything it got wrong or
          could not place. Nothing is saved until you add.
        </div>
        {unmatched > 0 && (
          <div className="tiny" style={{ color: 'var(--warn-text, var(--text-muted))' }}>
            {unmatched} line{unmatched === 1 ? '' : 's'} still without a match — tap Find a match to
            search for {unmatched === 1 ? 'it' : 'them'}.
          </div>
        )}

        <div className="card tight">
          {rows.map((r, i) => (
            <div key={i} className="stack tight" style={{ paddingBlock: 8, borderBottom: '1px solid var(--grid)' }}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={r.include}
                  disabled={!r.hit || r.line.confidence === 'negligible'}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (i === j ? { ...x, include: e.target.checked } : x)))
                  }
                  style={{ width: 20, height: 20, flex: 'none' }}
                />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="item-title truncate">
                    {r.hit?.name ?? r.line.query}
                    {r.hit?.mine && (
                      <span className="tiny" style={{ color: 'var(--success-text)' }}> · yours</span>
                    )}
                  </div>
                  <div className="tiny muted truncate">
                    {r.line.raw}
                    {r.line.confidence === 'negligible'
                      ? ' · skipped, no calories worth logging'
                      : !r.hit
                        ? ' · no match found'
                        : r.line.note
                          ? ` · ${r.line.note}`
                          : ''}
                  </div>
                </div>
                <div style={{ width: 92, flex: 'none' }}>
                  <NumberInput
                    value={r.grams || undefined}
                    unit="g"
                    onChange={(v) =>
                      setRows(rows.map((x, j) => (i === j ? { ...x, grams: v ?? 0 } : x)))
                    }
                  />
                </div>
              </div>

              <div className="row" style={{ gap: 8, paddingLeft: 28 }}>
                <button
                  className="btn sm"
                  aria-expanded={fixing === i}
                  onClick={() => setFixing(fixing === i ? null : i)}
                >
                  {fixing === i ? 'Close' : r.hit ? 'Change' : 'Find a match'}
                </button>
                {!r.hit && r.line.confidence !== 'negligible' && (
                  <span className="tiny muted">or leave it out</span>
                )}
                {r.line.confidence === 'negligible' && (
                  <span className="tiny muted">seasoning — add it only if you want to</span>
                )}
              </div>

              {fixing === i && (
                <MatchPicker
                  initial={r.line.query}
                  onPick={(c) => {
                    setRows(
                      rows.map((x, j) => {
                        if (i !== j) return x
                        // Keep a weight already worked out; otherwise take the
                        // new food's own serving, or fall back to 100 g.
                        const grams =
                          x.grams > 0
                            ? x.grams
                            : x.line.count != null && c.portions[0]
                              ? Math.round(x.line.count * c.portions[0].grams)
                              : 100
                        return { ...x, hit: c, grams, include: true }
                      }),
                    )
                    setFixing(null)
                  }}
                />
              )}
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
/** Your own foods first — a meal prep is built from things you buy. */
function useCandidates(query: string, limit = 20): { hits: Candidate[]; searched: string | null } {
  const [hits, setHits] = useState<Candidate[]>([])
  const [searched, setSearched] = useState<string | null>(null)
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
        setSearched(null)
        return
      }
      const mine = await searchLocal(q, 8)
      const bundled = entries.current ? searchFoodDb(q, entries.current, limit) : []
      if (!alive) return
      const mineHits: Candidate[] = mine.map((f) => ({ ...f, foodId: f.id, mine: true }))
      const seen = new Set(mineHits.map((f) => f.name.toLowerCase()))
      setHits([
        ...mineHits,
        ...bundled.filter((b) => !seen.has(b.name.toLowerCase())).map((b) => ({ ...b, mine: false })),
      ])
      setSearched(q)
    })()
    return () => {
      alive = false
    }
  }, [query, limit])

  return { hits, searched }
}

/**
 * The words a recipe uses are not always the words a food database files
 * things under — "bell peppers" is "Peppers, sweet, red" in USDA, so the
 * exact phrase finds nothing. Dropping the qualifier finds the family.
 */
function loosen(query: string): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return null
  // The head noun is the last word in English; keep it and drop the rest.
  const head = words[words.length - 1]
  return head.length >= 3 ? head : words.slice(1).join(' ') || null
}

/**
 * Fixing a wrong or missing match without leaving the list. A pasted recipe
 * always has a few lines the parser cannot place — an odd pepper, a brand of
 * stock — and sending you back to the text to fix them one at a time is worse
 * than just showing the alternatives where the mistake is.
 */
function MatchPicker({ initial, onPick }: { initial: string; onPick: (c: Candidate) => void }) {
  const [query, setQuery] = useState(initial)
  const [loosened, setLoosened] = useState<string | null>(null)
  const { hits, searched } = useCandidates(query, 12)

  // If the phrase as written finds nothing, fall back once to the head noun
  // rather than presenting an empty box. Only for the query it opened with —
  // once you start typing, what you typed is what gets searched.
  useEffect(() => {
    if (loosened || searched !== query || hits.length > 0 || query !== initial) return
    const simpler = loosen(query)
    if (!simpler || simpler === query) return
    setLoosened(query)
    setQuery(simpler)
  }, [hits.length, searched, query, initial, loosened])

  return (
    <div className="stack tight" style={{ paddingLeft: 28 }}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for the right food"
        aria-label="Search for a match"
      />
      {loosened && (
        <div className="tiny muted">
          Nothing was filed under “{loosened}”, so this is “{query}”.
        </div>
      )}
      {query.trim().length >= 2 && searched === query && hits.length === 0 && (
        <div className="tiny muted">Nothing matches — try a shorter or plainer word.</div>
      )}
      {hits.slice(0, 6).map((h, i) => (
        <button key={i} className="item" onClick={() => onPick(h)}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="item-title truncate">
              {h.name}
              {h.mine && <span className="tiny" style={{ color: 'var(--success-text)' }}> · yours</span>}
            </div>
            <div className="tiny muted truncate">
              {h.brand ? `${h.brand} · ` : ''}
              {Math.round(h.kcal)} kcal / 100 g
              {h.portions[0] ? ` · ${h.portions[0].label} ${h.portions[0].grams} g` : ''}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

function IngredientPicker({
  onAdd,
  onClose,
}: {
  onAdd: (item: RecipeItem) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Candidate | null>(null)
  const [grams, setGrams] = useState('100')
  const { hits } = useCandidates(query)

  /** Start from the food's own measure, not a round number that suits nothing. */
  const choose = (c: Candidate) => {
    setChosen(c)
    setGrams(String(c.portions?.[0]?.grams ?? 100))
  }

  if (chosen) {
    const g = parseFloat(grams) || 0
    const macros = scale(chosen, g)
    // A spice's own measures are in the database — cumin is 2.1 g a teaspoon,
    // thyme 1 g. Defaulting to 100 g instead put 20 tablespoons of each in a
    // recipe, so the food's own portions lead and the default is the first of
    // them rather than a round number that suits nothing.
    const portions = chosen.portions ?? []
    return (
      <Sheet title={chosen.name} onClose={() => setChosen(null)}>
        {portions.length > 0 && (
          <div className="scroll-x">
            {portions.slice(0, 6).map((p, i) => (
              <button
                key={i}
                className="chip"
                aria-pressed={Math.abs(g - p.grams) < 0.01}
                onClick={() => setGrams(String(p.grams))}
              >
                {p.label} <span className="muted num">{p.grams} g</span>
              </button>
            ))}
          </div>
        )}
        <Field label="Raw weight (g)" hint="What goes into the pot, before cooking">
          <NumberInput
            autoFocus
            value={parseFloat(grams) || undefined}
            unit="g"
            onChange={(v) => setGrams(v === undefined ? '' : String(v))}
          />
        </Field>
        {g > 0 && portions[0] && g / portions[0].grams > 12 && (
          <div className="tiny" style={{ color: 'var(--critical)' }}>
            That is {Math.round(g / portions[0].grams)} × {portions[0].label} — worth a second look.
          </div>
        )}
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
              foodId: chosen.foodId,
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
              <button key={i} className="item" onClick={() => choose(h)}>
                <div className="grow">
                  <div className="item-title truncate">
                    {h.name}
                    {h.mine && (
                      <span className="tiny" style={{ color: 'var(--success-text)' }}> · yours</span>
                    )}
                  </div>
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
