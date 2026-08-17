/**
 * The training plan, as something to log against rather than obey.
 *
 * A written programme survives contact with a busy gym about as well as any
 * plan survives contact with reality: the cable station is taken, the day is
 * short, something else looks more interesting. So the plan supplies the
 * defaults — what, how many, roughly how long — and every one of them is
 * editable at the moment of logging. What gets recorded is what happened.
 *
 * Each exercise carries what is needed to turn it into energy: a MET value
 * and the seconds a set really takes including the rest after it. That is what
 * wires training into the day's calorie figure, so a short session and a long
 * one do not cost the same.
 */

export type MuscleGroup =
  | 'Chest'
  | 'Back'
  | 'Shoulders'
  | 'Biceps'
  | 'Triceps'
  | 'Legs'
  | 'Core'
  | 'Cardio'
  | 'Mobility'

export interface Exercise {
  name: string
  group: MuscleGroup
  /** What the plan asks for; a starting point, not a rule. */
  sets: number
  reps: string
  /**
   * Metabolic equivalents. Resistance work sits near 5 at the moderate reps
   * and short rests this plan uses — higher than the 3.5 of traditional
   * heavy/long-rest lifting, well below steady cardio.
   */
  met: number
  /** Seconds a set occupies, work and the rest after it together. */
  secPerSet: number
  equipment?: string
  /** In the written plan, as opposed to added here as an alternative. */
  planned?: boolean
  /**
   * Counted in minutes rather than sets. Cardio is a duration, and how long
   * you were on the machine is the thing you actually know; asking for "sets"
   * of a stair climber would be a translation nobody should have to do.
   */
  byMinutes?: boolean
  /**
   * What to type in the weight box, and how it becomes load moved.
   *
   * The lifting convention is not uniform and pretending otherwise makes a
   * log incomparable with itself: a barbell is written as the whole thing,
   * bar included, while dumbbells are written as one of them even though two
   * are being held. Both conventions are kept, because they are what gyms and
   * training logs actually use — but the multiplier says how to turn the
   * number into total load, so the volume figures mean something.
   */
  load?: LoadStyle
}

export interface LoadStyle {
  /** What the number you type refers to. */
  label: string
  /** Multiply the typed weight by this for total load moved per rep. */
  factor: number
}

export const LOAD_BAR: LoadStyle = { label: 'the bar and plates together', factor: 1 }

/**
 * Bars weigh something, and forgetting that is the commonest way a lifting
 * log goes wrong: one 10 lb plate a side is 20 lb of plates and 65 lb on the
 * bar, so leaving the bar out records under a third of the real load — and
 * hides the progression, which is the reason for writing any of it down.
 */
export const BARS: { label: string; kg: number }[] = [
  { label: 'Olympic bar', kg: 20.41 }, // 45 lb, the usual one
  { label: 'Lighter bar', kg: 15.88 }, // 35 lb
  { label: 'EZ curl bar', kg: 11.34 }, // 25 lb
]

/** Total on the bar, from what is loaded on ONE side. */
export function barTotalKg(perSideKg: number, barKg: number): number {
  return barKg + perSideKg * 2
}
export const LOAD_EACH_HAND: LoadStyle = { label: 'one dumbbell', factor: 2 }
export const LOAD_ONE: LoadStyle = { label: 'the one dumbbell', factor: 1 }
export const LOAD_STACK: LoadStyle = { label: 'the number on the stack', factor: 1 }
export const LOAD_BODY: LoadStyle = { label: 'added weight only, if any', factor: 1 }

const E = (
  name: string,
  group: MuscleGroup,
  sets: number,
  reps: string,
  met: number,
  secPerSet: number,
  equipment?: string,
  planned = false,
): Exercise => ({ name, group, sets, reps, met, secPerSet, equipment, planned })

/**
 * Cardio, counted in minutes. The MET values are the Compendium of Physical
 * Activities figures for each modality — which is the whole reason the type
 * matters: twenty minutes of brisk walking and twenty of skipping differ by a
 * factor of three.
 */
const C = (name: string, met: number, minutes: number, equipment?: string, planned = false): Exercise => ({
  name, group: 'Cardio', sets: minutes, reps: 'min', met, secPerSet: 60, equipment, planned, byMinutes: true,
})

export const CATALOGUE: Exercise[] = [
  // ---------------------------------------------------------------- Chest
  E('Barbell Bench Press', 'Chest', 3, '12', 5, 105, 'Barbell, flat bench', true),
  E('Flat DB Bench Press', 'Chest', 3, '12', 5, 105, 'Dumbbells, flat bench', true),
  E('Incline Barbell Press', 'Chest', 3, '12', 5, 105, 'Barbell, incline bench'),
  E('Incline DB Press', 'Chest', 3, '12', 5, 105, 'Dumbbells, incline bench', true),
  E('Cable Fly', 'Chest', 3, '15', 4.5, 95, 'Cable crossover', true),
  E('Machine Chest Press', 'Chest', 3, '12', 5, 100, 'Chest press machine'),
  E('Push-Ups', 'Chest', 3, '15', 5, 80, 'Bodyweight'),
  E('Dips', 'Chest', 3, '10', 5.5, 100, 'Dip station'),

  // ----------------------------------------------------------------- Back
  E('Lat Pulldown', 'Back', 3, '12', 5, 105, 'Cable machine', true),
  E('Seated Cable Row', 'Back', 3, '12', 5, 105, 'Cable machine', true),
  E('Single-Arm DB Row', 'Back', 3, '12/side', 5, 120, 'Dumbbell, bench', true),
  E('Face Pulls', 'Back', 3, '15', 4, 90, 'Cable, rope', true),
  E('Pull-Ups', 'Back', 3, '8', 6, 110, 'Pull-up bar'),
  E('Chest-Supported Row', 'Back', 3, '12', 5, 105, 'Incline bench, dumbbells'),
  E('Straight-Arm Pulldown', 'Back', 2, '15', 4, 90, 'Cable machine'),

  // ------------------------------------------------------------ Shoulders
  E('Seated DB Shoulder Press', 'Shoulders', 3, '12', 5, 105, 'Dumbbells, bench', true),
  E('Lateral Raises', 'Shoulders', 3, '15', 4, 90, 'Light dumbbells', true),
  E('Rear Delt Fly', 'Shoulders', 3, '15', 4, 90, 'Dumbbells or pec deck'),
  E('Arnold Press', 'Shoulders', 3, '12', 5, 105, 'Dumbbells'),

  // --------------------------------------------------------------- Biceps
  E('DB Bicep Curl', 'Biceps', 3, '12', 4, 90, 'Dumbbells', true),
  E('Hammer Curl', 'Biceps', 2, '12', 4, 90, 'Dumbbells', true),
  E('Cable Curl', 'Biceps', 3, '12', 4, 90, 'Cable machine'),
  E('Preacher Curl', 'Biceps', 3, '10', 4, 95, 'Preacher bench'),

  // -------------------------------------------------------------- Triceps
  E('Triceps Rope Pushdown', 'Triceps', 3, '15', 4, 90, 'Cable, rope', true),
  E('Overhead Triceps Extension', 'Triceps', 3, '12', 4, 95, 'Dumbbell or cable', true),
  E('Skull Crushers', 'Triceps', 3, '12', 4.5, 95, 'EZ bar or dumbbells'),
  E('Close-Grip Bench Press', 'Triceps', 3, '10', 5, 105, 'Barbell, flat bench'),

  // ----------------------------------------------------------------- Legs
  E('Goblet Squat', 'Legs', 3, '12', 5.5, 110, 'Dumbbell or kettlebell', true),
  E('Romanian Deadlift', 'Legs', 3, '10', 6, 120, 'Barbell or dumbbells', true),
  E('Bulgarian Split Squat', 'Legs', 3, '10/leg', 6, 130, 'Bench, dumbbells', true),
  E('Step-Ups', 'Legs', 3, '10/leg', 5.5, 120, 'Bench/box, dumbbells', true),
  E('Leg Curl', 'Legs', 3, '12', 4.5, 95, 'Leg curl machine', true),
  E('Lateral Band Walks', 'Legs', 2, '15 steps/side', 4, 90, 'Mini band', true),
  E('Banded Terminal Knee Extension', 'Legs', 2, '15', 3.5, 80, 'Band, low anchor', true),
  E('Calf Raises', 'Legs', 2, '15', 3.5, 75, 'Bodyweight or dumbbells', true),
  E('Leg Press', 'Legs', 3, '12', 5.5, 110, 'Leg press machine'),
  E('Leg Extension', 'Legs', 3, '12', 4.5, 95, 'Leg extension machine'),
  E('Hip Thrust', 'Legs', 3, '12', 5.5, 110, 'Bench, barbell'),
  E('Walking Lunges', 'Legs', 3, '12/leg', 6, 120, 'Dumbbells'),

  // ----------------------------------------------------------------- Core
  E('Plank', 'Core', 3, '30-45s', 3.8, 75, 'Floor', true),
  E('Side Plank', 'Core', 2, '30s/side', 3.8, 80, 'Floor', true),
  E('Bird Dog', 'Core', 2, '10/side', 3, 75, 'Floor', true),
  E('Mountain Climbers', 'Core', 3, '20s', 6, 60, 'Floor', true),
  E('Pallof Press', 'Core', 2, '10-12/side', 3.5, 90, 'Cable machine', true),
  E('Dead Bug', 'Core', 3, '10/side', 3, 75, 'Floor'),
  E('Hanging Knee Raise', 'Core', 3, '12', 4, 90, 'Pull-up bar'),
  E('Cable Crunch', 'Core', 3, '15', 4, 90, 'Cable machine'),
  E('Hollow Hold', 'Core', 3, '30s', 4, 70, 'Floor'),

  // --------------------------------------------------------------- Cardio
  // Intervals keep their round structure; everything else is minutes.
  E('StairMaster Intervals', 'Cardio', 10, '30s hard / 90s easy', 9, 120, 'StairMaster', true),
  E('Bike Intervals', 'Cardio', 8, '1 min hard / 2 min easy', 8.5, 180, 'Stationary bike', true),
  E('Rower Intervals', 'Cardio', 8, '1 min hard / 2 min easy', 8.5, 180, 'Rowing machine', true),
  C('Easy pace ramp / cool-down', 5, 8, 'Any machine', true),
  C('Walking, brisk', 3.5, 20, 'Outdoors or treadmill'),
  C('Treadmill incline walk', 6, 20, 'Treadmill'),
  C('Jogging, easy (8 km/h)', 8, 20, 'Treadmill or outdoors'),
  C('Running (10 km/h)', 10, 20, 'Treadmill or outdoors'),
  C('Running, fast (12 km/h)', 11.5, 20, 'Treadmill or outdoors'),
  C('Stationary bike, moderate', 7, 20, 'Stationary bike'),
  C('Stationary bike, hard', 10.5, 20, 'Stationary bike'),
  C('Spin class', 8.5, 45, 'Studio bike'),
  C('Elliptical, moderate', 6.5, 20, 'Elliptical'),
  C('Elliptical, hard', 8, 20, 'Elliptical'),
  C('Rowing, moderate', 7, 20, 'Rowing machine'),
  C('Rowing, hard', 8.5, 20, 'Rowing machine'),
  C('StairMaster, steady', 8, 20, 'StairMaster'),
  C('Stair climbing', 8, 10, 'Real stairs'),
  C('Swimming, freestyle moderate', 8.3, 30, 'Pool'),
  C('Swimming, freestyle hard', 9.8, 30, 'Pool'),
  C('Jump rope', 11, 10, 'Skipping rope'),
  C('HIIT circuit', 8, 20, 'Bodyweight or mixed'),
  C('Hiking', 6, 60, 'Outdoors'),
  C('Football / basketball', 8, 45, 'Court or pitch'),

  // ------------------------------------------------------------- Mobility
  E('Movement Prep (bands, circles, bridges)', 'Mobility', 1, '3 min', 3, 180, 'Band, floor', true),
  E('Cool-Down Stretch', 'Mobility', 1, '8 min', 2.3, 480, 'Floor', true),
  E('Yoga Flow', 'Mobility', 1, '20 min', 2.5, 1200, 'Mat', true),
  E('Pigeon Pose', 'Mobility', 2, '45s/side', 2.3, 100, 'Mat', true),
  E('Legs-Up-The-Wall', 'Mobility', 1, '3 min', 1.5, 180, 'Wall', true),
]

/**
 * Which convention each exercise follows. Anything not listed is a machine or
 * bodyweight movement, where the number on the stack is the number.
 */
const LOAD_BY_NAME: Record<string, LoadStyle> = {
  'Barbell Bench Press': LOAD_BAR,
  'Incline Barbell Press': LOAD_BAR,
  'Close-Grip Bench Press': LOAD_BAR,
  'Romanian Deadlift': LOAD_BAR,
  'Hip Thrust': LOAD_BAR,
  'Skull Crushers': LOAD_BAR,
  'Flat DB Bench Press': LOAD_EACH_HAND,
  'Incline DB Press': LOAD_EACH_HAND,
  'Seated DB Shoulder Press': LOAD_EACH_HAND,
  'Arnold Press': LOAD_EACH_HAND,
  'Lateral Raises': LOAD_EACH_HAND,
  'Rear Delt Fly': LOAD_EACH_HAND,
  'DB Bicep Curl': LOAD_EACH_HAND,
  'Hammer Curl': LOAD_EACH_HAND,
  'Walking Lunges': LOAD_EACH_HAND,
  'Bulgarian Split Squat': LOAD_EACH_HAND,
  'Step-Ups': LOAD_EACH_HAND,
  'Chest-Supported Row': LOAD_EACH_HAND,
  'Single-Arm DB Row': LOAD_ONE,
  'Goblet Squat': LOAD_ONE,
  'Overhead Triceps Extension': LOAD_ONE,
  'Preacher Curl': LOAD_ONE,
}
for (const ex of CATALOGUE) ex.load = LOAD_BY_NAME[ex.name] ?? LOAD_STACK

export const GROUPS: MuscleGroup[] = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Cardio', 'Mobility',
]

export interface DayPlan {
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number
  name: string
  exercises: string[]
}

export const WEEK: DayPlan[] = [
  {
    weekday: 1,
    name: 'Push — chest, shoulders, triceps',
    exercises: [
      'Movement Prep (bands, circles, bridges)', 'Barbell Bench Press', 'Incline DB Press',
      'Cable Fly', 'Seated DB Shoulder Press', 'Lateral Raises', 'Triceps Rope Pushdown',
      'Overhead Triceps Extension', 'Face Pulls', 'Cool-Down Stretch',
    ],
  },
  {
    weekday: 2,
    name: 'Cardio, core and yoga',
    exercises: [
      'StairMaster Intervals', 'Easy pace ramp / cool-down', 'Plank', 'Side Plank',
      'Bird Dog', 'Mountain Climbers', 'Yoga Flow',
    ],
  },
  {
    weekday: 3,
    name: 'Pull — back, biceps',
    exercises: [
      'Movement Prep (bands, circles, bridges)', 'Lat Pulldown', 'Seated Cable Row',
      'Single-Arm DB Row', 'Face Pulls', 'Pallof Press', 'DB Bicep Curl', 'Hammer Curl',
      'Cool-Down Stretch',
    ],
  },
  {
    weekday: 4,
    name: 'Cardio, core and yoga',
    exercises: [
      'Bike Intervals', 'Easy pace ramp / cool-down', 'Plank', 'Bird Dog',
      'Mountain Climbers', 'Side Plank', 'Yoga Flow',
    ],
  },
  {
    weekday: 5,
    name: 'Legs — quads, hamstrings, glutes',
    exercises: [
      'Movement Prep (bands, circles, bridges)', 'Goblet Squat', 'Romanian Deadlift',
      'Bulgarian Split Squat', 'Step-Ups', 'Leg Curl', 'Lateral Band Walks',
      'Banded Terminal Knee Extension', 'Calf Raises', 'Cool-Down Stretch',
    ],
  },
]

export function planFor(date: string): DayPlan | null {
  // Parsed as local midnight, so the weekday is the one you would say out loud.
  const [y, m, d] = date.split('-').map(Number)
  return WEEK.find((p) => p.weekday === new Date(y, m - 1, d).getDay()) ?? null
}

export function byName(name: string): Exercise | undefined {
  return CATALOGUE.find((e) => e.name === name)
}

/**
 * What one exercise, as actually performed, costs.
 *
 * `count` is sets for resistance work and minutes for cardio; either way it
 * multiplies the seconds each one occupies. A MET is a multiple of resting
 * metabolism, so the energy is met x kg x hours.
 */
export function exerciseKcal(ex: Exercise, count: number, kg: number): number {
  if (!(kg > 0) || !(count > 0)) return 0
  return Math.round((ex.met * kg * (count * ex.secPerSet)) / 3600)
}

export function exerciseMinutes(ex: Exercise, count: number): number {
  return Math.round((count * ex.secPerSet) / 60)
}

/** Pounds to kilograms, exactly. */
export const LB_PER_KG = 2.2046226218

export function toDisplayWeight(kg: number | undefined, unit: 'kg' | 'lb'): number | undefined {
  if (kg == null) return undefined
  return unit === 'lb' ? Math.round(kg * LB_PER_KG * 10) / 10 : kg
}

export function fromDisplayWeight(value: number | undefined, unit: 'kg' | 'lb'): number | undefined {
  if (value == null) return undefined
  return unit === 'lb' ? Math.round((value / LB_PER_KG) * 100) / 100 : value
}

/**
 * A name for the session, from what was actually in it.
 *
 * "Session" says nothing a date does not already say. The muscle groups
 * trained are what distinguishes one day from another, and on a day that went
 * entirely off-plan they are the only description there is.
 */
export function describeSession(groups: MuscleGroup[]): string {
  const seen = [...new Set(groups)]
  if (seen.length === 0) return 'Session'
  if (seen.length === 1) return seen[0]
  if (seen.length === 2) return `${seen[0]} and ${seen[1]}`
  return `${seen.slice(0, 2).join(', ')} +${seen.length - 2}`
}
