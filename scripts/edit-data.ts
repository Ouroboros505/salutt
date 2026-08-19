/**
 * Editing the log from the desktop, safely.
 *
 * Salutt merges row by row and orders by when a row last changed, so a write
 * made here has to say when it was made. A row pushed without a fresh stamp
 * ties with the copy already on the phone and loses silently — which is
 * exactly how the first pass at correcting a recipe vanished. `touch()` is
 * therefore not optional politeness: it is what makes the edit take.
 *
 * Everything not touched is left alone, and the phone keeps anything it has
 * edited more recently, so this can never overwrite a day of logging.
 *
 *   npm run edit -- --dry     print what would change
 *   npm run edit              apply it
 *
 * The edit itself lives in `change()` below — rewrite it per task.
 */
import { readFileSync } from 'node:fs'
import { fetchRemote, pushPayload, setApiBase } from '../src/lib/syncCrypto'

const SITE = process.env.SALUTT_URL ?? 'https://salutt.montejongas.com'
const DRY = process.argv.includes('--dry')

type Row = Record<string, any>
type Data = Record<string, Row[]>

function secret(): string {
  const text = readFileSync(new URL('../SECRETS.local.md', import.meta.url), 'utf8')
  const m = /```\n([a-z0-9-]+)\n```/.exec(text)
  if (!m) throw new Error('no recovery phrase in SECRETS.local.md')
  return m[1]
}

/**
 * The uid a row gets when it predates uids. Must match the app's derivation
 * exactly, or the same row on each side becomes two rows on the first merge.
 */
export function legacyUid(table: string, key: number | string, createdAt?: number): string {
  const seed = `${table}:${key}:${createdAt ?? 0}`
  const fnv = (start: number) => {
    let h = start
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return `L${fnv(0x811c9dc5)}${fnv(0x7ee3c821)}`
}

/** Marks a row as written now, so the merge prefers it over the older copy. */
export function touch<T extends Row>(row: T): T {
  row.updatedAt = Date.now()
  return row
}

const summarise = (data: Data) =>
  Object.entries(data)
    .filter(([, rows]) => Array.isArray(rows) && rows.length)
    .map(([t, rows]) => `${t}=${rows.length}`)
    .join(' ')

/**
 * The change to apply. Mutate `data` in place and call touch() on every row
 * altered; anything left alone stays as the phone has it.
 */
function change(data: Data): string[] {
  const notes: string[] = []

  // Simms Zero Sugar Original beef jerky — the leaner, no-carb sibling: more
  // protein (14 vs 10), no sugar, a touch more fat. Its own row.
  if (!(data.foods ?? []).some((f) => /zero sugar/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    const SRV = 28
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Beef jerky, Original Zero Sugar',
        brand: 'Simms',
        // 1 oz (28 g): 80 kcal, 2 g fat, 0 carb, 0 fibre, 14 g protein, 470 mg sodium.
        kcal: Math.round((80 / SRV) * 1000) / 10,
        protein: Math.round((14 / SRV) * 1000) / 10,
        carbs: 0,
        fat: Math.round((2 / SRV) * 1000) / 10,
        fiber: 0,
        portions: [
          { label: '1 oz serving (28 g)', grams: SRV },
          { label: 'half a serving', grams: 14 },
        ],
        defaultPortion: 0,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Beef jerky, Original Zero Sugar (Simms) — 1 oz = 80 kcal, 14 g protein')
  }

  // Simms Original beef jerky (Aldi), per its 1 oz serving. Named with the
  // flavour so it sits apart from the other Simms jerky in the library.
  if (!(data.foods ?? []).some((f) => /jerky, original/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    const SRV = 28
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Beef jerky, Original',
        brand: 'Simms',
        // 1 oz (28 g): 80 kcal, 1 g fat, 5 g carb (5 g sugar), 0 fibre, 10 g protein, 620 mg sodium.
        kcal: Math.round((80 / SRV) * 1000) / 10,
        protein: Math.round((10 / SRV) * 1000) / 10,
        carbs: Math.round((5 / SRV) * 1000) / 10,
        fat: Math.round((1 / SRV) * 1000) / 10,
        fiber: 0,
        portions: [
          { label: '1 oz serving (28 g)', grams: SRV },
          { label: 'half a serving', grams: 14 },
          { label: 'the whole bag (142 g)', grams: 142 },
        ],
        defaultPortion: 0,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Beef jerky, Original (Simms) — 1 oz = 80 kcal, 10 g protein')
  }

  // Northern Catch skipjack tuna, chunk light in water (Aldi), from the label.
  // The can is one serving — 110 kcal, 25 g protein, 1 g fat — so the per-100
  // figures are the can over its drained weight. That weight is the one guess:
  // a 5 oz light-tuna can drains to about 95 g, which also lands the per-100 on
  // USDA's light-tuna figure. Weigh a drained can and this becomes exact.
  if (!(data.foods ?? []).some((f) => /skipjack|tuna/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    const CAN = 95
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Skipjack tuna, chunk light in water',
        brand: 'Northern Catch, Aldi',
        kcal: Math.round((110 / CAN) * 1000) / 10,
        protein: Math.round((25 / CAN) * 1000) / 10,
        carbs: Math.round((1 / CAN) * 1000) / 10,
        fat: Math.round((1 / CAN) * 1000) / 10,
        fiber: 0,
        portions: [
          { label: '1 can, drained (95 g)', grams: CAN },
          { label: 'half a can', grams: Math.round(CAN / 2) },
        ],
        defaultPortion: 0,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Skipjack tuna, chunk light in water (Northern Catch, Aldi) — 1 can = 110 kcal, 25 g protein')
  }

  // Cook loss for the pesto tray, worked out per ingredient rather than
  // guessed once for the whole dish.
  //
  // Protein mass survives cooking, so USDA's raw and cooked rows for the same
  // cut give the yield directly: chicken breast goes 22.5 g protein per 100 g
  // raw to 32.1 roasted, so 100 g of raw becomes 70 g. Pork loin, 21.1 to
  // 26.7, becomes 79. Between them that is half the tray measured rather than
  // assumed. The vegetables use published roasting losses — boiled rows are no
  // use, since boiling adds water where roasting drives it off — and oil is
  // held at zero because oil does not evaporate.
  //
  //   3921 g raw -> 2775 g, a 29% loss, 160 kcal per 100 g
  //
  // Checked against five published sheet-pan pesto chicken recipes on protein
  // per 100 kcal, which is a ratio and so is blind to serving size: they run
  // 7.2 to 11.3, this one is 10.7. That confirms the grams assigned to "2
  // zucchini" and "1 pint tomatoes" — and cannot confirm the yield, because a
  // ratio cannot see weight. Only the tray can settle that.
  const tray = (data.recipes ?? []).find((r) => /pesto/i.test(r.name))
  if (tray && tray.cookLossPct !== 29) {
    tray.cookLossPct = 29
    tray.notes =
      '2 tsp salt not listed — no energy, and no honest row for it. Cook loss 29%, worked out per ingredient from USDA raw-vs-cooked protein; weigh the finished tray to replace it with a measurement.'
    touch(tray)
    notes.push('pesto tray: cook loss 25% -> 29%, from each ingredient rather than one guess')
  }

  // Repair the "Lunch" planned meal saved with two empty items.
  //
  // The couscous and the pesto came out at 0 kcal — added on a stale build,
  // then frozen there because the old rescale multiplied a zero. Recompute
  // every item from its own definition at the grams he chose, and stamp the
  // per-100 basis so a weight change can never zero it again.
  const per100Of = (rec) => {
    const raw = rec.items.reduce(
      (t, i) => ({
        g: t.g + i.grams,
        kcal: t.kcal + i.kcal,
        protein: t.protein + i.protein,
        carbs: t.carbs + i.carbs,
        fat: t.fat + i.fat,
        fiber: t.fiber + i.fiber,
      }),
      { g: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    )
    const finished = rec.cookedG > 0 ? rec.cookedG : raw.g * (1 - (rec.cookLossPct ?? 0) / 100)
    const f = finished > 0 ? 100 / finished : 0
    return {
      kcal: raw.kcal * f,
      protein: raw.protein * f,
      carbs: raw.carbs * f,
      fat: raw.fat * f,
      fiber: raw.fiber * f,
    }
  }
  for (const pm of data.plannedMeals ?? []) {
    let touched = false
    for (const it of pm.items) {
      let basis = null
      if (it.foodId != null) {
        const food = (data.foods ?? []).find((f) => f.id === it.foodId)
        if (food) basis = { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber }
      } else if (it.recipeId != null) {
        const rec = (data.recipes ?? []).find((r) => r.id === it.recipeId)
        if (rec) basis = per100Of(rec)
      }
      if (!basis) continue
      const before = it.kcal
      const fac = (it.grams ?? 0) / 100
      const round1 = (v) => Math.round(v * fac * 10) / 10
      it.kcal = Math.round(basis.kcal * fac)
      it.protein = round1(basis.protein)
      it.carbs = round1(basis.carbs)
      it.fat = round1(basis.fat)
      it.fiber = round1(basis.fiber)
      it.per100 = basis
      if (before !== it.kcal) touched = true
    }
    if (touched) {
      touch(pm)
      const tot = pm.items.reduce((t, i) => t + i.kcal, 0)
      notes.push(`repaired planned meal "${pm.meal}" — ${pm.items.length} items now total ${tot} kcal`)
    }
  }

  // Stamp the training block's start so the week-8 reminder has an anchor.
  // Monday of the week he started, 2026-08-17; eight weeks lands on 2026-10-05.
  const cfg = (data.settings ?? []).find((x) => x.id === 'settings')
  if (cfg && (cfg.programStartDate !== '2026-08-17' || cfg.programWeeks !== 8)) {
    cfg.programStartDate = '2026-08-17'
    cfg.programWeeks = 8
    touch(cfg)
    notes.push('training block: starts 2026-08-17, reminder at week 8 (2026-10-05)')
  }

  // --- WAITING ON REAL WEIGHTS ---------------------------------------------
  //
  // He weighs every ingredient on the next meal prep, both recipes. When those
  // numbers arrive, fill them in here and the estimates below go away:
  //
  //   * the pesto tray's "2 zucchini = 392 g", "3 bell peppers = 357 g",
  //     "1 onion = 110 g", "1 pint tomatoes = 283 g" — all invented from
  //     typical sizes and the only reason the raw total is not exact.
  //   * the braise's ingredient weights, same story.
  //
  // What this will NOT fix, and is worth being honest about: the finished
  // weight. Weighing what goes in tells you the numerator; the cook loss is
  // still modelled (29% for the tray, 8% for the braise). Only weighing
  // something after it comes out settles that — and packing containers and
  // adding them up is the version that fits in a 5 kg scale.
  //
  // const WEIGHED: Record<string, number> = { 'Squash, summer...': 0 }
  // for (const r of data.recipes ?? []) for (const i of r.items)
  //   if (WEIGHED[i.name]) { /* rescale i's macros by the new grams, touch(r) */ }

  // --- example, currently a no-op -------------------------------------------
  // const recipe = data.recipes?.find((r) => r.name.includes('Braised'))
  // if (recipe) {
  //   recipe.cookLossPct = 8
  //   touch(recipe)
  //   notes.push(`${recipe.name}: cooking loss set to 8%`)
  // }

  return notes
}

async function main() {
  setApiBase(SITE)
  const remote = await fetchRemote(secret())
  if (!remote) throw new Error('nothing stored on the server')
  const backup = remote.backup as { data: Data; counts: Record<string, number>; exportedAt: string }

  console.log(`before: ${summarise(backup.data)}`)
  const notes = change(backup.data)
  if (!notes.length) {
    console.log('nothing to change')
    return
  }
  notes.forEach((n) => console.log(`  ${n}`))

  const touched = Object.values(backup.data)
    .flat()
    .filter((r) => r && typeof r === 'object' && Date.now() - (r.updatedAt ?? 0) < 60_000).length
  console.log(`after : ${summarise(backup.data)}  (${touched} row(s) stamped)`)

  if (DRY) {
    console.log('\n--dry, nothing written')
    return
  }
  backup.exportedAt = new Date().toISOString()
  const res = await pushPayload(secret(), backup)
  console.log(`\npushed ${res.bytes} bytes; the phone will merge it on its next sync`)
}

void main()
