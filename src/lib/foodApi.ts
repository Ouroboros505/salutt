import type { Food, Portion } from '../db/db'

/** A search result from an external database, not yet saved locally. */
export type FoodHit = Omit<Food, 'id' | 'favorite' | 'useCount' | 'lastUsed' | 'createdAt'>

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// ---------------------------------------------------------------- Open Food Facts

const OFF = 'https://world.openfoodfacts.org'
const OFF_FIELDS =
  'code,product_name,product_name_en,brands,quantity,serving_size,serving_quantity,nutriments,nutrition_data_per'

interface OffProduct {
  code?: string
  product_name?: string
  product_name_en?: string
  brands?: string
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Record<string, unknown>
}

function offToFood(p: OffProduct): FoodHit | null {
  const name = (p.product_name_en || p.product_name || '').trim()
  const n = p.nutriments
  if (!name || !n) return null

  // OFF sometimes only carries kJ; convert rather than dropping the product.
  let kcal = num(n['energy-kcal_100g'])
  if (!kcal && n['energy_100g']) kcal = num(n['energy_100g']) / 4.184
  if (!kcal) return null

  const portions: Portion[] = []
  const sq = num(p.serving_quantity)
  if (sq > 0) portions.push({ label: p.serving_size?.trim() || '1 serving', grams: sq })

  return {
    name,
    brand: p.brands?.split(',')[0]?.trim() || undefined,
    barcode: p.code,
    kcal: Math.round(kcal * 10) / 10,
    protein: num(n['proteins_100g']),
    carbs: num(n['carbohydrates_100g']),
    fat: num(n['fat_100g']),
    fiber: num(n['fiber_100g']),
    portions,
    defaultPortion: portions.length ? 0 : -1,
    liquid: false,
    source: 'off',
    sourceId: p.code,
  }
}

export async function lookupBarcode(barcode: string): Promise<FoodHit | null> {
  const url = `${OFF}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as { status?: number; product?: OffProduct }
  if (json.status !== 1 || !json.product) return null
  return offToFood(json.product)
}

/**
 * Open Food Facts text search.
 *
 * Only `cgi/search.pl` is usable from a browser. The newer
 * search.openfoodfacts.org service returns better results but sends no
 * `Access-Control-Allow-Origin` header, so every request from a page is
 * blocked by CORS — it looks fine from curl and fails in the app. (The build
 * script for the bundled database does use it, from Python, where CORS does
 * not apply.)
 *
 * This endpoint is also intermittently 503 under load, which is exactly why
 * Salutt ships its own database: online search is a bonus here, not the
 * foundation.
 */
export async function searchOFF(query: string, signal?: AbortSignal): Promise<FoodHit[]> {
  const url =
    `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const json = (await res.json()) as { products?: OffProduct[] }
  return (json.products ?? []).map(offToFood).filter((f): f is FoodHit => f !== null)
}

// ---------------------------------------------------------------- USDA FoodData Central

/** Nutrient numbers in the FDC schema. */
const FDC = { kcal: '208', protein: '203', fat: '204', carbs: '205', fiber: '291' }

interface FdcNutrient {
  nutrientNumber?: string
  value?: number
}
interface FdcFood {
  fdcId: number
  description: string
  brandOwner?: string
  brandName?: string
  dataType?: string
  servingSize?: number
  servingSizeUnit?: string
  householdServingFullText?: string
  gtinUpc?: string
  foodNutrients?: FdcNutrient[]
}

function fdcToFood(f: FdcFood): FoodHit | null {
  const get = (code: string) => num(f.foodNutrients?.find((n) => n.nutrientNumber === code)?.value)
  const kcal = get(FDC.kcal)
  if (!kcal) return null

  const portions: Portion[] = []
  if (f.servingSize && (f.servingSizeUnit === 'g' || f.servingSizeUnit === 'ml')) {
    portions.push({ label: f.householdServingFullText || '1 serving', grams: f.servingSize })
  }

  return {
    name: f.description.replace(/\s+/g, ' ').trim(),
    brand: (f.brandName || f.brandOwner)?.trim() || undefined,
    barcode: f.gtinUpc,
    kcal: Math.round(kcal * 10) / 10,
    protein: get(FDC.protein),
    carbs: get(FDC.carbs),
    fat: get(FDC.fat),
    fiber: get(FDC.fiber),
    portions,
    defaultPortion: portions.length ? 0 : -1,
    liquid: f.servingSizeUnit === 'ml',
    source: 'usda',
    sourceId: String(f.fdcId),
  }
}

export async function searchUSDA(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FoodHit[]> {
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(query)}&pageSize=20` +
    `&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const json = (await res.json()) as { foods?: FdcFood[] }
  return (json.foods ?? []).map(fdcToFood).filter((f): f is FoodHit => f !== null)
}

/**
 * Searches whichever remote databases are configured. USDA is preferred for
 * generic/whole foods when a key is present; Open Food Facts covers packaged
 * products worldwide and needs no key.
 */
export async function searchRemote(
  query: string,
  usdaApiKey: string | undefined,
  signal?: AbortSignal,
): Promise<FoodHit[]> {
  const jobs: Promise<FoodHit[]>[] = [searchOFF(query, signal).catch(() => [])]
  if (usdaApiKey) jobs.push(searchUSDA(query, usdaApiKey, signal).catch(() => []))
  const results = await Promise.all(jobs)

  // USDA first: generic entries are usually what you want when both match.
  const merged = results.length > 1 ? [...results[1], ...results[0]] : results[0]

  const seen = new Set<string>()
  return merged.filter((f) => {
    const key = `${f.name.toLowerCase()}|${f.brand?.toLowerCase() ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
