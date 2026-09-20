/**
 * Google Maps proxy for route planning.
 *
 * The API key lives here, in a Cloudflare secret, and never reaches the phone —
 * the app calls this endpoint, this endpoint calls Google. Two reasons that
 * matters: a key shipped in the bundle is a key anyone can lift and spend, and
 * only the server can keep the running tally the usage meter reads.
 *
 * Every call is gated behind the same identity the sync endpoint uses: you must
 * present the id and auth token derived from the recovery phrase. Without that
 * this would be an open geocoding proxy, and an open proxy is a stranger's way
 * to run up the bill on someone else's key. Only an id that already exists may
 * call — no claiming here; enrolment happens through /api/sync.
 *
 *   POST {op:'geocode', query}          -> {lat, lng, formatted}
 *   POST {op:'route', from, to}         -> {km, minutes, climbM, descentM, polyline, mode}
 *   GET                                  -> {calls, geocode, directions, elevation, estUsd, since}
 */

interface Env {
  SALUTT_KV: KVNamespace
  GOOGLE_MAPS_API_KEY: string
}

const G = 'https://maps.googleapis.com/maps/api'
// A rough blended rate: Directions, Geocoding and Elevation each bill around
// $5 per 1,000 calls, so a flat half-cent a call is close enough to prove the
// point the meter exists to prove — that this costs almost nothing.
const USD_PER_CALL = 0.005
const USAGE_KEY = 'maps:usage'

const ID_RE = /^[0-9a-f]{32}$/
const AUTH_RE = /^[0-9a-f]{64}$/

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Prove you know the recovery phrase, without the server ever seeing it. */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const id = request.headers.get('X-Salutt-Id') ?? ''
  const auth = request.headers.get('X-Salutt-Auth') ?? ''
  if (!ID_RE.test(id) || !AUTH_RE.test(auth)) return false
  const stored = await env.SALUTT_KV.get(`auth:${id}`)
  if (!stored) return false
  return constantTimeEqual(stored, await sha256Hex(auth))
}

interface Usage {
  geocode: number
  directions: number
  elevation: number
  since: number
}

async function readUsage(env: Env): Promise<Usage> {
  const raw = await env.SALUTT_KV.get(USAGE_KEY)
  if (raw) {
    try {
      return JSON.parse(raw) as Usage
    } catch {
      /* fall through to a fresh tally */
    }
  }
  return { geocode: 0, directions: 0, elevation: 0, since: Date.now() }
}

/**
 * Fold this request's Google calls into the tally in one write.
 *
 * One KV write per request, not per Google call: the sync endpoint went to
 * some length to avoid spending the account-wide daily KV write budget on
 * anything a stranger could trigger, and while this is gated, planning routes
 * is rare enough (they cache client-side) that batching keeps it a rounding
 * error either way.
 */
async function addUsage(env: Env, delta: Partial<Usage>): Promise<void> {
  const u = await readUsage(env)
  u.geocode += delta.geocode ?? 0
  u.directions += delta.directions ?? 0
  u.elevation += delta.elevation ?? 0
  await env.SALUTT_KV.put(USAGE_KEY, JSON.stringify(u))
}

/**
 * Address to point, and how much to trust the point.
 *
 * Google answers a query it cannot fully match by returning the nearest thing
 * it *can* match, with no error: "2501 soldier home road" comes back as the
 * middle of Soldiers Home Rd, nearly two kilometres from number 2501, status
 * OK. A route to that centroid is a perfectly valid route to the wrong place,
 * and it looked like the app was inventing distance.
 *
 * Two fields tell the difference. `partial_match` is Google admitting it
 * dropped part of the query, and `types` says what kind of thing it landed on:
 * a 'street_address' or 'premise' is a building, a 'route' is a whole road.
 * Both travel back so the caller can say so before a place is saved for good.
 */
async function geocode(env: Env, query: string) {
  const u = `${G}/geocode/json?address=${encodeURIComponent(query)}&key=${env.GOOGLE_MAPS_API_KEY}`
  const r = (await fetch(u).then((x) => x.json())) as {
    status: string
    error_message?: string
    results: {
      formatted_address: string
      geometry: { location: { lat: number; lng: number } }
      types?: string[]
      partial_match?: boolean
    }[]
  }
  if (r.status === 'ZERO_RESULTS') return { notFound: true }
  if (r.status !== 'OK') return { error: r.error_message || r.status }
  const g = r.results[0]
  const types = g.types ?? []
  const precision = types.some((t) => t === 'street_address' || t === 'premise' || t === 'subpremise')
    ? ('address' as const)
    : types.includes('route')
      ? ('road' as const)
      : ('area' as const)
  return {
    formatted: g.formatted_address,
    lat: g.geometry.location.lat,
    lng: g.geometry.location.lng,
    precision,
    partial: g.partial_match === true,
  }
}

interface Pt {
  lat: number
  lng: number
}

async function directions(env: Env, from: Pt, to: Pt, mode: 'bicycling' | 'driving') {
  const u =
    `${G}/directions/json?origin=${from.lat},${from.lng}` +
    `&destination=${to.lat},${to.lng}&mode=${mode}&key=${env.GOOGLE_MAPS_API_KEY}`
  const r = (await fetch(u).then((x) => x.json())) as {
    status: string
    error_message?: string
    routes: { overview_polyline: { points: string }; legs: { distance: { value: number }; duration: { value: number } }[] }[]
  }
  if (r.status === 'ZERO_RESULTS') return { notFound: true as const }
  if (r.status !== 'OK') return { error: r.error_message || r.status }
  const leg = r.routes[0].legs[0]
  return {
    km: leg.distance.value / 1000,
    minutes: leg.duration.value / 60,
    polyline: r.routes[0].overview_polyline.points,
  }
}

/** Total metres climbed and descended along an encoded path. */
async function elevation(env: Env, polyline: string, meters: number) {
  const samples = Math.max(2, Math.min(512, Math.round(meters / 40)))
  const u = `${G}/elevation/json?path=enc:${encodeURIComponent(polyline)}&samples=${samples}&key=${env.GOOGLE_MAPS_API_KEY}`
  const r = (await fetch(u).then((x) => x.json())) as {
    status: string
    error_message?: string
    results: { elevation: number }[]
  }
  if (r.status !== 'OK') return { error: r.error_message || r.status }
  let up = 0
  let down = 0
  for (let i = 1; i < r.results.length; i++) {
    const d = r.results[i].elevation - r.results[i - 1].elevation
    if (d > 0) up += d
    else down -= d
  }
  return { climbM: Math.round(up), descentM: Math.round(down) }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await authorized(request, env))) return json({ error: 'forbidden' }, 403)
  const u = await readUsage(env)
  const calls = u.geocode + u.directions + u.elevation
  return json({ ...u, calls, estUsd: Math.round(calls * USD_PER_CALL * 100) / 100 })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await authorized(request, env))) return json({ error: 'forbidden' }, 403)
  if (!env.GOOGLE_MAPS_API_KEY) return json({ error: 'maps key not configured' }, 500)

  let body: { op?: string; query?: string; from?: Pt; to?: Pt }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  if (body.op === 'geocode') {
    if (!body.query || typeof body.query !== 'string') return json({ error: 'bad query' }, 400)
    const res = await geocode(env, body.query)
    await addUsage(env, { geocode: 1 })
    if ('error' in res) return json(res, 502)
    if ('notFound' in res) return json({ notFound: true }, 404)
    return json(res)
  }

  if (body.op === 'route') {
    const { from, to } = body
    if (!from?.lat || !to?.lat) return json({ error: 'need from and to points' }, 400)

    // Bicycling first — the whole point is a bike distance. Fall back to
    // driving where Google has no cycling data, and say which was used so the
    // number can be trusted (or not) for what it is.
    let mode: 'bicycling' | 'driving' = 'bicycling'
    let dir = await directions(env, from, to, 'bicycling')
    let directionsCalls = 1
    if ('notFound' in dir) {
      dir = await directions(env, from, to, 'driving')
      directionsCalls = 2
      mode = 'driving'
    }
    if ('error' in dir) {
      await addUsage(env, { directions: directionsCalls })
      return json(dir, 502)
    }
    if ('notFound' in dir) {
      await addUsage(env, { directions: directionsCalls })
      return json({ notFound: true }, 404)
    }

    const elev = await elevation(env, dir.polyline, dir.km * 1000)
    await addUsage(env, { directions: directionsCalls, elevation: 1 })
    return json({
      km: Math.round(dir.km * 100) / 100,
      minutes: Math.round(dir.minutes),
      climbM: 'error' in elev ? undefined : elev.climbM,
      descentM: 'error' in elev ? undefined : elev.descentM,
      polyline: dir.polyline,
      mode,
    })
  }

  return json({ error: 'unknown op' }, 400)
}

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === 'GET' || request.method === 'POST') return json({ error: 'unreachable' }, 500)
  return json({ error: 'method not allowed' }, 405)
}
