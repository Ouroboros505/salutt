import type { Portion } from '../db/db'
import type { FoodHit } from './foodApi'

/**
 * The bundled food database: USDA generic, prepared and restaurant foods, plus
 * Aldi private-label groceries from Open Food Facts.
 *
 * Deliberately *not* loaded into IndexedDB. Nineteen thousand rows there would
 * make every keystroke in the personal library scan the whole table; instead
 * this is fetched once, held in memory, and searched directly. IndexedDB stays
 * reserved for foods you have actually logged.
 *
 * The service worker precaches the file, so this works offline after first run,
 * and Open Food Facts being down (as its search API frequently is) no longer
 * means you cannot find a chicken breast.
 */

const DB_URL = '/food-db.json'

/** Compact wire format — array-of-arrays, about a third the size of objects. */
type Row = [
  name: string,
  brand: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber: number,
  portions: [string, number][],
  barcode: string,
  source: 0 | 1,
]

interface Payload {
  version: number
  foods: Row[]
}

interface Indexed {
  row: Row
  /** Lowercased "name brand", searched against once per query. */
  haystack: string
  /** Leading token of the name, which is what most searches match on. */
  head: string
}

let cache: Indexed[] | null = null
let inflight: Promise<Indexed[]> | null = null

export function isLoaded(): boolean {
  return cache !== null
}

export async function loadFoodDb(): Promise<Indexed[]> {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    const res = await fetch(DB_URL)
    if (!res.ok) throw new Error(`food database unavailable (${res.status})`)
    const payload = (await res.json()) as Payload
    cache = payload.foods.map((row) => ({
      row,
      haystack: `${row[0]} ${row[1]}`.toLowerCase(),
      head: row[0].toLowerCase(),
    }))
    return cache
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

function toHit(row: Row): FoodHit {
  const portions: Portion[] = row[7].map(([label, grams]) => ({ label, grams }))
  return {
    name: row[0],
    brand: row[1] || undefined,
    barcode: row[8] || undefined,
    kcal: row[2],
    protein: row[3],
    carbs: row[4],
    fat: row[5],
    fiber: row[6],
    portions,
    defaultPortion: portions.length ? 0 : -1,
    liquid: false,
    source: row[9] === 1 ? 'off' : 'usda',
    sourceId: row[8] || undefined,
  }
}

/**
 * Ranked substring search. Every term must appear somewhere, which keeps
 * "chicken breast raw" from returning every chicken dish; position and word
 * boundaries then decide the order.
 */
export function searchFoodDb(query: string, entries: Indexed[], limit = 30): FoodHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const terms = q.split(/\s+/).filter(Boolean)

  const scored: { e: Indexed; s: number }[] = []
  for (const e of entries) {
    let ok = true
    for (const t of terms) {
      if (!e.haystack.includes(t)) {
        ok = false
        break
      }
    }
    if (!ok) continue

    let score = 0
    if (e.head.startsWith(q)) score += 120
    else if (e.head.includes(q)) score += 60
    const first = e.head.indexOf(terms[0])
    if (first === 0) score += 40
    else if (first > 0 && e.head[first - 1] === ' ') score += 20
    // Prefer the plainest entry that matches: "Bananas, raw" over a 90-character
    // survey description of the same thing.
    score -= Math.min(40, e.row[0].length / 3)
    scored.push({ e, s: score })
  }

  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map((x) => toHit(x.e.row))
}

/** Convenience wrapper that loads on first use. */
export async function searchBundled(query: string, limit = 30): Promise<FoodHit[]> {
  const entries = await loadFoodDb()
  return searchFoodDb(query, entries, limit)
}

export async function foodDbSize(): Promise<number> {
  return (await loadFoodDb()).length
}
