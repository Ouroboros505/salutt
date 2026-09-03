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
   * Rescale every logged session to the net-of-resting formula.
   *
   * The code fix alone would have been worse than the bug for a fortnight.
   * The daily target compares today's activity against the average of the
   * last two weeks, so changing the formula without touching history would
   * have put new days on one basis and the average on another, and every
   * training day would have read as unusually light until the old sessions
   * aged out. A quiet two weeks of under-eating to correct a 24 g/week bias
   * is a bad trade.
   *
   * Each stored figure was met x kg x hours. The new one is (met - 1) x kg x
   * hours. Without re-deriving every exercise, the ratio of the two is what
   * the session's blended MET implies — so scale by (met - 1) / met using the
   * MET the session's own kcal and duration reveal.
   *
   * Rides carry their own kcal from the same gross formula and are rescaled
   * the same way.
   */
  const kg = 67.4 // his trend weight; the ratio barely moves with it
  let touched = 0
  let before = 0
  let after = 0

  for (const w of data.workouts ?? []) {
    const kcal = Number(w.kcal) || 0
    const min = Number(w.durationMin) || 0
    if (kcal <= 0 || min <= 0) continue
    // Back out the gross MET this session was priced at.
    const grossMet = (kcal * 200) / (3.5 * kg * min)
    if (!(grossMet > 1)) continue
    const scaled = Math.round(kcal * ((grossMet - 1) / grossMet))
    before += kcal
    after += scaled
    w.kcal = scaled
    touch(w)
    touched++
  }
  notes.push(`rescaled ${touched} sessions: ${before} -> ${after} kcal total (${(before - after)} removed)`)
  notes.push(`  average per session: ${(before / touched).toFixed(0)} -> ${(after / touched).toFixed(0)}`)

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
