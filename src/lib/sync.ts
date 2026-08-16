import { buildBackup, importBackup } from './backup'
import { db, getSettings, saveSettings } from '../db/db'
import { deriveKeys, fetchRemote, pushPayload, type SyncResult } from './syncCrypto'

/**
 * Sync operations that touch the local database. The crypto and transport live
 * in syncCrypto.ts so they can also run outside a browser.
 */

export {
  deriveKeys,
  estimateBits,
  fetchRemote,
  generatePassphrase,
  generateSecret,
  looksLikeSecret,
  normalizeSecret,
  setApiBase,
  strengthOf,
  WrongSecretError,
  type Strength,
  type SyncKeys,
  type SyncResult,
} from './syncCrypto'

/** Encrypts the whole database and stores it. */
export async function push(secret: string): Promise<SyncResult> {
  const result = await pushPayload(secret, await buildBackup())
  await saveSettings({ lastSync: result.updatedAt })
  return result
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

/** True when there is local data worth pushing. */
export async function hasLocalData(): Promise<boolean> {
  const [entries, weighIns] = await Promise.all([db.entries.count(), db.weighIns.count()])
  return entries + weighIns > 0
}

export async function currentSecret(): Promise<string | undefined> {
  return (await getSettings()).syncSecret
}

// Keep the derived-key helper reachable for callers that only need an id.
export { deriveKeys as deriveSyncKeys }
