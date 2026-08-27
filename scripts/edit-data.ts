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

  // He never weighs raw chicken, so the raw row is only a way to undercount by
  // a quarter. Replace it with the boiled figure.
  //
  // Derived from the bag (4 oz / 112 g raw = 110 kcal, 19 g protein, 4 g fat,
  // 1 g carb) times the concentration cooking produces. USDA's own pair gives
  // that factor without having to guess: plain breast is 120 kcal and 22.5 g
  // protein raw against 165 and 31 roasted, which is 1.375 on energy, 1.378 on
  // protein and 1.36 on fat — the same number three ways, so about a quarter
  // of the weight is water leaving. Boiling loses a little less than roasting,
  // and this bird is enhanced, whose phosphates hold some of the injected
  // solution through cooking; the two pull opposite ways and roughly cancel.
  // 1.35 is the figure used.
  const i = (data.foods ?? []).findIndex((f) => /^chicken breast, garlic & herb seasoned$/i.test(f.name))
  if (i >= 0) {
    const [row] = data.foods.splice(i, 1)
    if (row.id != null) {
      const nextId = Math.max(0, ...(data.tombstones ?? []).map((t) => t.id ?? 0)) + 1
      ;(data.tombstones ??= []).push({ id: nextId, table: 'foods', key: row.id, at: Date.now() })
    }
    notes.push('deleted the raw Kirkwood chicken row')
  }

  if (!(data.foods ?? []).some((f) => /garlic & herb, boiled/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Chicken breast, garlic & herb, boiled',
        brand: 'Kirkwood (Aldi)',
        kcal: 132,
        protein: 23,
        carbs: 1.2,
        fat: 4.9,
        fiber: 0,
        portions: [],
        defaultPortion: -1,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Chicken breast, garlic & herb, BOILED — per 100 g: 132 kcal, 23 P, 1.2 C, 4.9 F')
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
