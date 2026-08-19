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

  // Chicken and pork pesto with roasted vegetables.
  //
  // The written recipe counts in pounds, pints and "2 zucchini", so every line
  // is converted to grams here; the conversions are named next to each one so
  // a wrong assumption is visible rather than buried in a total.
  //
  // Salt is left out on purpose. It is the only ingredient contributing no
  // energy at all, and there is no honest row for it in the database — the
  // nearest match by name is a margarine spread. Its sodium is real and goes
  // untracked either way.
  //
  // Cook loss is a guess at 25%: a sheet-pan roast is uncovered, the meat
  // gives up about a quarter of its weight and the vegetables a good deal
  // more. It is the largest error left in the dish and the scale can delete it
  // — weigh the tray when it comes out and put the number in.
  const OZ = 453.592
  const RECIPE = [
    // name in the database                                           grams  where the number came from
    ['Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw', 2.75 * OZ, [120, 22.5, 0, 2.62, 0]],
    ['Pork, fresh, loin, center loin (chops), boneless, separable lean and fat, raw', 1.5 * OZ, [201, 21.1, 0, 13.0, 0]],
    ['Pesto alla Genovese', 6 * 11.75, [446.8, 4.255, 6.383, 44.68, 1.064]], // 6 tbsp, jar is 47 g per 4 tbsp
    ['Squash, summer, zucchini, includes skin, raw', 2 * 196, [17, 1.21, 3.11, 0.32, 1.0]], // 2 medium
    ['Broccoli, raw', 340, [31, 2.57, 6.27, 0.34, 2.4]], // the bag says so
    ['Peppers, sweet, red, raw', 3 * 119, [26, 0.99, 6.03, 0.3, 2.1]], // 3 medium
    ['Mushrooms, white, raw', 227, [22, 3.09, 3.26, 0.34, 1.0]], // the pack says so
    ['Onions, raw', 110, [40, 1.1, 9.34, 0.1, 1.7]], // 1 medium
    ['Tomatoes, red, ripe, raw, year round average', 283, [18, 0.88, 3.89, 0.2, 1.2]], // 1 pint
    ['Lemon juice, raw', 90, [22, 0.35, 6.9, 0.24, 0.3]], // juice of 2, not the whole fruit
    ['Olive oil', 5 * 13.5, [900, 0, 0, 100, 0]], // 5 tbsp
    ['Spices, pepper, black', 2.3, [251, 10.4, 64.0, 3.26, 25.3]], // 1 tsp
    ['Spices, garlic powder', 4.2, [331, 16.6, 72.7, 0.73, 9.0]], // 1.5 tsp
    ['Cheese, parmesan, hard', 50, [392, 35.8, 3.22, 25.0, 0]],
  ] as [string, number, number[]][]

  if (!(data.recipes ?? []).some((r) => /pesto/i.test(r.name))) {
    const items = RECIPE.map(([name, grams, per100]) => {
      const g = Math.round(grams * 10) / 10
      const f = (i: number) => Math.round(((per100[i] * g) / 100) * 10) / 10
      return {
        name,
        grams: g,
        kcal: Math.round((per100[0] * g) / 100),
        protein: f(1),
        carbs: f(2),
        fat: f(3),
        fiber: f(4),
      }
    })
    const raw = items.reduce((t, i) => t + i.grams, 0)
    const nextId = Math.max(0, ...(data.recipes ?? []).map((r) => r.id ?? 0)) + 1
    ;(data.recipes ??= []).push(
      touch({
        id: nextId,
        name: 'Chicken and pork pesto with roasted veg',
        items,
        cookedG: 0, // weigh the tray and this stops being a guess
        cookLossPct: 25,
        servings: undefined,
        notes: '2 tsp salt not listed — no energy, and no honest row for it. Cook loss is estimated at 25%; weigh the finished tray to replace it.',
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    const kcal = items.reduce((t, i) => t + i.kcal, 0)
    notes.push(
      `added recipe "Chicken and pork pesto with roasted veg" — ${items.length} ingredients, ${Math.round(raw)} g raw, ${kcal} kcal`,
    )
  }

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
