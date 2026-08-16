import { buildBackup, importBackup } from './backup'
import { db, getSettings, saveSettings } from '../db/db'
import { WORDS } from './wordlist'

/**
 * Encrypted sync to your own server.
 *
 * Everything is encrypted on the device before it leaves. The server stores an
 * opaque blob and holds no key, so a copy of the database — or of the server —
 * reveals nothing. One secret does two jobs: it derives the address the blob
 * is stored under, and the key that opens it. Anyone loading the app without
 * it gets an empty log and no way to reach yours.
 *
 * The flip side is that the secret is the only key in existence. There is no
 * reset, because a reset would mean the server could decrypt for us, which is
 * exactly what this design refuses to allow.
 */

const ENDPOINT = '/api/sync'
// OWASP's current floor for PBKDF2-HMAC-SHA256. Runs once per session and the
// result is cached, so the cost lands on an attacker rather than on you.
const PBKDF2_ROUNDS = 310_000

/* ---------------------------------------------------------------- secret */

// Crockford base32 without I, L, O, U — no character pairs that get misread
// when copying a code by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Five words from the EFF short list: 51.7 bits, and rememberable.
 *
 * This is the recommended form. A code you cannot recall is a code you will
 * paste somewhere insecure, or lose.
 */
export function generatePassphrase(count = 5): string {
  const picks: string[] = []
  const buf = new Uint32Array(count)
  crypto.getRandomValues(buf)
  for (let i = 0; i < count; i++) picks.push(WORDS[buf[i] % WORDS.length])
  return picks.join('-')
}

/** Shapes so common that their length says nothing about their strength. */
const COMMON = new Set([
  'password', 'passwd', 'letmein', 'welcome', 'admin', 'qwerty', 'iloveyou', 'monkey',
  'dragon', 'football', 'baseball', 'sunshine', 'princess', 'superman', 'trustno',
  'master', 'shadow', 'michael', 'jennifer', 'hunter', 'ranger', 'secret', 'salutt',
])

/**
 * Rough entropy of a secret the user typed themselves, in bits.
 *
 * The job is not precision, it is refusing to call something strong when it is
 * not. Naive per-character counting scores `password1` at 47 bits and a
 * surname plus a year at 83, which is exactly backwards — both are among the
 * first things anyone would try. So words are counted as words, and the shapes
 * people actually pick are penalised specifically.
 */
export function estimateBits(secret: string): number {
  const s = secret.trim()
  if (!s) return 0

  const lower = s.toLowerCase()
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  const wordTokens = tokens.filter((t) => /^[a-z]+$/.test(t) && t.length >= 3)

  // A phrase generated from the EFF list: entropy is exactly the dice roll.
  if (wordTokens.length >= 4 && wordTokens.every((w) => WORDS.includes(w))) {
    return Math.round(wordTokens.length * Math.log2(WORDS.length))
  }

  // Several words the user chose. Words are not random characters — counting
  // them per character wildly overstates a phrase like "correct horse battery
  // staple". Roughly 11 bits per word is the usual conservative figure.
  if (wordTokens.length >= 3) {
    const digitTokens = tokens.filter((t) => /^\d+$/.test(t))
    const digitBits = digitTokens.reduce((n, t) => n + t.length * 3.32, 0)
    const penalty = wordTokens.some((w) => COMMON.has(w)) ? 11 : 0
    return Math.max(0, Math.round(wordTokens.length * 11 + digitBits - penalty))
  }

  // One word with digits stuck on the end is the single most common password
  // shape there is, and its strength is the word plus the digits, nothing more.
  const wordDigits = /^([a-z]+)(\d{1,6})$/.exec(lower.replace(/[^a-z0-9]/g, ''))
  if (wordDigits) {
    const [, word, digits] = wordDigits
    const wordBits = COMMON.has(word) ? 5 : 11
    return Math.round(wordBits + digits.length * 3.32)
  }

  let pool = 0
  if (/[a-z]/.test(s)) pool += 26
  if (/[A-Z]/.test(s)) pool += 26
  if (/[0-9]/.test(s)) pool += 10
  if (/[^a-zA-Z0-9]/.test(s)) pool += 20
  let bits = s.length * Math.log2(pool || 1)

  // A year, a date, or a long digit run is almost never a random choice.
  if (/\b(19|20)\d{2}\b/.test(s)) bits -= 14
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 6) bits -= digits.length * 1.5
  if (/(.)\1{2,}/.test(s)) bits -= 8
  if (/(abc|bcd|cde|123|234|345|456|567|678|789|qwe|asd|zxc)/i.test(s)) bits -= 10
  if (COMMON.has(lower.replace(/[^a-z]/g, ''))) bits -= 25

  return Math.max(0, Math.round(bits))
}

export type Strength = 'weak' | 'fair' | 'strong'

export function strengthOf(secret: string): Strength {
  const bits = estimateBits(secret)
  // 50 bits is the bar because the attack here is online: every guess costs a
  // request to a rate-limited endpoint, not a GPU cycle. Five words from the
  // EFF list clear it at ~52.
  if (bits < 45) return 'weak'
  if (bits < 50) return 'fair'
  return 'strong'
}

/** A 160-bit recovery code, formatted in groups so it can be read aloud. */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return `SLT-${(out.match(/.{1,4}/g) ?? []).join('-')}`
}

/** Accepts the code however it was typed: any case, with or without dashes. */
/**
 * Canonical form of a secret, so the same phrase typed differently derives the
 * same key. Word phrases keep their separators as single dashes; the generated
 * SLT code is case- and dash-insensitive.
 */
export function normalizeSecret(secret: string): string {
  const s = secret.trim()
  if (/^SLT[-\s]/i.test(s) || /^[0-9A-Z\s-]+$/i.test(s.replace(/[a-z]/g, 'A'))) {
    const compact = s.toUpperCase().replace(/[^0-9A-Z]/g, '')
    if (compact.startsWith('SLT')) return compact.slice(3)
  }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function looksLikeSecret(secret: string): boolean {
  return normalizeSecret(secret).length >= 12
}

/* ---------------------------------------------------------------- keys */

export interface SyncKeys {
  /** Where the blob lives. Derived, never guessable from the app alone. */
  id: string
  /** Proves the caller holds the secret, so a leaked id is not enough. */
  auth: string
  key: CryptoKey
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

let cached: { secret: string; keys: SyncKeys } | null = null

export async function deriveKeys(secret: string): Promise<SyncKeys> {
  const norm = normalizeSecret(secret)
  if (cached?.secret === norm) return cached.keys

  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(norm), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])

  // One slow derivation, then cheap HKDF for each purpose. PBKDF2 is here so a
  // hand-chosen secret is not trivially brute-forced; the generated one does
  // not need it, but nothing stops someone typing their own.
  const masterBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('salutt/sync/v1'), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    base,
    256,
  )
  const master = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveBits', 'deriveKey'])

  const sub = (info: string, bits: number) =>
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
      master,
      bits,
    )

  const keys: SyncKeys = {
    id: hex(await sub('id', 128)),
    auth: hex(await sub('auth', 256)),
    key: await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('aes') },
      master,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
  }

  cached = { secret: norm, keys }
  return keys
}

/* ---------------------------------------------------------------- crypto */

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function encrypt(keys: SyncKeys, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  // Compressed first: a year of logging goes from ~1.1 MB to ~170 KB, which is
  // both less to store and less to push over mobile data.
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keys.key,
    await gzip(new TextEncoder().encode(plaintext) as Uint8Array<ArrayBuffer>),
  )
  const joined = new Uint8Array(iv.length + ct.byteLength)
  joined.set(iv, 0)
  joined.set(new Uint8Array(ct), iv.length)
  // Chunked to avoid blowing the argument limit on a multi-megabyte backup.
  let s = ''
  for (let i = 0; i < joined.length; i += 0x8000) {
    s += String.fromCharCode(...joined.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

async function decrypt(keys: SyncKeys, payload: string): Promise<string> {
  const raw = unb64(payload)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.subarray(0, 12) },
    keys.key,
    raw.subarray(12),
  )
  return new TextDecoder().decode(await gunzip(new Uint8Array(plain)))
}

/* ---------------------------------------------------------------- transport */

export class WrongSecretError extends Error {}

interface Envelope {
  updatedAt: number
  device: string
  blob: string
}

async function request(method: 'GET' | 'POST', keys: SyncKeys, body?: unknown): Promise<Response> {
  return fetch(ENDPOINT, {
    method,
    headers: {
      'X-Salutt-Id': keys.id,
      'X-Salutt-Auth': keys.auth,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

export interface SyncResult {
  updatedAt: number
  bytes: number
}

/** Encrypts the whole database and stores it. */
export async function push(secret: string): Promise<SyncResult> {
  const keys = await deriveKeys(secret)
  const backup = await buildBackup()
  const blob = await encrypt(keys, JSON.stringify(backup))
  const envelope: Envelope = { updatedAt: Date.now(), device: deviceName(), blob }

  const res = await request('POST', keys, envelope)
  if (res.status === 403) throw new WrongSecretError('That secret does not match this account.')
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)

  await saveSettings({ lastSync: envelope.updatedAt })
  return { updatedAt: envelope.updatedAt, bytes: blob.length }
}

/** Returns the stored copy without touching local data. */
export async function fetchRemote(
  secret: string,
): Promise<{ updatedAt: number; device: string; backup: unknown } | null> {
  const keys = await deriveKeys(secret)
  const res = await request('GET', keys)
  if (res.status === 404) return null
  if (res.status === 403) throw new WrongSecretError('That secret does not match this account.')
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)

  const envelope = (await res.json()) as Envelope
  let json: string
  try {
    json = await decrypt(keys, envelope.blob)
  } catch {
    // AES-GCM authenticates, so a failure here means the wrong key rather than
    // corruption — the server could not have altered it undetected.
    throw new WrongSecretError('That secret cannot open this backup.')
  }
  return { updatedAt: envelope.updatedAt, device: envelope.device, backup: JSON.parse(json) }
}

/** Replaces everything on this device with the stored copy. */
export async function pull(secret: string): Promise<number> {
  const remote = await fetchRemote(secret)
  if (!remote) throw new Error('Nothing stored yet for this secret.')

  const file = new File([JSON.stringify(remote.backup)], 'restore.json', {
    type: 'application/json',
  })
  const result = await importBackup(file, true)
  await saveSettings({ lastSync: remote.updatedAt })
  return result.counts.entries ?? 0
}

function deviceName(): string {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad/i.test(ua)) return 'iOS'
  if (/Linux/i.test(ua)) return 'Linux'
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  return 'device'
}

/** True when there is local data worth pushing. */
export async function hasLocalData(): Promise<boolean> {
  const [entries, weighIns] = await Promise.all([db.entries.count(), db.weighIns.count()])
  return entries + weighIns > 0
}

export async function currentSecret(): Promise<string | undefined> {
  return (await getSettings()).syncSecret
}
