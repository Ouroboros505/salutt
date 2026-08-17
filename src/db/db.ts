import Dexie, { type Table } from 'dexie'

/** Calendar day, 'YYYY-MM-DD', always local time. */
export type ISODate = string

export interface Portion {
  label: string
  grams: number
}

/**
 * A food definition. All macros are stored per 100 g (or per 100 ml for
 * liquids) so that any portion can be derived by a single multiplication.
 */
export interface Food {
  id?: number
  name: string
  brand?: string
  barcode?: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  /** Household portions, e.g. { label: '1 slice', grams: 28 }. */
  portions: Portion[]
  /** Default portion index used when logging, or -1 for "grams". */
  defaultPortion: number
  liquid: boolean
  source: 'manual' | 'off' | 'usda'
  sourceId?: string
  favorite: boolean
  useCount: number
  lastUsed: number
  createdAt: number
}

/**
 * The name of a section of the day, chosen by you.
 *
 * Not an enum: a fixed Breakfast/Lunch/Dinner/Snack forces days to fit a shape
 * they often do not. Skipped lunch, three separate snacks, a pre-workout meal —
 * all of that is normal, and the log should follow the day rather than the
 * other way round.
 */
export type Meal = string

/** Offered as suggestions when naming a new one. Nothing is mandatory. */
export const MEAL_SUGGESTIONS = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Pre-workout',
  'Post-workout',
  'Late night',
]

/**
 * One logged food. Macros are snapshotted at log time so that correcting a
 * Food record later never silently rewrites past days.
 */
export interface Entry {
  id?: number
  date: ISODate
  meal: Meal
  foodId?: number
  name: string
  brand?: string
  grams: number
  /** Human-readable amount as entered, e.g. "1 cup (240 g)". */
  amountLabel: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  createdAt: number
}

export interface WeighIn {
  id?: number
  /** Unique — one weigh-in per day, later ones overwrite. */
  date: ISODate
  kg: number
  /**
   * Raw bioelectrical impedance in ohms, straight from the scale. Stored
   * because it is the only real measurement behind every derived figure below —
   * keeping it means the composition can be recomputed if the algorithm or your
   * height ever changes.
   */
  impedance?: number
  bodyFatPct?: number
  fatFreeKg?: number
  muscleKg?: number
  boneKg?: number
  waterPct?: number
  proteinPct?: number
  visceralFat?: number
  subcutaneousFatPct?: number
  skeletalMusclePct?: number
  bmrKcal?: number
  source: 'manual' | 'scale'
  createdAt: number
}

export interface Measurement {
  id?: number
  date: ISODate
  waist?: number
  hips?: number
  chest?: number
  neck?: number
  arm?: number
  thigh?: number
  notes?: string
  createdAt: number
}

export interface SetEntry {
  exercise: string
  reps: number
  weightKg: number
}

export interface Workout {
  id?: number
  date: ISODate
  kind: 'strength' | 'cardio' | 'ride' | 'other'
  name: string
  durationMin?: number
  kcal?: number
  distanceKm?: number
  sets: SetEntry[]
  notes?: string
  createdAt: number
}

export interface RecipeItem {
  foodId?: number
  name: string
  brand?: string
  grams: number
  /** Snapshotted at the time the ingredient was added, like log entries. */
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
}

/**
 * Something you cook once and eat over several days.
 *
 * The whole point is `cookedG`: a tray of chilli made from 2.4 kg of
 * ingredients does not weigh 2.4 kg after an hour in the oven, because water
 * leaves. Scaling a 380 g portion off the raw total would overstate every
 * macro. So the finished dish gets weighed, and portions scale off that.
 */
export interface Recipe {
  id?: number
  name: string
  items: RecipeItem[]
  /** Weight of the finished dish. Zero means "use the raw total instead". */
  cookedG: number
  /** Optional: how many portions it was divided into. */
  servings?: number
  /**
   * How many containers the batch filled, and how big they are.
   *
   * Weighing a serving at the moment of eating is the awkward part — but you
   * already know how many boxes the batch filled, so grams per container falls
   * out of the cooked weight for free. After that a lunch can be logged as
   * "70% of a container" without a scale being involved at all.
   */
  containers?: number
  containerMl?: number
  /**
   * Grams per millilitre, when the box count is not known and the weight has
   * to be estimated from volume instead. Far less accurate — see DISH_TYPES.
   */
  density?: number
  /**
   * Percent of the raw weight lost to evaporation, when the finished dish was
   * not weighed. Only what leaves the pot counts: water the meat gives up
   * stays in the sauce, so a covered braise loses far less than the yield
   * tables for the meat alone suggest.
   */
  cookLossPct?: number
  notes?: string
  useCount: number
  lastUsed: number
  createdAt: number
}

/** A named group of foods logged together in one tap, e.g. "usual breakfast". */
export interface MealTemplate {
  id?: number
  name: string
  meal: Meal
  items: { foodId: number; grams: number }[]
  useCount: number
  lastUsed: number
  createdAt: number
}

export interface Settings {
  id: string
  sex: 'male' | 'female'
  birthDate?: ISODate
  heightCm: number
  /** Activity multiplier applied to BMR for the initial TDEE estimate. */
  activity: number
  /** Target rate of change, kg per week. Negative for a deficit. */
  goalKgPerWeek: number
  /** Manual calorie target; when unset, the adaptive target is used. */
  kcalTargetOverride?: number
  proteinGPerKg: number
  /**
   * How the protein target is expressed. Grams per kilo scales with your body,
   * which is what protein requirements actually track; percent of calories
   * scales with intake, which means it falls exactly when you cut deeper.
   */
  proteinMode?: 'gPerKg' | 'pctKcal'
  proteinPctKcal?: number
  fatPctKcal: number
  /** Half-life in days for the smoothed weight trend. */
  trendHalfLifeDays: number
  /** The lunch container you fill, in millilitres. */
  boxMl?: number
  /**
   * Units for weights lifted. Body weight stays metric because the scale is,
   * but American gym plates and machines are marked in pounds, and converting
   * in your head between sets is how a log stops being kept.
   */
  liftUnit?: 'kg' | 'lb'
  /** Athletic body type — shifts the scale's body-fat derivation. */
  athlete?: boolean
  usdaApiKey?: string
  lastBackup?: number
  /** Recovery code for encrypted sync. Derives both the id and the key. */
  syncSecret?: string
  lastSync?: number
  startWeightKg?: number
  goalWeightKg?: number
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  sex: 'male',
  heightCm: 175,
  activity: 1.375,
  goalKgPerWeek: -0.5,
  proteinGPerKg: 1.8,
  fatPctKcal: 0.28,
  trendHalfLifeDays: 10,
  boxMl: 750,
}

/**
 * A row deleted on one device, remembered so a merge does not resurrect it.
 * Without this, deleting something and syncing would simply copy it back from
 * whichever device had not heard yet.
 */
export interface Tombstone {
  id?: number
  table: string
  key: number | string
  at: number
}

/** Tables that sync, and are therefore stamped and merged row by row. */
export const SYNCED_TABLES = [
  'foods',
  'entries',
  'weighIns',
  'measurements',
  'workouts',
  'mealTemplates',
  'recipes',
] as const

class SaluttDB extends Dexie {
  foods!: Table<Food, number>
  entries!: Table<Entry, number>
  weighIns!: Table<WeighIn, number>
  measurements!: Table<Measurement, number>
  workouts!: Table<Workout, number>
  mealTemplates!: Table<MealTemplate, number>
  recipes!: Table<Recipe, number>
  settings!: Table<Settings, string>
  tombstones!: Table<Tombstone, number>

  constructor() {
    super('salutt')
    this.version(1).stores({
      foods: '++id, name, barcode, favorite, useCount, lastUsed',
      entries: '++id, date, [date+meal], foodId, createdAt',
      weighIns: '++id, &date',
      measurements: '++id, &date',
      workouts: '++id, date, kind',
      mealTemplates: '++id, name, meal, lastUsed',
      settings: 'id',
    })

    // Recipes arrived later; Dexie carries existing data across untouched.
    this.version(2).stores({
      recipes: '++id, name, lastUsed, useCount',
    })

    // Row-level merge needs two things the schema did not have: when each row
    // last changed, and a record of what was deleted.
    this.version(3)
      .stores({ tombstones: '++id, [table+key], at' })
      .upgrade(async (tx) => {
        // Existing rows predate stamping. Their creation time is the best
        // evidence available, and it keeps them older than anything edited
        // since, which is the ordering a merge wants.
        for (const name of SYNCED_TABLES) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              if (row.updatedAt == null) {
                row.updatedAt = (row.createdAt as number) ?? (row.lastUsed as number) ?? 0
              }
            })
        }
      })

    // Stamp every write, so no call site has to remember to. Dexie types the
    // three hooks as separate overloads, which a loop cannot satisfy.
    for (const name of SYNCED_TABLES) {
      const hooks = this.table(name).hook as unknown as (
        event: string,
        fn: (...args: never[]) => unknown,
      ) => void
      hooks('creating', ((_key: unknown, obj: Record<string, unknown>) => {
        if (obj.updatedAt == null) obj.updatedAt = Date.now()
      }) as never)
      hooks('updating', ((mods: Record<string, unknown>) =>
        'updatedAt' in mods ? undefined : { updatedAt: Date.now() }) as never)
      hooks('deleting', ((key: number) => {
        // Runs inside the transaction Dexie gives the hook, so the tombstone
        // lands with the deletion or not at all.
        void this.tombstones.put({ table: name, key, at: Date.now() })
      }) as never)
    }
  }
}

export const db = new SaluttDB()

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings')
  return s ?? DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await db.settings.put({ ...current, ...patch, id: 'settings' })
}

/**
 * Ask the browser to make storage persistent. Without this, IndexedDB is
 * "best effort" and can be evicted under storage pressure — unacceptable for
 * a log you are meant to keep for years. Installed PWAs are usually granted
 * this automatically.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
