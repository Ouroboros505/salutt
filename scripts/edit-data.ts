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
   * Backfilling `weighedAs` across the existing foods.
   *
   * The distinction only bites for things that must be cooked, where the pan
   * takes out a third of the weight. Everything eaten as it comes — fruit,
   * yoghurt, nuts, oil, jerky, deli meat, tinned fish — is 'as-eaten', and for
   * those the question never arises. Marking them so is not pedantry: it is
   * what stops a future warning firing on an apple.
   */
  const COOKED =
    /cooked|boiled|roasted|grilled|baked|steamed|strips, cooked|prepared/i
  const RAW = /,\s*raw$|,\s*dry$/i
  // Things that reach the plate exactly as they were bought.
  const AS_EATEN =
    /fruit|apple|banana|clementine|orange|berry|berries|blueberr|strawberr|melon|cantaloupe|watermelon|pineapple|kiwi|grape|cherr|avocado|yoghurt|yogurt|chobani|milk|cheese|cottage|whey|protein powder|nut|almond|cashew|peanut|chia|flax|seed|oil|vinegar|jerky|ham|salmon|tuna|deli|bouillon|broth|tomatoes, tinned|honey|chocolate|truffle|bar$|drink|sparkling|coffee|tea|egg|bread|tortilla|salt|pepper|spice|garlic|onion|lettuce|spinach|cucumber|carrot|celery/i

  /**
   * The handful the name cannot place. Decided by how Alex actually measures
   * them, not by whether heat was involved: a hash brown patty is counted
   * straight from the box against the packet's own figures, so the numbers
   * already match what he weighs.
   */
  const BY_HAND: Record<string, string> = {
    'Hash browns patties': 'as-eaten',
    'Oikos Pro, vanilla': 'as-eaten',
    'Creatine monohydrate': 'as-eaten',
    'Pesto alla Genovese': 'as-eaten',
    'Tomatoes, diced, tinned': 'as-eaten',
    // The last raw-basis meat, from before the convention. Correct inside the
    // lentil recipe, which weighs its meat going into the pot; logged on its
    // own it would undercount by everything the pan takes out.
    'Bacon-wrapped top sirloin': 'raw',
  }

  let cooked = 0
  let asEaten = 0
  let raw = 0
  const unsure: string[] = []

  for (const f of data.foods ?? []) {
    if (f.weighedAs) continue
    const n: string = f.name ?? ''
    let basis: string
    // Order matters, and the trap is fruit. USDA names its produce
    // "Clementines, raw" — meaning uncooked, not "needs cooking" — so a
    // name-suffix rule checked first would brand an apple a raw ingredient.
    // Anything explicitly cooked wins, then anything eaten as it comes, and
    // only what survives both is genuinely a pre-cooking figure.
    if (BY_HAND[n]) basis = BY_HAND[n]
    else if (COOKED.test(n)) basis = 'cooked'
    else if (AS_EATEN.test(n)) basis = 'as-eaten'
    else if (RAW.test(n)) basis = 'raw'
    else {
      // Not confidently placeable by name. Left undefined on purpose — an
      // unmarked food warns about nothing, which is the safe way to be wrong.
      unsure.push(n)
      continue
    }
    f.weighedAs = basis
    touch(f)
    if (basis === 'cooked') cooked++
    else if (basis === 'raw') raw++
    else asEaten++
  }

  notes.push(`marked ${cooked} cooked, ${asEaten} as-eaten, ${raw} raw`)
  for (const f of data.foods ?? [])
    if (f.weighedAs && f.weighedAs !== 'as-eaten') notes.push(`   ${f.weighedAs.toUpperCase().padEnd(7)} ${f.name}`)
  if (unsure.length) notes.push(`left unmarked (no warning either way): ${unsure.join(' | ')}`)

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
