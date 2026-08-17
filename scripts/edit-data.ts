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

  // Give the stored copy the same identities the app will derive on upgrade,
  // so the two sides recognise each other's rows instead of doubling them.
  let stamped = 0
  for (const [table, rows] of Object.entries(data)) {
    if (table === 'settings' || table === 'tombstones' || !Array.isArray(rows)) continue
    for (const row of rows) {
      if (!row.uid && row.id != null) {
        row.uid = legacyUid(table, row.id, row.createdAt)
        stamped++
      }
    }
  }
  if (stamped) notes.push(`gave ${stamped} rows their stable identity`)

  // The three stray "Session" rows logged by mistake. Deleted on the phone,
  // but the deletion never left it — the tombstone hook was writing into a
  // transaction that had no scope for it. Buried here so the merge agrees.
  const strays = (data.workouts ?? []).filter((w) => w.name === 'Session')
  if (strays.length) {
    data.workouts = (data.workouts ?? []).filter((w) => w.name !== 'Session')
    for (const w of strays) {
      ;(data.tombstones ??= []).push({ table: 'workouts', key: w.id, at: Date.now() })
    }
    notes.push(`removed ${strays.length} stray "Session" workouts and buried them`)
  }

  // The regular journeys, both directions each, because the ride home is its
  // own trip: a full backpack, a headwind, or simply being tired. Distances
  // from Google Maps. The times are a starting estimate at a commuting pace
  // and are replaced by the real one the first time each is logged.
  //
  // Ids well clear of 1 so they cannot land on a route created on the phone
  // before this arrives — the merge still matches rows by key.
  // Ascent from the route actually ridden, adding up the per-segment inclines
  // Google gives: Congress +1, Digby to S 10th +4, Columbia +7, and +29 coming
  // out of the roundabout onto State — 41 m to the CoRec over 4.99 km.
  //
  // The way home is not the same climb reversed. Home is 207 m and campus 189,
  // so the outbound net drop of 18 m has to be repaid: 59 m of climbing back,
  // against 41 going out. The campus routes are the same line stopping short,
  // so they carry the same valley climb over a shorter distance.
  const ROUTES = [
    { id: 101, name: 'Home → campus', km: 4.3, minutes: 20, climbM: 38 },
    { id: 102, name: 'Campus → home', km: 4.3, minutes: 20, climbM: 55 },
    { id: 103, name: 'Home → CoRec', km: 5.0, minutes: 20, climbM: 41 },
    { id: 104, name: 'CoRec → home', km: 5.0, minutes: 20, climbM: 59 },
  ]
  for (const r of ROUTES) {
    const have = (data.routes ?? []).find((x) => x.name === r.name)
    if (have) {
      // The real time, now that it is known: twenty minutes through the
      // lights, not the pace I guessed at.
      if (have.climbM !== r.climbM || have.km !== r.km) {
        have.climbM = r.climbM
        have.km = r.km
        touch(have)
        notes.push(`${r.name}: ${r.km} km, ${r.climbM} m of climbing`)
      }
      continue
    }
    ;(data.routes ??= []).push(
      touch({ ...r, useCount: 0, lastUsed: 0, createdAt: Date.now() }),
    )
    notes.push(`saved route ${r.name} — ${r.km} km`)
  }

  // The Aldi cheese tray, from the label. A mixed tray is a blend, so no
  // generic entry comes close: 375 kcal/100 g against cheddar's 408.
  if (!(data.foods ?? []).some((f) => /cheese tray/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Cheese tray, mixed',
        brand: 'Aldi',
        // 32 g serving: 120 kcal, 10 g fat, 1 g carb, 8 g protein.
        kcal: 375,
        protein: 25,
        carbs: 3.1,
        fat: 31.2,
        fiber: 0,
        portions: [{ label: '1 serving (32 g)', grams: 32 }, { label: 'half a serving', grams: 16 }],
        defaultPortion: 0,
        liquid: false,
        source: 'manual',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Cheese tray, mixed (Aldi) — 1 serving (32 g) = 120 kcal, 8 g protein')
  }

  // Avocado, with a portion that means the ones actually bought.
  //
  // The USDA entry's "fruit, without skin and seed" is 136 g, which is a
  // medium Hass from a 194 g whole fruit. His weigh 133 g whole — about 93 g
  // of flesh at the 30% USDA refuse for skin and stone — so logging "1 fruit"
  // would add 70 kcal that were never eaten. A portion is only useful if "1"
  // means one of yours.
  if (!(data.foods ?? []).some((f) => /avocado/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1
    ;(data.foods ??= []).push(
      touch({
        id: nextId,
        name: 'Avocado, small (Hass)',
        kcal: 167,
        protein: 1.96,
        carbs: 8.64,
        fat: 15.4,
        fiber: 6.8,
        portions: [
          { label: '1 avocado (133 g whole)', grams: 93 },
          { label: 'half', grams: 47 },
          { label: '1 medium (194 g whole)', grams: 136 },
        ],
        defaultPortion: 0,
        liquid: false,
        source: 'usda',
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
      }),
    )
    notes.push('added Avocado, small (Hass) — 1 avocado = 93 g = 155 kcal')
  }

  // The braise's density, from the scale rather than a category.
  //
  // 540 g Pyrex, 900 g with the food, so 360 g at roughly 70% of a 750 ml box
  // — an implied 0.69 g/ml. The "stew, chilli, curry" category had said 1.03
  // and would have put 541 g in the box, 219 kcal a lunch that was never
  // eaten. Deriving it from the ingredients gives 0.64, which is within 7% of
  // the weighing; this keeps the weighing, since it is the measurement.
  const braise = (data.recipes ?? []).find((r) => /braised/i.test(r.name))
  if (braise && braise.density !== 0.69) {
    braise.density = 0.69
    touch(braise)
    notes.push(`${braise.name}: density 1.03 -> 0.69, measured`)
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
