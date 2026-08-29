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

  // Sicilian extra virgin olive oil (Specially Selected, Aldi). Label is per
  // tablespoon: 15 ml = 120 kcal, 14 g fat, nothing else. Oil is lighter than
  // water at about 0.92 g/ml, so that tablespoon weighs ~13.8 g and the label
  // works out to the standard 884 kcal per 100 g of pure fat — stored that way
  // so a weighed amount is right, with the tablespoon kept as a portion for
  // when it is poured rather than weighed.
  //
  // The most calorie-dense thing in the kitchen by some distance, and the one
  // most often left out of a recipe. In a chimichurri it will be most of the
  // energy in the jar.
  if (!(data.foods ?? []).some((f) => /olive oil/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Olive oil, extra virgin',
        brand: 'Specially Selected (Aldi)',
        kcal: 884,
        protein: 0,
        carbs: 0,
        fat: 100,
        fiber: 0,
        portions: [
          { label: '1 tbsp (15 ml)', grams: 13.8 },
          { label: '1 tsp (5 ml)', grams: 4.6 },
        ],
        defaultPortion: -1,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Olive oil, extra virgin — per 100 g: 884 kcal, 100 g fat (1 tbsp = 122 kcal)')
  }

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
