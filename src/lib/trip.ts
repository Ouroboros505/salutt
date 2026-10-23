import type { ISODate, Settings, Trip } from '../db/db'
import { addDays, daysBetween } from './date'

/**
 * How long after landing the pre-trip rules stay in force.
 *
 * The first week back is travel water, and the windows that measure
 * maintenance need another week of ordinary days before they say anything
 * about the body rather than the suitcase.
 */
export const TRIP_SETTLE_DAYS = 14

/**
 * How long after landing a weigh-in is still mostly the trip: salt, carbs and
 * a long flight. Shown on the chart, kept out of every fitted rate.
 */
export const TRIP_WATER_DAYS = 7

/** The trip a day falls in, if any. */
export function tripOn(trips: Trip[] | undefined, date: ISODate): Trip | undefined {
  return trips?.find((t) => t.from <= date && date <= t.to)
}

/** The trip whose rules still hold on a day: away, or not yet settled back. */
export function tripSettling(trips: Trip[] | undefined, date: ISODate): Trip | undefined {
  return trips?.find((t) => t.from <= date && date <= addDays(t.to, TRIP_SETTLE_DAYS))
}

/** Away, or back so recently that the scale still carries the trip. */
export function tripShown(trips: Trip[] | undefined, date: ISODate): Trip | undefined {
  return trips?.find((t) => t.from <= date && date <= addDays(t.to, TRIP_WATER_DAYS))
}

/** Logged food and activity from these days measure the trip, not home. */
export function inTrip(trips: Trip[] | undefined, date: ISODate): boolean {
  return !!tripOn(trips, date)
}

/** Weigh-ins from these days are the trip and its water. */
export function inTripWater(trips: Trip[] | undefined, date: ISODate): boolean {
  return !!trips?.some((t) => t.from <= date && date <= addDays(t.to, TRIP_WATER_DAYS))
}

/**
 * Which stretch between trips a date belongs to.
 *
 * A rate fitted straight across a trip would read the travel water as a
 * change of pace, so each stretch gets its own level and only the slopes
 * within them are pooled.
 */
export function tripSegment(trips: Trip[] | undefined, date: ISODate): number {
  return trips?.filter((t) => t.from <= date).length ?? 0
}

/** Days of the trips that fall inside [from, to]. */
export function tripDaysIn(trips: Trip[] | undefined, from: ISODate, to: ISODate): number {
  let n = 0
  for (const t of trips ?? []) {
    const a = t.from > from ? t.from : from
    const b = t.to < to ? t.to : to
    if (a <= b) n += daysBetween(a, b) + 1
  }
  return n
}

/** The trip's deficit as the weekly goal the rest of the app speaks. */
export function tripGoalKgPerWeek(t: Trip): number {
  return -(t.deficitKcal * 7) / 7700
}

/**
 * The settings a day is priced under.
 *
 * Away, the goal is the trip's softer deficit, written as a fixed weekly
 * figure so everything downstream (the target, the grams planned, the fat
 * check) follows it without knowing there is a trip at all.
 */
export function settingsOn(settings: Settings, date: ISODate): Settings {
  const t = tripOn(settings.trips, date)
  return t ? { ...settings, goalPctPerWeek: undefined, goalKgPerWeek: tripGoalKgPerWeek(t) } : settings
}
