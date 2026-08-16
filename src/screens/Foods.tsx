import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Food, type MealTemplate } from '../db/db'
import { Field, Icon, Sheet } from '../components/ui'

export default function Foods({ toast }: { toast: (m: string) => void }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Food | null>(null)

  const foods = useLiveQuery(() => db.foods.toArray(), []) ?? []
  const templates = useLiveQuery(() => db.mealTemplates.orderBy('lastUsed').reverse().toArray(), []) ?? []

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

      {templates.length > 0 && (
        <div className="card tight">
          <h3>Quick meals</h3>
          <div>
            {templates.map((t) => (
              <TemplateRow key={t.id} template={t} toast={toast} />
            ))}
          </div>
        </div>
      )}

      <div className="card tight">
        <div className="card-head">
          <h3>Foods</h3>
          <span className="tiny muted num">{foods.length}</span>
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            {foods.length === 0
              ? 'Your library fills up as you log. Anything you search or scan gets saved here.'
              : 'No matches'}
          </div>
        ) : (
          <div>
            {shown.map((f) => (
              <button key={f.id} className="item" onClick={() => setEditing(f)}>
                <div className="grow">
                  <div className="item-title truncate">{f.name}</div>
                  <div className="tiny muted truncate">
                    {f.brand ? `${f.brand} · ` : ''}
                    {Math.round(f.kcal)} kcal · P {f.protein} C {f.carbs} F {f.fat} / 100 g
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

      {editing && <EditFood food={editing} onClose={() => setEditing(null)} toast={toast} />}
    </div>
  )
}

function TemplateRow({ template, toast }: { template: MealTemplate; toast: (m: string) => void }) {
  return (
    <div className="item">
      <div className="grow">
        <div className="item-title truncate">{template.name}</div>
        <div className="tiny muted">
          {template.items.length} item{template.items.length === 1 ? '' : 's'} · used {template.useCount}×
        </div>
      </div>
      <button
        className="iconbtn"
        aria-label={`Delete ${template.name}`}
        onClick={async () => {
          await db.mealTemplates.delete(template.id!)
          toast('Quick meal deleted')
        }}
      >
        <Icon.trash />
      </button>
    </div>
  )
}

function EditFood({ food, onClose, toast }: { food: Food; onClose: () => void; toast: (m: string) => void }) {
  const [f, setF] = useState({
    name: food.name,
    brand: food.brand ?? '',
    kcal: String(food.kcal),
    protein: String(food.protein),
    carbs: String(food.carbs),
    fat: String(food.fat),
    fiber: String(food.fiber),
  })
  const [portions, setPortions] = useState(food.portions)
  const [favorite, setFavorite] = useState(food.favorite)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const n = (v: string) => Math.max(0, parseFloat(v) || 0)

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

      <div className="grid-2">
        <Field label="Calories / 100 g">
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
            <input
              style={{ width: 80 }}
              type="number"
              inputMode="decimal"
              value={p.grams}
              aria-label="Grams"
              onChange={(e) =>
                setPortions(portions.map((x, j) => (i === j ? { ...x, grams: parseFloat(e.target.value) || 0 } : x)))
              }
            />
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
            kcal: n(f.kcal),
            protein: n(f.protein),
            carbs: n(f.carbs),
            fat: n(f.fat),
            fiber: n(f.fiber),
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
