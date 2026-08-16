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

/**
 * Words to fuzzy-match against, including adjacent pairs glued together.
 *
 * Without the pairs, "hashbrwn" cannot reach "Hash Brown Patties": it is one
 * letter from "hashbrown" but four from either word on its own. People type
 * compounds as one word regardless of how the database spells them.
 */
function indexWords(haystack: string): string[] {
  const parts = haystack.split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  const out = parts.slice()
  for (let i = 0; i < parts.length - 1; i++) out.push(parts[i] + parts[i + 1])
  return out
}

interface Payload {
  version: number
  foods: Row[]
}

interface Indexed {
  row: Row
  /** Lowercased "name brand", searched against once per query. */
  haystack: string
  /**
   * The same text with every space and symbol removed, so "hashbrown" finds
   * "Hash Brown Patties". People do not type the spaces a database happens to
   * use, and a search that returns nothing reads as "we do not have it".
   */
  compact: string
  /** Individual words, for the fuzzy pass that tolerates misspellings. */
  words: string[]
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
    cache = payload.foods.map((row) => {
      const haystack = `${row[0]} ${row[1]}`.toLowerCase()
      return {
        row,
        haystack,
        compact: haystack.replace(/[^a-z0-9]/g, ''),
        words: indexWords(haystack),
        head: row[0].toLowerCase(),
      }
    })
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
 * Forms of a word worth trying, so singular and plural both find the food.
 * "patty" has to match "Hash Brown Patties" — nobody types the plural the
 * database chose.
 */
function variants(term: string): string[] {
  const bare = term.replace(/[^a-z0-9]/g, '')
  if (bare.length < 3) return [bare]
  const out = new Set([bare, bare + 's', bare + 'es'])
  if (bare.endsWith('y')) out.add(bare.slice(0, -1) + 'ies')
  if (bare.endsWith('ies')) out.add(bare.slice(0, -3) + 'y')
  if (bare.endsWith('es')) out.add(bare.slice(0, -2))
  if (bare.endsWith('s')) out.add(bare.slice(0, -1))
  return [...out]
}

/**
 * Edit distance, abandoned as soon as it exceeds `max`.
 *
 * Only ever called with max 1 or 2, so the banded loop stays cheap — which
 * matters because the fallback pass runs over the whole database.
 */
function withinDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  if (a === b) return true

  let twoBack: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      // Transposition: "seeds" typed as "sedes" is one slip, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1)
      }
      row[j] = v
      best = Math.min(best, v)
    }
    // Nothing further can bring the whole row back under the limit.
    if (best > max) return false
    twoBack = prev
    prev = row
  }
  return prev[b.length] <= max
}

/** How much misspelling to forgive: longer words earn more slack. */
function slack(term: string): number {
  if (term.length >= 7) return 2
  if (term.length >= 4) return 1
  return 0
}

/**
 * Cheap rejection before the expensive comparison.
 *
 * Typos land in the middle of a word far more often than on its first letter,
 * and the edit distance already bounds the length difference — so checking
 * both first cuts most of the database out without running the DP at all.
 */
function worthComparing(term: string, word: string, max: number): boolean {
  if (Math.abs(term.length - word.length) > max) return false
  return term[0] === word[0] || term[1] === word[1]
}

function matchesLoosely(term: string, forms: string[], e: Indexed): boolean {
  if (e.haystack.includes(term)) return true
  return forms.some((v) => e.compact.includes(v))
}

/**
 * Ranked substring search. Every term must appear somewhere, which keeps
 * "chicken breast raw" from returning every chicken dish; position and word
 * boundaries then decide the order.
 *
 * When that finds almost nothing, a second pass forgives spelling. It runs
 * only as a fallback because it is far more expensive — and because an exact
 * match should never be outranked by a guess.
 */
export function searchFoodDb(query: string, entries: Indexed[], limit = 30): FoodHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const terms = q.split(/\s+/).filter(Boolean)

  const termForms = terms.map(variants)

  const scored: { e: Indexed; s: number }[] = []
  for (const e of entries) {
    let ok = true
    for (let i = 0; i < terms.length; i++) {
      if (matchesLoosely(terms[i], termForms[i], e)) continue
      ok = false
      break
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

  if (scored.length < 3) {
    const budgets = terms.map(slack)
    for (const e of entries) {
      if (scored.some((x) => x.e === e)) continue
      let ok = true
      let typos = 0
      for (let i = 0; i < terms.length; i++) {
        if (matchesLoosely(terms[i], termForms[i], e)) continue
        const max = budgets[i]
        const near =
          max > 0 &&
          e.words.some((w) => worthComparing(terms[i], w, max) && withinDistance(terms[i], w, max))
        if (!near) {
          ok = false
          break
        }
        typos++
      }
      // Ranked below every exact hit, and further down the more forgiving the
      // match had to be.
      if (ok) scored.push({ e, s: -100 - typos * 10 - e.row[0].length / 10 })
    }
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
