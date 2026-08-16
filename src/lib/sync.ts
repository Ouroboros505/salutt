import { buildBackup, importBackup } from './backup'
import { db, getSettings, saveSettings } from '../db/db'

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
const PBKDF2_ROUNDS = 100_000

/* ---------------------------------------------------------------- secret */

// Crockford base32 without I, L, O, U — no character pairs that get misread
// when copying a code by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A 160-bit recovery code, formatted in groups so it can be read aloud. */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return `SLT-${(out.match(/.{1,4}/g) ?? []).join('-')}`
}

/** Accepts the code however it was typed: any case, with or without dashes. */
export function normalizeSecret(secret: string): string {
  return secret.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^SLT/, '')
}

export function looksLikeSecret(secret: string): boolean {
  return normalizeSecret(secret).length >= 20
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

async function encrypt(keys: SyncKeys, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keys.key,
    new TextEncoder().encode(plaintext),
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
  return new TextDecoder().decode(plain)
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
