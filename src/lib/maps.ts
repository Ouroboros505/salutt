import { currentSecret } from './sync'
import { deriveKeys } from './syncCrypto'

/**
 * The phone's side of the Google Maps proxy.
 *
 * Nothing here holds the key — every call goes to /api/maps, which holds it.
 * The point of routing through the server is not secrecy for its own sake but
 * that the key stays unspendable if the app bundle is ever read, and that the
 * usage tally has one honest place to live.
 *
 * Each call carries the same id and auth token the sync uses, derived from the
 * recovery phrase, so the proxy will only answer someone who could already
 * read the backup. No phrase set up yet means no route planning — which is
 * fine, because without sync there is nowhere durable to keep the result.
 */

export class NoSyncError extends Error {
  constructor() {
    super('Set up sync first — route planning needs it.')
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const secret = await currentSecret()
  if (!secret) throw new NoSyncError()
  const keys = await deriveKeys(secret)
  return { 'X-Salutt-Id': keys.id, 'X-Salutt-Auth': keys.auth }
}

export interface GeoPoint {
  lat: number
  lng: number
  formatted: string
  /**
   * How specific the point is. 'address' is a building; 'road' is the middle
   * of a whole street, which is what Google returns when it cannot match the
   * house number and is how a ride to a friend's house became 2.2 km too long.
   */
  precision?: 'address' | 'road' | 'area'
  /** Google matched only part of what was typed. */
  partial?: boolean
}

/** Why a geocoded point should not be trusted yet, or null if it is fine. */
export function geoDoubt(g: GeoPoint): string | null {
  if (g.precision === 'road')
    return 'That matched the street, not a building — distances will be off. Add the house number, town and state.'
  if (g.precision === 'area')
    return 'That matched an area rather than an address — distances will be rough. Add the street, town and state.'
  if (g.partial) return 'Google could not match all of that. Check the address below is the right one.'
  return null
}

/** Turn a typed address into a point, or null if Google found nothing. */
export async function geocode(query: string): Promise<GeoPoint | null> {
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ op: 'geocode', query }),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Geocode failed (${res.status})`)
  return res.json()
}

export interface PlannedRoute {
  km: number
  minutes: number
  climbM?: number
  descentM?: number
  polyline: string
  /** 'driving' when Google had no cycling route and fell back — read with care. */
  mode: 'bicycling' | 'driving'
}

/** Measure a bike route between two points: distance, time, and metres climbed. */
export async function planRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<PlannedRoute | null> {
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ op: 'route', from, to }),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Route failed (${res.status})`)
  return res.json()
}

export interface MapsUsage {
  calls: number
  geocode: number
  directions: number
  elevation: number
  estUsd: number
  since: number
}

/** The running tally, so you can see for yourself how little this costs. */
export async function mapsUsage(): Promise<MapsUsage> {
  const res = await fetch('/api/maps', { headers: await authHeaders() })
  if (!res.ok) throw new Error(`Usage failed (${res.status})`)
  return res.json()
}
