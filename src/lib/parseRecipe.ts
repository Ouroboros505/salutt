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
  'breast', 'breasts', 'handful', 'handfuls', 'cube', 'cubes', 'jar', 'jars',
  'packet', 'packets', 'pack', 'packs', 'bunch', 'bunches', 'sprig', 'sprigs',
  'stick', 'sticks', 'head', 'heads', 'stalk', 'stalks', 'sheet', 'sheets',
])

/** Lines that are structure, not food. */
const HEADINGS = new Set([
  'ingredients', 'ingredient', 'directions', 'method', 'instructions', 'steps',
  'preparation', 'notes', 'topping', 'toppings', 'sauce', 'for the sauce',
  'garnish', 'optional', 'serves', 'equipment',
])

/**
 * How a food was prepared, which is not part of what it is.
 *
 * "2 yellow onions, chopped" has to search for onions, not for "onions,
 * chopped" — the preparation is why the line fails to match otherwise.
 */
const PREPARATION = [
  'chopped', 'finely chopped', 'roughly chopped', 'diced', 'minced', 'sliced',
  'thinly sliced', 'drained', 'rinsed', 'drained & rinsed', 'drained and rinsed',
  'juiced', 'cubed', 'shredded', 'grated', 'peeled', 'trimmed', 'crushed',
  'melted', 'softened', 'beaten', 'divided', 'to taste', 'plus more',
  'room temperature', 'cut into chunks', 'in large chunks', 'in chunks',
  'halved', 'quartered', 'seeded', 'deseeded', 'stemmed', 'thawed', 'frozen',
  'fresh', 'optional', 'from jar', 'from a jar', 'or more', 'packed',
]

/**
 * Seasonings whose contribution to a day's intake is nil.
 *
 * The food database deliberately excludes zero-calorie entries, so these never
 * match anything — which looks like a failure rather than the non-event it is.
 * A teaspoon of salt is 0 kcal and a teaspoon of cumin is about 8; neither
 * belongs in a log. Flagged rather than silently dropped, so the list still
 * shows every line that was pasted.
 */
const NEGLIGIBLE = [
  'salt', 'pepper', 'black pepper', 'white pepper', 'cumin', 'thyme', 'oregano',
  'paprika', 'cinnamon', 'nutmeg', 'turmeric', 'chilli', 'chili', 'cayenne',
  'bay leaf', 'bay leaves', 'rosemary', 'basil', 'parsley', 'coriander',
  'cilantro', 'dill', 'sage', 'cardamom', 'clove', 'cloves', 'ginger powder',
  'garlic powder', 'onion powder', 'spice', 'spices', 'seasoning', 'herbs',
  'water', 'vinegar', 'baking powder', 'baking soda', 'stevia', 'sweetener',
]

/** Common names the database files under something else. */
const SYNONYMS: [RegExp, string][] = [
  [/\bcoriander leaves?/i, 'cilantro'],
  [/\bspring onion/i, 'scallion'],
  [/\bcourgette/i, 'zucchini'],
  [/\baubergine/i, 'eggplant'],
  [/\bmince\b/i, 'ground'],
  [/\bbu?[oy]{1,2}on|bouillon/i, 'bouillon'],
  [/\bstock cube/i, 'bouillon'],
]

export type Confidence = 'exact' | 'approx' | 'guess' | 'negligible'

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

/**
 * Pulls a per-unit size out of a bracket: "4 cans black beans (15 oz each)".
 *
 * Without this the brackets are discarded and four cans become four unknowns,
 * when the line actually says exactly how much is in each one.
 */
function bracketedSize(line: string): number | null {
  for (const inner of line.match(/\(([^)]*)\)/g) ?? []) {
    const m = /([\d.,/]+)\s*(g|gr|grams?|kg|oz|ounces?|lb|lbs|pounds?|ml|l|litres?|liters?)\b/i.exec(inner)
    if (!m) continue
    const qty = parseQuantity(m[1])
    if (qty === null) continue
    const unit = m[2].toLowerCase()
    const grams = MASS_UNITS[unit] ?? VOLUME_UNITS[unit]
    if (grams) return qty * grams
  }
  return null
}

function stripPreparation(text: string): string {
  let out = text
  // Anything after a comma that is only preparation is noise, as is a trailing
  // preparation word with no comma at all.
  for (const word of PREPARATION) {
    out = out.replace(new RegExp(`,?\\s*\\b${word}\\b`, 'gi'), '')
  }
  return out.replace(/[,&]+\s*$/, '').replace(/\s+/g, ' ').trim()
}

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
  const trimmed = raw.trim()
  if (HEADINGS.has(trimmed.toLowerCase().replace(/[:.]$/, ''))) return null

  const perUnit = bracketedSize(trimmed)
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
    // "pork butt/shoulder" is one cut written two ways; take the first.
    const food = stripPreparation(name.trim().replace(/^of\s+/i, '')).split('/')[0].trim()
    if (!food) return null

    // Whether the word after the number is a measure or part of the name
    // decides what the food is even called: in "2 bell peppers", "bell" is
    // not a unit. Work that out before deciding anything else, or the check
    // below sees "peppers" and writes the line off as a seasoning.
    const isMeasure = !!MASS_UNITS[unit] || !!VOLUME_UNITS[unit] || COUNT_WORDS.has(unit)
    let fullFood = isMeasure || !unit ? food : `${unit} ${food}`.trim()
    // Applied to the complete name: "bell" is only recognisable as part of
    // "bell pepper" once the two halves are back together.
    for (const [pattern, replacement] of SYNONYMS) fullFood = fullFood.replace(pattern, replacement)

    const bare = fullFood
      .toLowerCase()
      .replace(/\bground\b|\bdried\b|\bfresh\b|\bminced\b/g, '')
      .trim()
    if (NEGLIGIBLE.some((n) => bare === n || bare === `${n}s`)) {
      return {
        ...base,
        query: fullFood,
        grams: null,
        count: null,
        confidence: 'negligible',
        note: 'no calories worth logging',
      }
    }

    if (MASS_UNITS[unit]) {
      return { ...base, query: fullFood, grams: qty * MASS_UNITS[unit], confidence: 'exact' }
    }
    if (VOLUME_UNITS[unit]) {
      return {
        ...base,
        query: fullFood,
        grams: qty * VOLUME_UNITS[unit],
        confidence: 'approx',
        note: `${unit} converted at the density of water — check anything oily or powdery`,
      }
    }
    // A bracketed size makes a counted line exact: 4 cans of 15 oz is a weight.
    if (perUnit && (!unit || COUNT_WORDS.has(unit))) {
      return {
        ...base,
        query: fullFood,
        grams: qty * perUnit,
        confidence: 'exact',
        note: `${qty} × ${Math.round(perUnit)} g from the label`,
      }
    }

    if (!unit || COUNT_WORDS.has(unit)) {
      // "3 eggs" needs the food's own portion to become grams. The counting
      // word is kept aside rather than searched for: "slices" is how it is
      // measured, not part of what the food is called.
      return {
        ...base,
        query: fullFood,
        count: qty,
        countUnit: unit || undefined,
        confidence: 'approx',
        note: 'counted, not weighed',
      }
    }
    // The word after the number was part of the food name, not a unit.
    return { ...base, query: fullFood, count: qty, confidence: 'approx', note: 'counted, not weighed' }
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
