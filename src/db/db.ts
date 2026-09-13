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
  /**
   * Which weight these numbers describe.
   *
   * A label almost always prints raw figures, but what lands on the scale at
   * lunch is the cooked food, and meat loses a third of its weight in the pan.
   * Storing one without saying which is how a chicken breast quietly becomes
   * 30% wrong. So a food says what state it was weighed in:
   *
   *   'cooked'   — it must be cooked to be eaten, and these are the cooked
   *                numbers. The normal case for meat, grains and pulses.
   *   'as-eaten' — it is eaten exactly as bought, so the question does not
   *                arise: fruit, yoghurt, jerky, deli meat, nuts, oil.
   *   'raw'      — pre-cooking numbers for something that needs cooking. Only
   *                honest inside a recipe, which weighs its ingredients going
   *                into the pot; logging one of these on its own undercounts.
   *
   * Undefined means an older food from before the distinction was recorded.
   * Nothing warns about those — silence is better than crying wolf across a
   * whole existing log.
   */
  weighedAs?: 'cooked' | 'as-eaten' | 'raw'
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
  /**
   * Taken outside the usual conditions — after breakfast, with clothes on,
   * before the toilet, in the evening. Kept and shown, but left out of the
   * trend: the confound cannot be subtracted, only excluded. Day-to-day noise
   * is 300-1500 g against 57-140 g of real change, so one bad reading moves
   * the line further than a week of dieting does.
   */
  offProtocol?: boolean
  /**
   * Whether this reading was taken after a bowel movement.
   *
   * Not squeamishness: a loaded colon is 100-400 g, which is five days of
   * progress at this rate, and whether it is there varies day to day. Recorded
   * as a fact about the reading so the offset can be measured from the data
   * rather than guessed at, and then subtracted. `undefined` means it was not
   * recorded, which is most of the history and is left alone.
   */
  afterStool?: boolean
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

/**
 * Water, counted in bottles rather than measured.
 *
 * Everything else in this app is weighed to the gram, which is right for food
 * and wrong for this: nobody decants a drink to log it, and a tracker that
 * asks them to gets used for two days. So water is a tally — one tap is one
 * bottle of whatever size he actually carries — and the arithmetic happens
 * afterwards. An approximate number he will really keep beats an exact one he
 * will abandon.
 *
 * One row per day, incremented in place.
 */
/**
 * The rules a finished day was judged by, frozen once the day is over.
 *
 * Targets are computed, not stored: every screen rebuilds them from the
 * settings and the maintenance estimate as they stand *now*. That is right for
 * today and wrong for yesterday. Change the goal, and every past day is
 * rescored under a rule it was never following — a week of hitting the number
 * to within ten calories reads, the next morning, as a week of under-eating.
 *
 * What gets frozen is the **rules**, not the answer. Freezing the answer was
 * the first attempt and it was wrong in the other direction: a day's data can
 * still legitimately change after the day ends — food logged late, a
 * correction pushed from the desktop — and a stored number cannot follow it.
 * A plate added the evening after a snapshot was taken left the day reading
 * 175 over when it was 36.
 *
 * Holding the rules and recomputing the day from its own entries gets both:
 * the goal and the maintenance stay as they were, while the food and the
 * training stay current.
 */
export interface DayTarget {
  id?: number
  /** Unique — one snapshot per day. */
  date: ISODate
  /** Weekly goal in kg, already resolved from any percentage form. */
  goalKgPerWeek: number
  /** Maintenance as measured at the time, or null if it was not yet trusted. */
  maintenance: number | null
  /** The 14-day activity mean and coverage the residual was solved against. */
  usualMean: number
  usualTrust: number
  usualLogged: number
  usualDays: number
  meanIntake: number | null
  /** Trend weight on the day, so the goal and the resting figure hold still. */
  kg: number
  createdAt: number
  updatedAt?: number
}

export interface Water {
  id?: number
  date: ISODate
  /** Bottles drunk. Multiplied by the settings bottle size for the total. */
  bottles: number
  createdAt: number
  updatedAt?: number
  deletedAt?: number
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
  /** Band level (index into BAND_LEVELS) for a band exercise. */
  band?: number
  /** Work and rest of one interval round, when the set is a round. */
  hardSec?: number
  easySec?: number
  /**
   * Minutes, for an exercise counted that way rather than in sets.
   *
   * Such an exercise has no sets at all, so without a row of its own it left
   * no trace in a saved session — and reopening one to fix a typo quietly
   * deleted every cardio entry in it, along with its time and its energy.
   */
  minutes?: number
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
  /**
   * Copied from the source food so the editor can flag a cooked-basis
   * ingredient sitting in a list that is filled in at raw weight.
   */
  weighedAs?: 'cooked' | 'as-eaten' | 'raw'
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
  /**
   * Where the density came from, so a weighing is not silently replaced by a
   * calculation about the same dish.
   */
  densityFrom?: 'ingredients' | 'category' | 'weighed'
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

/**
 * A meal weighed now and eaten later.
 *
 * Everything gets weighed in one go in the morning, but the day's remaining
 * energy is what decides what to eat next — so logging it all at breakfast
 * would make that figure wrong until dinner. Writing the grams on paper and
 * copying them in later is the alternative, and it is the app's job to hold
 * that, not a scrap of paper.
 *
 * Macros are snapshotted at weighing time, exactly as an entry snapshots them,
 * so correcting a food later never rewrites what is already in the box.
 */
export interface PlannedItem {
  foodId?: number
  recipeId?: number
  name: string
  brand?: string
  grams: number
  amountLabel: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  /**
   * Macros per 100 g, kept so a weight change rescales from a fixed basis
   * rather than from the current snapshot. Multiplying the snapshot works
   * until the snapshot is zero, at which point no factor can bring it back —
   * which is exactly how two items once saved empty. Optional because rows
   * written before this fall back to the snapshot.
   */
  per100?: { kcal: number; protein: number; carbs: number; fat: number; fiber: number }
}

export interface PlannedMeal {
  id?: number
  /** The day it was weighed for; it disappears from the list after that. */
  date: ISODate
  /** What it will be logged as when it is eaten. */
  meal: Meal
  items: PlannedItem[]
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
  /**
   * The same goal as a share of bodyweight per week, which is the form the
   * evidence is actually written in.
   *
   * A fixed kg/week quietly gets more aggressive as you shrink: 0.6 is 0.90%
   * of 66 kg and 1.00% of 60 kg, so a rate chosen as safe at the start drifts
   * to the ceiling by the finish. Expressed as a share it tapers on its own
   * and needs no remembering. Set, it replaces `goalKgPerWeek`; unset, the
   * fixed figure is used as before.
   */
  goalPctPerWeek?: number
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
  /**
   * Fibre, in grams a day. Left empty it follows intake at the guideline's own
   * 14 g per 1000 kcal, which is how the figure was written — the familiar
   * flat 38 g for men is that same rule applied to a 2700 kcal day.
   */
  fibreTargetG?: number
  /**
   * Where fibre stops being worth more of.
   *
   * No authority sets an upper limit; none has been shown to harm mineral
   * balance. What exists is a symptom threshold, and it is personal — most
   * people meet it somewhere past 40-50 g, sooner if the increase was quick or
   * the sources ferment hard. So it is a number you set, not one I assert.
   */
  fibreCeilingG?: number
  /**
   * How the box was filled in last time.
   *
   * Once a scale exists, weighing is the accurate route and estimating by
   * volume is the fallback — but which one is the fallback depends on whether
   * a scale is to hand, which changes week to week. So it follows what was
   * actually done rather than being decided here.
   */
  boxMode?: 'share' | 'weighed' | 'hand'
  /** Monday of week 1 of the current training block, for the change reminder. */
  programStartDate?: ISODate
  /** How many weeks to run a block before prompting a rethink. */
  programWeeks?: number
  /**
   * Interval rounds as he actually runs them, in seconds, keyed by exercise.
   * The plan's prescription is a starting suggestion; once it is changed, the
   * change is the default, because nobody wants to retype it every session.
   */
  intervals?: Record<string, { hard: number; easy: number }>
  /** Athletic body type — shifts the scale's body-fat derivation. */
  athlete?: boolean
  usdaApiKey?: string
  lastBackup?: number
  /** Recovery code for encrypted sync. Derives both the id and the key. */
  syncSecret?: string
  lastSync?: number
  startWeightKg?: number
  goalWeightKg?: number
  /** Size of the bottle he refills, in millilitres. One tap counts one of these. */
  bottleMl?: number
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

/**
 * A journey ridden often enough to be worth a button.
 *
 * The distance is the thing worth keeping: it is looked up once, and from then
 * on every trip to campus has a real distance instead of an estimate of effort.
 */
export interface Route {
  id?: number
  name: string
  km: number
  /** How long it took last time, so the whole ride fills in from one tap. */
  minutes: number
  /**
   * Metres climbed on the way, which for a river-valley crossing is the
   * largest single term — and asymmetric, since the way back climbs what the
   * way out descended.
   */
  climbM?: number
  /**
   * Extra weight usually carried on this trip, in kilograms. A ride home from
   * the shops moves the shopping too, and every term except air resistance
   * scales with the mass being moved.
   */
  loadKg?: number
  /** The saved place this ride starts from, when planned from the map. */
  fromPlaceId?: number
  /** The saved place this ride goes to. */
  toPlaceId?: number
  /** Where the distance came from: typed by hand, or measured by Google Maps. */
  source?: 'manual' | 'google'
  /** Google's encoded overview polyline, kept so the line can be redrawn or
   *  re-measured for climb without spending another routing call. */
  polyline?: string
  useCount: number
  lastUsed: number
  createdAt: number
}

/**
 * A named address you travel to or from — home, the CoRec, the office.
 *
 * Kept so a route can be planned once from real coordinates and then reused by
 * name forever. The address is geocoded to a point the first time it is saved;
 * from then on the lat/lng is what routing uses, so a route to "Office" never
 * has to be looked up again.
 */
export interface Place {
  id?: number
  /** What you call it: "House", "Campus", "CoRec", "Restaurant Nine". */
  name: string
  /** The address as typed, kept so it can be re-geocoded or edited later. */
  address: string
  /** As Google returned it — the canonical form, for confidence it matched. */
  formatted?: string
  lat: number
  lng: number
  useCount: number
  lastUsed: number
  createdAt: number
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
  'routes',
  'places',
  'plannedMeals',
  'water',
  'dayTargets',
] as const

/** The synced tables as they stood at version 3, for that version's upgrade. */
const SYNCED_AT_V3 = [
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
  routes!: Table<Route, number>
  places!: Table<Place, number>
  plannedMeals!: Table<PlannedMeal, number>
  water!: Table<Water, number>
  dayTargets!: Table<DayTarget, number>
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
        for (const name of SYNCED_AT_V3) {
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

    // Routes arrived later; existing data is carried across untouched.
    this.version(4).stores({ routes: '++id, name, lastUsed' })

    // Meals weighed ahead of being eaten.
    this.version(5).stores({ plannedMeals: '++id, date, [date+meal]' })

    // Named addresses, so a route can be planned once and reused by name.
    this.version(6).stores({ places: '++id, name, lastUsed' })
    // A tally of bottles, one row a day. New table only — nothing existing is
    // touched, so the upgrade is a no-op for every other store.
    this.version(7).stores({ water: '++id, &date' })
    // One frozen target per past day. New table only.
    this.version(8).stores({ dayTargets: '++id, &date' })
    // The snapshot went from holding the answer to holding the rules. The old
    // rows cannot be converted — they never stored the maintenance figure —
    // so they are dropped and the days re-freeze from current rules, which is
    // what they would have said anyway for every day since the change.
    this.version(9)
      .stores({ dayTargets: '++id, &date' })
      .upgrade((tx) => tx.table('dayTargets').clear())

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
        /**
         * The hook runs inside the transaction that is doing the deleting, and
         * that transaction is scoped to the table being deleted from — writing
         * to `tombstones` from inside it throws, and the throw was swallowed.
         * So no tombstone was ever recorded, the deletion existed only on this
         * device, and the next sync dutifully restored the row from the server.
         *
         * Recorded after the transaction commits instead: it needs its own
         * scope, and a deletion that rolled back should leave no headstone.
         */
        const at = Date.now()
        const write = () => {
          void this.tombstones.put({ table: name, key, at }).catch(() => {})
        }
        const tx = Dexie.currentTransaction
        if (tx) tx.on('complete', write)
        else write()
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
