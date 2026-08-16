/**
 * Turning a written recipe into weighed ingredients.
 *
 * Typing a meal prep in one by one is the slow part, and dictating it to
 * someone else does not scale past the first few. Pasting the list you already
 * have — from a note, a website, your own head — is faster than both, provided
 * every guess it makes is visible and correctable before anything is saved.
 *
 * Nothing here is trusted silently: each line reports how it was read and how
 * confident that reading is, so the review step can lead with the doubtful ones.
 */

/** Grams per unit, where a unit has an unambiguous weight. */
const MASS_UNITS: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  kilogram: 1000,
  kilograms: 1000,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
}

/**
 * Volume units, converted at the density of water.
 *
 * Deliberately approximate: a cup of oil and a cup of flour differ by a third.
 * Anything measured this way is marked low confidence so the review step can
 * flag it, and a matched food's own portion is preferred whenever one exists.
 */
const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  millilitre: 1,
  millilitres: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  tbsp: 15,
  tbs: 15,
  tablespoon: 15,
  tablespoons: 15,
  cup: 240,
  cups: 240,
}

/** Words that describe a piece rather than a measure: "3 eggs", "1 patty". */
const COUNT_WORDS = new Set([
  'x', 'piece', 'pieces', 'unit', 'units', 'whole', 'medium', 'large', 'small',
  'slice', 'slices', 'patty', 'patties', 'scoop', 'scoops', 'clove', 'cloves',
  'can', 'cans', 'tin', 'tins', 'bar', 'bars', 'egg', 'eggs', 'fillet', 'fillets',
  'breast', 'breasts', 'handful', 'handfuls',
])

export type Confidence = 'exact' | 'approx' | 'guess'

export interface ParsedLine {
  /** The original text, so a failed line can still be shown and fixed. */
  raw: string
  /** What to search the food database for. */
  query: string
  /** Grams, when it could be worked out from the text alone. */
  grams: number | null
  /** A count when no weight unit was given: "3 eggs" -> 3. */
  count: number | null
  /** The word that made it a count, kept so "3 slices" can find a slice. */
  countUnit?: string
  confidence: Confidence
  note?: string
}

/** "1 1/2" and "1/2" both appear in written recipes; so does "1,5". */
function parseQuantity(text: string): number | null {
  const t = text.trim().replace(',', '.')
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const fraction = /^(\d+)\/(\d+)$/.exec(t)
  if (fraction) return Number(fraction[1]) / Number(fraction[2])
  const plain = Number(t)
  return Number.isFinite(plain) ? plain : null
}

const FRACTION_CHARS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }

function normalise(line: string): string {
  let out = line.trim()
  // Strip bullets only. A leading number is almost always the quantity, so
  // treating it as a list marker would silently discard the amount.
  out = out.replace(/^[-*•]+\s*/, '')
  out = out.replace(/\s*\([^)]*\)\s*/g, ' ')
  for (const [char, value] of Object.entries(FRACTION_CHARS)) {
    out = out.replace(new RegExp(char, 'g'), ` ${value} `)
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Reads one line into a quantity and a food to look up.
 *
 * Handles "500 g chicken", "1kg rice", "2 tbsp olive oil", "3 eggs",
 * "chicken breast 500g" and bare "olive oil".
 */
export function parseLine(raw: string): ParsedLine | null {
  const line = normalise(raw)
  if (!line || line.length < 2) return null

  const base: ParsedLine = {
    raw: raw.trim(),
    query: line,
    grams: null,
    count: null,
    confidence: 'guess',
  }

  // A quantity is a decimal, a fraction, or a whole number and a fraction —
  // matched as one unit so "1 1/2 tsp" does not read as "1".
  const QTY = String.raw`\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+`

  // Trailing form: "chicken breast 500 g"
  const trailing = new RegExp(String.raw`^(.*?)[,\s]+(${QTY})\s*([a-z]+)?$`, 'i').exec(line)
  // Leading form: "500 g chicken breast" — much the more common.
  const leading = new RegExp(String.raw`^(${QTY})\s*([a-z]+)?\s+(.+)$`, 'i').exec(line)

  const consider = (qtyText: string, unitText: string | undefined, name: string): ParsedLine | null => {
    const qty = parseQuantity(qtyText)
    if (qty === null || qty <= 0) return null
    const unit = (unitText ?? '').toLowerCase()
    const food = name.trim().replace(/^of\s+/i, '')
    if (!food) return null

    if (MASS_UNITS[unit]) {
      return { ...base, query: food, grams: qty * MASS_UNITS[unit], confidence: 'exact' }
    }
    if (VOLUME_UNITS[unit]) {
      return {
        ...base,
        query: food,
        grams: qty * VOLUME_UNITS[unit],
        confidence: 'approx',
        note: `${unit} converted at the density of water — check anything oily or powdery`,
      }
    }
    if (!unit || COUNT_WORDS.has(unit)) {
      // "3 eggs" needs the food's own portion to become grams. The counting
      // word is kept aside rather than searched for: "slices" is how it is
      // measured, not part of what the food is called.
      return {
        ...base,
        query: food,
        count: qty,
        countUnit: unit || undefined,
        confidence: 'approx',
        note: 'counted, not weighed',
      }
    }
    // The word after the number was part of the food name, not a unit.
    return { ...base, query: `${unit} ${food}`.trim(), count: qty, confidence: 'approx', note: 'counted, not weighed' }
  }

  if (leading) {
    const parsed = consider(leading[1], leading[2], leading[3])
    if (parsed) return parsed
  }
  if (trailing) {
    const parsed = consider(trailing[2], trailing[3], trailing[1])
    if (parsed) return parsed
  }

  // No quantity at all: still worth looking the food up so a weight can be added.
  return { ...base, note: 'no quantity found' }
}

export function parseRecipeText(text: string): ParsedLine[] {
  return text
    .split(/[\n;]+/)
    .map(parseLine)
    .filter((l): l is ParsedLine => l !== null)
}
