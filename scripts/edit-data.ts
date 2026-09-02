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
   * Fusia shrimp and avocado roll, Aldi — as sold, since nobody cooks sushi.
   *
   * Label is per 5 pieces (109 g): 110 kcal, 6 g protein, 17 g carbs, 3 g fat,
   * 2 g fibre, 340 mg sodium. Three servings to a box, so fifteen pieces and
   * 327 g in total.
   *
   * Portions are by the piece because that is the unit he eats and the unit he
   * will decide in — a scale is not going near a sushi box.
   *
   * The note carries a warning the numbers do not: the roll contains avocado
   * and lists sorbitol among its ingredients, and sorbitol is one of his two
   * confirmed triggers, at a threshold as low as 75 g of avocado flesh. Five
   * pieces is a small dose and likely fine; the whole box is a different
   * question, and worth knowing before rather than after.
   */
  const foods = data.foods ?? []
  const maxId = foods.reduce((m: number, f: Row) => Math.max(m, Number(f.id) || 0), 0)
  const dup = foods.find((f: Row) => /sushi|avocado roll/i.test(f.name ?? ''))
  if (dup) {
    notes.push(`already present as "${dup.name}"`)
  } else {
    const per100 = (x: number) => Math.round((x / 109) * 100 * 100) / 100
    foods.push(
      touch({
        id: maxId + 1,
        name: 'Shrimp & avocado sushi roll',
        brand: 'Fusia (Aldi)',
        kcal: per100(110),
        protein: per100(6),
        carbs: per100(17),
        fat: per100(3),
        fiber: per100(2),
        portions: [
          { label: '5 pieces (109 g)', grams: 109 },
          { label: '1 piece', grams: 22 },
          { label: 'whole box, 15 pieces', grams: 327 },
        ],
        defaultPortion: 0,
        liquid: false,
        weighedAs: 'as-eaten',
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
        notes:
          'Per 5 pieces: 110 kcal, 6 g protein — only about a fifth of its energy is protein, so ' +
          'treat it as a carb rather than a protein source. The "shrimp salad" is shrimp plus ' +
          'Alaska pollock and starches. CONTAINS AVOCADO AND ADDED SORBITOL, both of which are ' +
          'your confirmed trigger: five pieces is a small dose, the whole box is not. Also 340 mg ' +
          'sodium per serving, so expect a little water on the scale next morning.',
      }),
    )
    notes.push(`added #${maxId + 1} "Shrimp & avocado sushi roll" — 5 pieces = 110 kcal, 6 g P`)
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
