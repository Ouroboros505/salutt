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
   * Strawberries — flesh only, the way he weighs them.
   *
   * USDA's figures for raw strawberries are already per 100 g of edible fruit,
   * with the green caps counted as refuse at about 6%. So these numbers belong
   * to a hulled berry on the scale, which is what he asked for and what he
   * actually eats. Weighing a punnet with the tops still on would overstate a
   * portion by that 6% — trivial next to the day's logging error, and not
   * worth a second entry to chase. The clementine went the same way.
   *
   * Also worth having on the list for a reason that is not nutrition: his own
   * testing put strawberries firmly on the safe side. Fructose balanced with
   * glucose, almost no sorbitol — neither of the two things that set his
   * evenings off.
   */
  const foods = data.foods ?? []
  const maxId = foods.reduce((m: number, f: Row) => Math.max(m, Number(f.id) || 0), 0)
  const dup = foods.find((f: Row) => /strawberr/i.test(f.name ?? ''))
  if (dup) {
    notes.push(`already present as "${dup.name}" — leaving it alone`)
  } else {
    foods.push(
      touch({
        id: maxId + 1,
        name: 'Strawberries, fresh',
        kcal: 32,
        protein: 0.7,
        carbs: 7.7,
        fat: 0.3,
        fiber: 2.0,
        portions: [
          { label: '100 g', grams: 100 },
          { label: '1 medium berry (~11 g)', grams: 11 },
          { label: '1 cup, halved (~150 g)', grams: 150 },
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
          'Flesh only — weigh them with the green tops removed, which is what these USDA figures ' +
          'describe. With the caps left on you would be about 6% over, which is not worth a second ' +
          'entry. Low FODMAP and on your safe list: glucose-balanced fructose, negligible sorbitol.',
      }),
    )
    notes.push(`added food #${maxId + 1} "Strawberries, fresh" — 32 kcal, 2.0 g fibre per 100 g flesh`)
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
