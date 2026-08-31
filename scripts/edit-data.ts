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

  /**
   * Ahi (yellowfin) tuna steaks, Aldi, wild caught — stored cooked.
   *
   * Label is per 113 g raw steak: 130 kcal, 28 g protein, 1.5 g fat, so 115
   * kcal and 24.8 g of protein per 100 g raw. USDA's raw-and-cooked pair for
   * yellowfin implies a factor of 1.22, which is what is used here: a 113 g
   * steak comes off the pan near 93 g.
   *
   * Worth noticing on the label: 370 mg of sodium in a serving, where plain
   * tuna carries about a tenth of that. This has been treated, and the smoke
   * named in the ingredients is the tasteless kind used to hold the red
   * colour rather than anything you would taste. It eats as normal tuna; it
   * just lands saltier than the fish it came from.
   */
  const foods = data.foods ?? []
  const maxId = foods.reduce((m: number, f: Row) => Math.max(m, Number(f.id) || 0), 0)
  const dup = foods.find((f: Row) => /ahi tuna|yellowfin/i.test(f.name ?? ''))
  if (dup) {
    notes.push(`already present as "${dup.name}" — leaving it alone`)
  } else {
    foods.push(
      touch({
        id: maxId + 1,
        name: 'Ahi tuna steak, cooked',
        brand: 'Aldi',
        kcal: 140,
        protein: 30.2,
        carbs: 0,
        fat: 1.6,
        fiber: 0,
        portions: [
          { label: '1 steak, cooked (~93 g)', grams: 93 },
          { label: '100 g cooked', grams: 100 },
        ],
        defaultPortion: 0,
        liquid: false,
        weighedAs: 'cooked',
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
        notes:
          'Cooked values, converted from the raw label (130 kcal / 28 g protein per 113 g) with a ' +
          '1.22 factor; a steak finishes near 93 g. Leanest protein in your list at 140 kcal for ' +
          '30 g. Yellowfin sits in the FDA middle tier for mercury, so about one serving a week ' +
          'rather than a staple. Keep frozen, thaw in the fridge.',
      }),
    )
    notes.push(`added food #${maxId + 1} "Ahi tuna steak, cooked" — 140 kcal, 30.2 P per 100 g cooked; 1 steak ~93 g`)
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
