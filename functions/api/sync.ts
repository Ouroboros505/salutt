/**
 * Encrypted blob storage for Salutt.
 *
 * This endpoint deliberately knows as little as possible. It sees an opaque
 * ciphertext and an id, and holds no key — the encryption happens on the phone
 * before anything is sent. Reading this KV namespace, or compelling Cloudflare
 * to hand it over, yields bytes nobody can open.
 *
 * The id is derived from the user's secret rather than assigned, so there are
 * no accounts, no email addresses, and nothing to enumerate. The auth token is
 * derived separately, so an id leaking (in a log, say) is not enough to read or
 * overwrite the blob.
 */

interface Env {
  SALUTT_KV: KVNamespace
  /**
   * Set to "1" once your account exists, to stop new ones being created.
   *
   * Claiming an id is the only path by which someone else's request can cause
   * a KV write, and KV writes are capped per day across the whole Cloudflare
   * account — so an open claim endpoint is a way for a stranger to exhaust a
   * quota that other services on the account depend on. With this set, only
   * ids that already exist may write.
   *
   * Unset it temporarily if you ever need to enrol a new recovery phrase.
   */
  SALUTT_LOCK?: string
}

// A backup is JSON, mostly small; this is far above a decade of logging and
// well under the 25 MB a KV value allows.
const MAX_BYTES = 8 * 1024 * 1024

const ID_RE = /^[0-9a-f]{32}$/
const AUTH_RE = /^[0-9a-f]{64}$/

// A failed lookup is answered slowly. This replaces a counter kept in KV,
// which was a mistake: every probe cost a KV write, the free tier allows 1,000
// per day account-wide, and anything else on the account shares that budget —
// so a bot spraying this endpoint could have exhausted the quota and broken
// unrelated services. A delay costs nothing and cannot be exhausted.
//
// It is also barely needed. The recovery phrase carries ~52 bits, so guessing
// one online would take on the order of 2^51 requests; the phrase is the
// defence, not the rate limit.
const FAILURE_DELAY_MS = 400

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Length-independent comparison, so timing does not leak the stored value. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface Identity {
  id: string
  authHash: string
}

/** Slows a failed lookup, without storing anything. */
const penalise = () => new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS))

async function identify(request: Request): Promise<Identity | null> {
  const id = request.headers.get('X-Salutt-Id') ?? ''
  const auth = request.headers.get('X-Salutt-Auth') ?? ''
  if (!ID_RE.test(id) || !AUTH_RE.test(auth)) return null
  return { id, authHash: await sha256Hex(auth) }
}

/**
 * Trust on first use: the first caller to present an id claims it, and every
 * later request must present the same derived token. Since both come from the
 * same secret, this amounts to "prove you know the secret" without the server
 * ever seeing it.
 */
async function authorize(
  env: Env,
  who: Identity,
  claimIfUnknown: boolean,
): Promise<'ok' | 'denied' | 'unknown'> {
  const stored = await env.SALUTT_KV.get(`auth:${who.id}`)
  if (stored === null) {
    if (!claimIfUnknown) return 'unknown'
    if (env.SALUTT_LOCK === '1') return 'denied'
    await env.SALUTT_KV.put(`auth:${who.id}`, who.authHash)
    return 'ok'
  }
  return constantTimeEqual(stored, who.authHash) ? 'ok' : 'denied'
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const who = await identify(request)
  if (!who) return json({ error: 'bad request' }, 400)

  const state = await authorize(env, who, false)
  if (state !== 'ok') await penalise()
  if (state === 'denied') return json({ error: 'forbidden' }, 403)
  if (state === 'unknown') return json({ error: 'not found' }, 404)

  const blob = await env.SALUTT_KV.get(`blob:${who.id}`)
  if (!blob) return json({ error: 'not found' }, 404)
  return new Response(blob, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const who = await identify(request)
  if (!who) return json({ error: 'bad request' }, 400)

  const state = await authorize(env, who, true)
  if (state === 'denied') {
    await penalise()
    return json({ error: 'forbidden' }, 403)
  }

  const body = await request.text()
  if (body.length > MAX_BYTES) return json({ error: 'too large' }, 413)

  let envelope: { updatedAt?: number; device?: string; blob?: string }
  try {
    envelope = JSON.parse(body)
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  if (typeof envelope.blob !== 'string' || !envelope.blob) {
    return json({ error: 'bad envelope' }, 400)
  }

  // Keep one generation back. A client bug that uploads an empty database
  // would otherwise overwrite the only copy with nothing.
  const previous = await env.SALUTT_KV.get(`blob:${who.id}`)
  if (previous) await env.SALUTT_KV.put(`prev:${who.id}`, previous)

  await env.SALUTT_KV.put(`blob:${who.id}`, body)
  return json({ ok: true, updatedAt: envelope.updatedAt ?? Date.now() })
}

/** Everything else, including any attempt to list or enumerate. */
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === 'GET' || request.method === 'POST') {
    return json({ error: 'unreachable' }, 500)
  }
  return json({ error: 'method not allowed' }, 405)
}
