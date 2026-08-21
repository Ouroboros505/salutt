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

  // The places behind the ride routes, geocoded once. House/CoRec/Office were
  // seeded earlier; Aldi is added here so the two Aldi routes link to a real
  // point too. Coordinates from Google's geocoder. Rename in the Places sheet.
  const PLACES = [
    { name: 'House',  address: '100 Main St, Lafayette, IN 47901',                                  formatted: '100 Main St, Lafayette, IN 47901, USA',       lat: 40.416700,  lng: -86.875300 },
    { name: 'CoRec',  address: 'France A. Cordova Recreational Sports Center, West Lafayette, IN',      formatted: '355 N Martin Jischke Dr, West Lafayette, IN 47906, USA', lat: 40.4282417, lng: -86.9223556 },
    { name: 'Office', address: 'Lilly Hall of Life Sciences, West Lafayette, IN',                       formatted: '915 Mitch Daniels Blvd, West Lafayette, IN 47907, USA',  lat: 40.423476,  lng: -86.9180072 },
    { name: 'Aldi',   address: 'Aldi, 957 Sagamore Pkwy S, Lafayette, IN 47905',                        formatted: '957 Sagamore Pkwy S, Lafayette, IN 47905, USA', lat: 40.406048,  lng: -86.856639 },
  ]
  for (const place of PLACES) {
    if ((data.places ?? []).some((p) => p.name.toLowerCase() === place.name.toLowerCase())) continue
    const nextId = Math.max(0, ...(data.places ?? []).map((p) => p.id ?? 0)) + 1
    ;(data.places ??= []).push(
      touch({ id: nextId, ...place, useCount: 0, lastUsed: Date.now(), createdAt: Date.now() }),
    )
    notes.push(`added place ${place.name} (${place.formatted})`)
  }

  // Replace the hand-entered distance and climb on the six existing routes with
  // Google's measured values, and link each to its two places. Minutes and any
  // carried load are left as they are: the minutes come from real rides and are
  // truer for this rider than a generic 15 km/h estimate.
  const nameToId = new Map<string, number>()
  for (const p of data.places ?? []) if (p.id != null) nameToId.set(p.name.toLowerCase(), p.id)
  const ROUTE_UPDATES = [
    { name: 'Home → campus', from: 'House',  to: 'Office', km: 4.18, climbM: 36 },
    { name: 'Campus → home', from: 'Office', to: 'House',  km: 4.15, climbM: 54 },
    { name: 'Home → CoRec',  from: 'House',  to: 'CoRec',  km: 4.93, climbM: 38 },
    { name: 'CoRec → home',  from: 'CoRec',  to: 'House',  km: 4.91, climbM: 57 },
    { name: 'Home → Aldi',   from: 'House',  to: 'Aldi',   km: 2.71, climbM: 8 },
    { name: 'Aldi → home',   from: 'Aldi',   to: 'House',  km: 2.66, climbM: 10 },
  ]
  for (const u of ROUTE_UPDATES) {
    const r = (data.routes ?? []).find((x) => x.name === u.name)
    if (!r) { notes.push(`route "${u.name}" not found — skipped`); continue }
    r.km = u.km
    r.climbM = u.climbM
    r.fromPlaceId = nameToId.get(u.from.toLowerCase())
    r.toPlaceId = nameToId.get(u.to.toLowerCase())
    r.source = 'google'
    touch(r)
    notes.push(`updated "${u.name}" -> ${u.km} km, climb ${u.climbM} m`)
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
