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

  const r1 = (n: number) => Math.round(n * 10) / 10
  const item = (name: string, grams: number, per100: number[]) => ({
    name,
    grams,
    kcal: r1((per100[0] * grams) / 100),
    protein: r1((per100[1] * grams) / 100),
    carbs: r1((per100[2] * grams) / 100),
    fat: r1((per100[3] * grams) / 100),
    fiber: r1((per100[4] * grams) / 100),
  })

  const addRecipe = (row: Row, note: string) => {
    if ((data.recipes ?? []).some((x) => x.name.toLowerCase() === String(row.name).toLowerCase())) return
    const nextId = Math.max(0, ...(data.recipes ?? []).map((x) => x.id ?? 0)) + 1
    ;(data.recipes ??= []).push(
      touch({
        id: nextId,
        notes: '',
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now(),
        ...row,
      }),
    )
    notes.push(note)
  }

  // Everything below is weighed RAW, because that is how he weighed it. The
  // meats are therefore at their label values rather than the cooked rows in
  // his library — a braise loses no meat juice to the air, it goes into the
  // sauce and stays in the pot.
  //
  // cookedG is the one figure not measured: the pot was too big to weigh. Only
  // evaporation leaves a covered braise, so the loss is far smaller than a
  // roast's — 12% of 4,620 g in gives about 4,065 g out. Weighing the finished
  // pot, or just counting the containers it filled, would pin it exactly.
  addRecipe(
    {
      name: 'Lentils with beef and pork',
      cookedG: 4065,
      containerMl: 0,
      items: [
        item('Bacon-wrapped top sirloin, raw', 140, [218, 16.9, 2.1, 15.5, 0]),
        item('Petite sirloin steak, raw', 513, [169.6, 20.5, 0, 9.8, 0]),
        item('Beef skirt steak, raw', 663, [160.7, 21.4, 0, 8.9, 0]),
        item('Pork centre-cut loin filet, raw', 1180, [125, 19.6, 2.7, 3.6, 0]),
        item('Green lentils, dry', 190, [343, 25.7, 62.9, 1.1, 11.4]),
        item('Yellow onion (450 g whole, trimmed)', 405, [40, 1.1, 9.3, 0.1, 1.7]),
        item('Bell pepper (402 g whole, trimmed)', 330, [26, 1, 6, 0.3, 2.1]),
        item('Minced garlic in oil', 40, [100, 1, 20, 1, 0]),
        item('Diced tomatoes, tinned', 411, [21, 0.8, 4.1, 0, 0.8]),
        item('Vegetable broth', 720, [4, 0, 0.8, 0, 0]),
        item('Olive oil, for searing (2 tbsp)', 27.6, [884, 0, 0, 100, 0]),
      ],
    },
    'added recipe "Lentils with beef and pork" — 5,014 kcal in, 4,065 g out, 123 kcal & 13.8 g protein per 100 g',
  )

  // Blended, not cooked, so nothing evaporates and cookedG is simply the sum.
  // The lemon is counted as its juice: a 111 g fruit yields roughly 40 g.
  addRecipe(
    {
      name: 'Chimichurri',
      cookedG: 289,
      containerMl: 0,
      items: [
        item('Olive oil, extra virgin', 156, [884, 0, 0, 100, 0]),
        item('Red wine vinegar (4 tbsp)', 60, [19, 0, 0.3, 0, 0]),
        item('Fresh parsley', 30, [36, 3, 6.3, 0.8, 3.3]),
        item('Lemon juice (from a 111 g lemon)', 40, [22, 0.4, 6.9, 0.2, 0.3]),
        item('Red pepper flakes', 3, [318, 12, 57, 17, 27]),
      ],
    },
    'added recipe "Chimichurri" — 1,420 kcal over 289 g, 491 kcal per 100 g (a tbsp is 74)',
  )

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
