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

  // Store cupboard staples, from their labels. These are ingredients rather
  // than meals — he cooks with them repeatedly and wants them on hand for
  // future recipes, so they live in the library even though a portion of any
  // of them is never eaten on its own.
  //
  // All values are as-sold: the lentils dry, the tomatoes and broth as they
  // come out of the tin and carton. A recipe built from them accounts for the
  // cooking; the row itself should not.
  const add = (row: Row, note: string) => {
    if ((data.foods ?? []).some((f) => f.name.toLowerCase() === String(row.name).toLowerCase())) return
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        portions: [],
        defaultPortion: -1,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
        ...row,
      }),
    )
    notes.push(note)
  }

  // 1/4 cup dry (35 g) = 120 kcal, 9 P, 22 C, 4 fibre, 0.4 fat. Bag is 13
  // servings, 455 g. Within 3% of USDA's dry lentil, so the label is honest.
  add(
    {
      name: 'Lentils, green, dry',
      brand: "Dakota's (Aldi)",
      kcal: 343,
      protein: 25.7,
      carbs: 62.9,
      fat: 1.1,
      fiber: 11.4,
      portions: [
        { label: '1/4 cup dry (35 g)', grams: 35 },
        { label: 'the whole bag (455 g)', grams: 455 },
      ],
    },
    'added Lentils, green, dry — per 100 g: 343 kcal, 25.7 P, 62.9 C, 11.4 fibre',
  )

  // 1/2 cup (121 g) = 25 kcal, 1 P, 5 C, 1 fibre. Tin is about 3.5 servings.
  add(
    {
      name: 'Tomatoes, diced, tinned',
      brand: 'Happy Harvest (Aldi)',
      kcal: 21,
      protein: 0.8,
      carbs: 4.1,
      fat: 0,
      fiber: 0.8,
      portions: [
        { label: '1/2 cup (121 g)', grams: 121 },
        { label: 'the whole tin (424 g)', grams: 424 },
      ],
    },
    'added Tomatoes, diced, tinned — per 100 g: 21 kcal, 0.8 P, 4.1 C, 0.8 fibre',
  )

  // 1 cup (240 ml) = 10 kcal, 2 C, 580 mg sodium. Carton is about 4 cups.
  add(
    {
      name: 'Vegetable broth',
      brand: 'Great Value organic',
      kcal: 4,
      protein: 0,
      carbs: 0.8,
      fat: 0,
      fiber: 0,
      liquid: true,
      portions: [
        { label: '1 cup (240 ml)', grams: 240 },
        { label: 'the whole carton (960 ml)', grams: 960 },
      ],
    },
    'added Vegetable broth — per 100 ml: 4 kcal, 0.8 C (mostly salt: 580 mg a cup)',
  )

  // 1 cube (3.5 g) = 5 kcal, under a gram of carbohydrate, ~900 mg sodium.
  add(
    {
      name: 'Chicken bouillon cube',
      brand: "Chef's Cupboard (Aldi)",
      kcal: 143,
      protein: 0,
      carbs: 14,
      fat: 0,
      fiber: 0,
      portions: [{ label: '1 cube (3.5 g)', grams: 3.5 }],
    },
    'added Chicken bouillon cube — 5 kcal a cube, ~900 mg sodium',
  )

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
