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
import { computeTargets, dayEnergy, rulesAsOf } from '../src/lib/metrics'

const SITE = process.env.SALUTT_URL ?? 'https://salutt.stipe.app'
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
   * Re-freeze every snapshot taken under the old rule.
   *
   * Until 2026-10-06 a day was frozen with everything known when it was first
   * opened, the next morning's weigh-in included. These rows are rebuilt from
   * data up to and including their own day, which is what the screen showed
   * that night. The 2026-09-06 to 09-11 rows were written by hand under the
   * rules he was following then, and are left alone.
   */
  const settings = data.settings[0] as any
  const today = new Date().toISOString().slice(0, 10)
  for (const row of (data.dayTargets ?? []).slice().sort((a: Row, b: Row) => a.date.localeCompare(b.date))) {
    if (row.date < '2026-09-12' || row.date >= today) continue
    const rules = rulesAsOf(settings, data.weighIns as any, data.entries as any, data.workouts as any, row.date)
    if (!rules) continue
    const price = (r: any) => {
      const eaten = data.entries.filter((e: Row) => e.date === row.date).reduce((a: number, e: Row) => a + e.kcal, 0)
      const act = data.workouts.filter((w: Row) => w.date === row.date).reduce((a: number, w: Row) => a + (w.kcal ?? 0), 0)
      const e = dayEnergy({ ...settings, goalPctPerWeek: undefined, goalKgPerWeek: r.goalKgPerWeek }, r.kg, eaten, act, r.maintenance,
        { mean: r.usualMean, trust: r.usualTrust, logged: r.usualLogged, days: r.usualDays }, r.meanIntake)
      const t = computeTargets({ ...settings, goalPctPerWeek: undefined, goalKgPerWeek: r.goalKgPerWeek }, r.kg,
        r.maintenance != null ? { kcal: r.maintenance, days: 28, windowDays: 29, loggedDays: 28, meanIntake: r.meanIntake ?? 0, trendChangeKg: 0, confidence: 'high' } as any : null, e)
      return Math.round(t.kcal - eaten)
    }
    const before = price(row)
    const after = price(rules)
    if (Math.abs(before - after) < 1 && Math.abs((row.maintenance ?? 0) - (rules.maintenance ?? 0)) < 1) continue
    notes.push(`${row.date}: left ${before >= 0 ? '+' : ''}${before} -> ${after >= 0 ? '+' : ''}${after}   (maint ${row.maintenance} -> ${rules.maintenance}, kg ${row.kg.toFixed(2)} -> ${rules.kg.toFixed(2)})`)
    Object.assign(row, rules)
    touch(row)
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
