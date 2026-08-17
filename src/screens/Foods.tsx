import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Food, type MealTemplate, type Recipe } from '../db/db'
import { Field, Icon, NumberInput, Sheet } from '../components/ui'
import RecipeEditor from '../components/RecipeEditor'
import { CreateFood } from '../components/AddFood'
import { finishedWeight, per100, servingGrams } from '../lib/recipes'
import { loadFoodDb, searchFoodDb } from '../lib/foodDb'
import type { FoodHit } from '../lib/foodApi'
import { saveFood } from '../db/ops'

export default function Foods({ toast }: { toast: (m: string) => void }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Food | null>(null)
  const [creating, setCreating] = useState(false)
  const [template, setTemplate] = useState<MealTemplate | null>(null)
  const [recipe, setRecipe] = useState<Recipe | 'new' | null>(null)

  const foods = useLiveQuery(() => db.foods.toArray(), []) ?? []
  const templates = useLiveQuery(() => db.mealTemplates.orderBy('lastUsed').reverse().toArray(), []) ?? []
  const recipes = useLiveQuery(() => db.recipes.orderBy('lastUsed').reverse().toArray(), []) ?? []

  // Searching here used to look only at foods already logged, so on a fresh
  // install typing a food name returned "your library is empty" — technically
  // true and completely unhelpful. The built-in database answers too, and
  // anything picked from it joins the library.
  const entries = useRef<Awaited<ReturnType<typeof loadFoodDb>> | null>(null)
  const [dbReady, setDbReady] = useState(false)
  const [fromDb, setFromDb] = useState<FoodHit[]>([])

  useEffect(() => {
    let alive = true
    void loadFoodDb()
      .then((e) => {
        if (!alive) return
        entries.current = e
        setDbReady(true)
      })
      .catch(() => setDbReady(false))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!entries.current) return
    setFromDb(searchFoodDb(query, entries.current, 25))
  }, [query, dbReady])

  const q = query.trim().toLowerCase()
  const shown = foods
    .filter((f) => !q || f.name.toLowerCase().includes(q) || (f.brand ?? '').toLowerCase().includes(q))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.useCount - a.useCount || a.name.localeCompare(b.name))

  return (
    <div className="screen">
      <div style={{ position: 'relative' }}>
        <input
          type="search"
          placeholder="Search your library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
        <span style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>
          <Icon.search />
        </span>
      </div>

      <div className="card tight">
        <div className="card-head">
          <h3>Meal preps &amp; recipes</h3>
          <button className="btn sm" onClick={() => setRecipe('new')}>
            <Icon.plus /> New
          </button>
        </div>

        {recipes.length === 0 ? (
          <div className="empty">
            Cook once, log a portion. Add the ingredients, weigh the finished tray, and a serving
            becomes one entry.
          </div>
        ) : (
          <div>
            {recipes
              .filter((r) => !q || r.name.toLowerCase().includes(q))
              .map((r) => {
                const p = per100(r)
                const serving = servingGrams(r)
                return (
                  <button key={r.id} className="item" onClick={() => setRecipe(r)}>
                    <div className="grow">
                      <div className="item-title truncate">{r.name}</div>
                      <div className="tiny muted truncate num">
                        {r.items.length} ingredients · {Math.round(finishedWeight(r))} g made ·{' '}
                        {Math.round(p.kcal)} kcal/100 g
                        {serving ? ` · portion ${serving} g` : ''}
                      </div>
                    </div>
                    <span className="muted">
                      <Icon.edit />
                    </span>
                  </button>
                )
              })}
          </div>
        )}
      </div>

      {templates.length > 0 && (
        <div className="card tight">
          <h3>Quick meals</h3>
          <div>
            {templates.map((t) => (
              <TemplateRow key={t.id} template={t} onEdit={() => setTemplate(t)} />
            ))}
          </div>
        </div>
      )}

      <div className="card tight">
        <div className="card-head">
          <h3>Foods</h3>
          <span className="tiny muted num grow">{foods.length}</span>
          <button className="btn sm" onClick={() => setCreating(true)}>
            <Icon.plus /> New
          </button>
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            {foods.length === 0
              ? 'Your library fills up as you log. Anything you search or scan gets saved here.'
              : 'Nothing in your library matches — see the database below.'}
          </div>
        ) : (
          <div>
            {shown.map((f) => (
              <button key={f.id} className="item" onClick={() => setEditing(f)}>
                <div className="grow">
                  <div className="item-title truncate">{f.name}</div>
                  <div className="tiny muted truncate">
                    {f.brand ? `${f.brand} · ` : ''}
                    {macroLine(f)}
                    {f.useCount > 0 ? ` · used ${f.useCount}×` : ''}
                  </div>
                </div>
                {f.favorite && <span style={{ color: 'var(--series-4)' }}>★</span>}
                <span className="muted">
                  <Icon.edit />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {q.length >= 2 && fromDb.length > 0 && (
        <div className="card tight">
          <div className="card-head">
            <h3>Food database</h3>
            <span className="tiny muted">tap to add to your library</span>
          </div>
          <div>
            {fromDb.map((h, i) => (
              <button
                key={i}
                className="item"
                onClick={async () => {
                  const id = await saveFood(h)
                  const saved = await db.foods.get(id)
                  if (saved) setEditing(saved)
                }}
              >
                <div className="grow">
                  <div className="item-title truncate">{h.name}</div>
                  <div className="tiny muted truncate">
                    {h.brand ? `${h.brand} · ` : ''}
                    {macroLine(h)}
                  </div>
                </div>
                <span className="muted">
                  <Icon.plus />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {editing && <EditFood food={editing} onClose={() => setEditing(null)} toast={toast} />}

      {template && (
        <EditTemplate template={template} onClose={() => setTemplate(null)} toast={toast} />
      )}

      {creating && (
        <Sheet title="New food" onClose={() => setCreating(false)}>
          <CreateFood
            initialName={q}
            onCreated={(food) => {
              setCreating(false)
              toast(`${food.name} added`)
              setEditing(food)
            }}
          />
        </Sheet>
      )}

      {recipe && (
        <RecipeEditor
          recipe={recipe === 'new' ? undefined : recipe}
          onClose={() => setRecipe(null)}
          toast={toast}
        />
      )}
    </div>
  )
}

/**
 * A food's own serving is the number worth showing — it is what the packet
 * says and what a portion is logged in. Per 100 g stays as the comparable
 * figure beside it.
 */
function macroLine(f: {
  kcal: number
  protein: number
  carbs: number
  fat: number
  portions: { label: string; grams: number }[]
  defaultPortion?: number
}): string {
  const p = f.portions[f.defaultPortion ?? 0] ?? f.portions[0]
  const at = (g: number) => (v: number) => Math.round((v * g) / 100 * 10) / 10
  if (p && p.grams > 0) {
    const r = at(p.grams)
    return `${Math.round((f.kcal * p.grams) / 100)} kcal · P ${r(f.protein)} C ${r(f.carbs)} F ${r(f.fat)} per ${p.label} · ${Math.round(f.kcal)} kcal/100 g`
  }
  return `${Math.round(f.kcal)} kcal · P ${f.protein} C ${f.carbs} F ${f.fat} / 100 g`
}

function TemplateRow({
  template,
  onEdit,
}: {
  template: MealTemplate
  onEdit: () => void
}) {
  return (
    <button className="item" onClick={onEdit}>
      <div className="grow">
        <div className="item-title truncate">{template.name}</div>
        <div className="tiny muted">
          {template.items.length} item{template.items.length === 1 ? '' : 's'} · used {template.useCount}×
        </div>
      </div>
      <span className="muted">
        <Icon.edit />
      </span>
    </button>
  )
}

/**
 * Editing a saved quick meal.
 *
 * A quick meal is a shortcut, and a shortcut with the wrong amounts in it is
 * worse than none — it puts a wrong number into the log faster. Renaming,
 * changing what is in it, and deleting are all the same job, so they are in
 * one place rather than a delete button and nothing else.
 */
function EditTemplate({
  template,
  onClose,
  toast,
}: {
  template: MealTemplate
  onClose: () => void
  toast: (m: string) => void
}) {
  const [name, setName] = useState(template.name)
  const [items, setItems] = useState(template.items)
  const foods = useLiveQuery(() => db.foods.toArray(), []) ?? []
  const byId = new Map(foods.map((f) => [f.id, f]))
  const kcal = items.reduce((t, i) => t + ((byId.get(i.foodId)?.kcal ?? 0) * i.grams) / 100, 0)

  return (
    <Sheet title="Quick meal" onClose={onClose}>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="card tight">
        <h3>What is in it</h3>
        {items.length === 0 && <div className="empty">Nothing left in it.</div>}
        {items.map((i, idx) => {
          const f = byId.get(i.foodId)
          return (
            <div className="row" key={idx} style={{ gap: 8, paddingBlock: 6 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="item-title truncate">{f?.name ?? 'Missing food'}</div>
                <div className="tiny muted num">
                  {Math.round(((f?.kcal ?? 0) * i.grams) / 100)} kcal
                </div>
              </div>
              <div style={{ width: 92, flex: 'none' }}>
                <NumberInput
                  value={i.grams || undefined}
                  unit="g"
                  onChange={(v) =>
                    setItems(items.map((x, j) => (j === idx ? { ...x, grams: v ?? 0 } : x)))
                  }
                />
              </div>
              <button
                className="iconbtn"
                aria-label={`Remove ${f?.name ?? 'item'}`}
                onClick={() => setItems(items.filter((_, j) => j !== idx))}
              >
                <Icon.close />
              </button>
            </div>
          )
        })}
        <div className="row between" style={{ paddingTop: 8 }}>
          <span className="stat-label">Whole thing</span>
          <span className="stat-value num">{Math.round(kcal)} kcal</span>
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={!name.trim()}
        onClick={async () => {
          await db.mealTemplates.update(template.id!, { name: name.trim(), items })
          toast('Quick meal saved')
          onClose()
        }}
      >
        Save
      </button>
      <button
        className="btn danger block"
        onClick={async () => {
          await db.mealTemplates.delete(template.id!)
          toast('Quick meal deleted')
          onClose()
        }}
      >
        <Icon.trash /> Delete this quick meal
      </button>
    </Sheet>
  )
}

function EditFood({ food, onClose, toast }: { food: Food; onClose: () => void; toast: (m: string) => void }) {
  const [portions, setPortions] = useState(food.portions)
  const [favorite, setFavorite] = useState(food.favorite)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /**
   * Nutrition is stored per 100 g so any portion can be scaled from it, but
   * that is rarely the number printed on the packet — chia is per 24 g, a
   * hash brown per patty. So the numbers can be read and edited on whichever
   * basis you have in front of you, and the conversion happens here rather
   * than in your head.
   */
  const [basis, setBasis] = useState(100)
  // A database serving is often not the one on your packet — "1 cup" of chia
  // helps nobody. So a serving can be typed in here and is kept with the food.
  const [customOpen, setCustomOpen] = useState(false)
  const [customG, setCustomG] = useState<number | undefined>(undefined)
  const [customLabel, setCustomLabel] = useState('')
  const bases = [{ label: '100 g', grams: 100 }, ...portions.filter((p) => p.grams > 0)]

  const show = (per100: number, g: number) => {
    const v = Math.round((per100 * g) / 100 * 100) / 100
    return String(v)
  }
  const [f, setF] = useState({
    name: food.name,
    brand: food.brand ?? '',
    kcal: String(food.kcal),
    protein: String(food.protein),
    carbs: String(food.carbs),
    fat: String(food.fat),
    fiber: String(food.fiber),
  })

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const n = (v: string) => Math.max(0, parseFloat(v) || 0)

  // Fields hold what is displayed, so switching basis rewrites them; saving
  // converts the other way. Values only ever round-trip through per-100 g once.
  const rebase = (to: number) => {
    const conv = (v: string) => show((n(v) * 100) / basis, to)
    setF({
      ...f,
      kcal: conv(f.kcal),
      protein: conv(f.protein),
      carbs: conv(f.carbs),
      fat: conv(f.fat),
      fiber: conv(f.fiber),
    })
    setBasis(to)
  }
  // Per 100 g, whatever basis is on screen.
  const per100 = (v: string) => Math.round((n(v) * 100) / basis * 100) / 100

  return (
    <Sheet
      title={food.name}
      onClose={onClose}
      action={
        <button
          className="iconbtn"
          aria-label="Favourite"
          aria-pressed={favorite}
          onClick={() => setFavorite(!favorite)}
        >
          <span style={{ color: favorite ? 'var(--series-4)' : 'var(--text-muted)', fontSize: 18 }}>★</span>
        </button>
      }
    >
      <Field label="Name">
        <input value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Brand">
        <input value={f.brand} onChange={set('brand')} />
      </Field>

      <div className="scroll-x">
        {bases.map((b) => (
          <button
            key={b.label}
            className="chip"
            aria-pressed={basis === b.grams && !customOpen}
            onClick={() => {
              setCustomOpen(false)
              rebase(b.grams)
            }}
          >
            per {b.label}
          </button>
        ))}
        <button
          className="chip"
          aria-pressed={customOpen}
          onClick={() => setCustomOpen(!customOpen)}
        >
          + Your serving
        </button>
      </div>

      {customOpen && (
        <div className="card tight">
          <div className="tiny muted">
            The weight of one serving as your packet states it. It is saved as a portion, so it
            becomes a button here and when logging.
          </div>
          <div className="row" style={{ gap: 6, paddingBlock: 6 }}>
            <input
              className="grow"
              value={customLabel}
              placeholder="1 serving, 1 patty…"
              onChange={(e) => setCustomLabel(e.target.value)}
              autoCapitalize="none"
            />
            <div style={{ width: 96, flex: 'none' }}>
              <NumberInput value={customG} unit="g" autoFocus placeholder="24" onChange={setCustomG} />
            </div>
          </div>
          <button
            className="btn block"
            disabled={!customG || customG <= 0}
            onClick={() => {
              if (!customG) return
              const label = customLabel.trim() || `1 serving (${customG} g)`
              const at = portions.findIndex((p) => p.grams === customG)
              if (at < 0) setPortions([...portions, { label, grams: customG }])
              rebase(customG)
              setCustomOpen(false)
              setCustomLabel('')
            }}
          >
            Show the numbers for {customG ?? '…'} g
          </button>
        </div>
      )}

      <div className="grid-2">
        <Field label="Calories">
          <input type="number" inputMode="decimal" value={f.kcal} onChange={set('kcal')} />
        </Field>
        <Field label="Protein (g)">
          <input type="number" inputMode="decimal" value={f.protein} onChange={set('protein')} />
        </Field>
        <Field label="Carbs (g)">
          <input type="number" inputMode="decimal" value={f.carbs} onChange={set('carbs')} />
        </Field>
        <Field label="Fat (g)">
          <input type="number" inputMode="decimal" value={f.fat} onChange={set('fat')} />
        </Field>
        <Field label="Fibre (g)">
          <input type="number" inputMode="decimal" value={f.fiber} onChange={set('fiber')} />
        </Field>
      </div>
      <div className="tiny muted">
        {basis === 100
          ? 'Showing the numbers for 100 g. Switch above to read or type them per serving instead.'
          : `Showing the numbers for ${basis} g — type them straight off the label.`}
      </div>

      <div className="card tight">
        <div className="card-head">
          <h3>Portions</h3>
          <button
            className="btn sm"
            onClick={() => setPortions([...portions, { label: '', grams: 100 }])}
          >
            <Icon.plus /> Add
          </button>
        </div>
        {portions.length === 0 && <div className="empty">Grams only</div>}
        {portions.map((p, i) => (
          <div className="row" key={i} style={{ gap: 6, paddingBlock: 4 }}>
            <input
              className="grow"
              value={p.label}
              placeholder="1 slice"
              onChange={(e) =>
                setPortions(portions.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))
              }
            />
            <div style={{ width: 96, flex: 'none' }}>
              <NumberInput
                value={p.grams || undefined}
                unit="g"
                onChange={(v) =>
                  setPortions(portions.map((x, j) => (i === j ? { ...x, grams: v ?? 0 } : x)))
                }
              />
            </div>
            <button
              className="iconbtn"
              aria-label="Remove portion"
              onClick={() => setPortions(portions.filter((_, j) => j !== i))}
            >
              <Icon.close />
            </button>
          </div>
        ))}
      </div>

      <button
        className="btn primary block"
        disabled={!f.name.trim()}
        onClick={async () => {
          const clean = portions.filter((p) => p.label.trim() && p.grams > 0)
          await db.foods.update(food.id!, {
            name: f.name.trim(),
            brand: f.brand.trim() || undefined,
            kcal: per100(f.kcal),
            protein: per100(f.protein),
            carbs: per100(f.carbs),
            fat: per100(f.fat),
            fiber: per100(f.fiber),
            portions: clean,
            defaultPortion: Math.min(food.defaultPortion, clean.length - 1),
            favorite,
          })
          toast('Saved')
          onClose()
        }}
      >
        Save
      </button>

      <div className="tiny muted">
        Editing a food does not change days already logged — past entries keep the numbers they were
        logged with.
      </div>

      {confirmDelete ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button
            className="btn danger grow"
            onClick={async () => {
              await db.foods.delete(food.id!)
              toast('Food deleted')
              onClose()
            }}
          >
            Delete for good
          </button>
        </div>
      ) : (
        <button className="btn danger block" onClick={() => setConfirmDelete(true)}>
          <Icon.trash /> Delete food
        </button>
      )}
    </Sheet>
  )
}
