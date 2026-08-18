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

  // Cherries, stored against the weight that can actually be measured.
  //
  // The stone cannot come out before eating, so the scale only ever sees the
  // whole fruit. Rather than ask for a weight nobody can produce, the per-100
  // figures are USDA's edible values scaled by 0.92 — the 8% it calls refuse
  // for sweet cherries. That ratio holds whatever a single cherry weighs, so
  // resizing the portion below does not disturb it.
  //
  // The first one weighed came in at 13.28 g and was a freak; several more put
  // the real figure at 8 g whole. One measurement is an anecdote.
  const cherry = (data.foods ?? []).find((f) => /cherr/i.test(f.name))
  const CHERRY_G = 8
  if (cherry && cherry.portions?.[0]?.grams !== CHERRY_G) {
    Object.assign(cherry, {
      name: 'Cherries, sweet (weighed with pits)',
      kcal: 57.96,
      protein: 0.975,
      carbs: 14.72,
      fat: 0.184,
      fiber: 1.932,
      portions: [
        { label: `1 cherry (${CHERRY_G} g, as weighed)`, grams: CHERRY_G },
        { label: 'a handful (10 cherries)', grams: CHERRY_G * 10 },
        { label: 'a bowl (200 g)', grams: 200 },
        { label: 'a big bowl (300 g)', grams: 300 },
      ],
      defaultPortion: 0,
    })
    touch(cherry)
    notes.push(`cherries: 1 cherry is now ${CHERRY_G} g as weighed, 8% refuse still handled behind the scenes`)
  }

  // The avocado was measured again: 110 g whole, not 133. At USDA's 30% refuse
  // for skin and stone that is 77 g of flesh rather than 93 — 27 kcal a fruit,
  // every time, which is the sort of error that hides inside a portion label
  // and never announces itself.
  const avo = (data.foods ?? []).find((f) => /avocado/i.test(f.name))
  if (avo && avo.portions?.[0]?.grams !== 77) {
    avo.portions = [
      { label: '1 avocado (110 g whole)', grams: 77 },
      { label: 'half', grams: 38.5 },
      { label: '1 medium (194 g whole)', grams: 136 },
    ]
    avo.defaultPortion = 0
    touch(avo)
    notes.push('avocado: 1 fruit is now 110 g whole -> 77 g of flesh (was 133 -> 93)')
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
