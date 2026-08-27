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

  const add = (row: Row, note: string) => {
    if ((data.foods ?? []).some((f) => f.name.toLowerCase() === String(row.name).toLowerCase())) return
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
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

  // Kirkwood garlic & herb chicken breast (Aldi), from the label: 4 oz (112 g)
  // = 110 kcal, 19 g protein, 4 g fat, 1 g carb, 490 mg sodium. Enhanced — up
  // to 15% marinade plus a 10% broth coating — so it carries about a quarter
  // less protein per gram than plain breast. Not a swap for the meal-prep
  // chicken, which is USDA plain raw.
  add(
    {
      name: 'Chicken breast, garlic & herb seasoned',
      brand: 'Kirkwood (Aldi)',
      kcal: 98,
      protein: 17,
      carbs: 0.9,
      fat: 3.6,
      portions: [{ label: '4 oz portion (112 g)', grams: 112 }],
    },
    'added Chicken breast, garlic & herb (Kirkwood) — per 100 g: 98 kcal, 17 P, 0.9 C, 3.6 F',
  )

  // Simply Nature organic quinoa (Aldi), dry, from the label: 1/4 cup (45 g) =
  // 170 kcal, 6 g protein, 29 g carb, 3 g fibre, 2.5 g fat. Within a few per
  // cent of USDA's uncooked figure, so the bag is honest.
  add(
    {
      name: 'Quinoa, dry',
      brand: 'Simply Nature (Aldi)',
      kcal: 378,
      protein: 13.3,
      carbs: 64.4,
      fat: 5.6,
      fiber: 6.7,
      portions: [{ label: '1/4 cup dry (45 g)', grams: 45 }],
    },
    'added Quinoa, dry (Simply Nature) — per 100 g: 378 kcal, 13.3 P, 64.4 C, 5.6 F, 6.7 fibre',
  )

  // And the cooked figure, USDA SR Legacy #168917, for weighing a portion out
  // of a finished pot rather than measuring the grain before it goes in.
  // Quinoa roughly triples in weight cooking, so the two are not
  // interchangeable — weigh at one stage or the other and pick the matching row.
  add(
    {
      name: 'Quinoa, cooked',
      kcal: 120,
      protein: 4.4,
      carbs: 21.3,
      fat: 1.92,
      fiber: 2.8,
      source: 'usda',
      sourceId: '168917',
    },
    'added Quinoa, cooked (USDA #168917) — per 100 g: 120 kcal, 4.4 P, 21.3 C, 1.9 F, 2.8 fibre',
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
