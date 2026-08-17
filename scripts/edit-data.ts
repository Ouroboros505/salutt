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

  // The three tubs of cut fruit, from USDA.
  //
  // All three are already in the bundled database, so this is not about the
  // numbers — it is about the portions. The stock rows offer wedges of melon
  // and slices off a whole pineapple, and none of that survives contact with
  // a tub of chunks. What is needed is bowls.
  //
  // Pineapple is worth keeping separate in the mind: at 50 kcal it is nearly
  // twice the other two, so in a mixed bowl it carries most of the energy.
  // The "traditional varieties" row is deliberately not the one copied here —
  // it reports zero fibre, which is a hole in the source rather than the
  // fruit.
  const FRUIT = [
    { name: 'Watermelon, cut', kcal: 30, protein: 0.61, carbs: 7.55, fat: 0.15, fiber: 0.4, cup: 152 },
    { name: 'Cantaloupe, cut', kcal: 34, protein: 0.82, carbs: 8.16, fat: 0.18, fiber: 0.8, cup: 160 },
    { name: 'Pineapple, cut', kcal: 50, protein: 0.54, carbs: 13.1, fat: 0.12, fiber: 1.4, cup: 165 },
  ]
  for (const fr of FRUIT) {
    if ((data.foods ?? []).some((f) => f.name === fr.name)) continue
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    const { cup, ...macros } = fr
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        ...macros,
        portions: [
          { label: `1 cup of chunks (${cup} g)`, grams: cup },
          { label: 'a small bowl (250 g)', grams: 250 },
          { label: 'a big bowl (400 g)', grams: 400 },
          { label: 'half a cup', grams: Math.round(cup / 2) },
        ],
        defaultPortion: 0,
        liquid: false,
        source: 'usda',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push(`added ${fr.name} — 1 cup (${cup} g) = ${Math.round((fr.kcal * cup) / 100)} kcal`)
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
