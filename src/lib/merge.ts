import { db, SYNCED_TABLES, type Settings, type Tombstone } from '../db/db'
import type { Backup } from './backup'

/**
 * Merging two copies of the log, row by row.
 *
 * Replacing one copy with the other means every difference is a loss, which is
 * why it had to stop and ask. Rows carry the time they last changed, so the two
 * sides can be reconciled instead: a row present on one side arrives, a row on
 * both keeps whichever was written later, and a deletion is remembered as a
 * tombstone so it is not undone by the device that had not heard about it yet.
 *
 * The ordering is by wall clock on whichever device made the edit. Two devices
 * whose clocks disagree can therefore resolve a genuine conflict the wrong way,
 * but only when the same row was edited on both between syncs — and the loser
 * is a single row, not the day.
 */

type Row = Record<string, unknown> & { id?: number | string; updatedAt?: number }

export interface MergeReport {
  /** Rows taken from the server that this device did not have, or had older. */
  pulled: number
  /** Rows this device holds that the server did not have, or had older. */
  pushed: number
  /** Rows removed here because the other side had deleted them. */
  removed: number
}

const stamp = (row: Row): number =>
  row.updatedAt ?? (row.createdAt as number) ?? (row.lastUsed as number) ?? 0

/** Latest tombstone per table+key, from both sides. */
function tombstoneIndex(lists: Tombstone[][]): Map<string, number> {
  const out = new Map<string, number>()
  for (const list of lists) {
    for (const t of list) {
      const key = `${t.table}:${t.key}`
      if ((out.get(key) ?? 0) < t.at) out.set(key, t.at)
    }
  }
  return out
}

/**
 * Folds a remote backup into the local database and reports what moved.
 *
 * Never destructive beyond what a tombstone explicitly asks for: a row missing
 * from the remote copy is a row the remote has not seen, not a deletion.
 */
/** Above both of these at once, a merge is refused rather than applied. */
const MASS_DELETE_ROWS = 50
const MASS_DELETE_SHARE = 0.2

export class MassDeletionError extends Error {
  constructor(doomed: number, total: number) {
    super(
      `Sync stopped: it would have deleted ${doomed} of ${total} records at once, which is never a real ` +
        'edit. Nothing was changed on this device or the server.',
    )
    this.name = 'MassDeletionError'
  }
}

export async function mergeInto(remote: Backup): Promise<MergeReport> {
  const report: MergeReport = { pulled: 0, pushed: 0, removed: 0 }
  const remoteTombs = ((remote.data.tombstones ?? []) as Tombstone[]) ?? []

  await db.transaction(
    'rw',
    [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones, db.settings],
    async () => {
      const graves = tombstoneIndex([remoteTombs, await db.tombstones.toArray()])

      /**
       * Refuse to delete most of the log in one sync.
       *
       * Every real deletion is one tap on one thing. A sync that would remove
       * a large share of the rows at once is a bug somewhere — the restore
       * that wiped the server on 2026-10-06 looked exactly like this — so it
       * stops before touching anything, and the throw rolls the transaction
       * back. Counted both ways: rows here that would be deleted, and rows on
       * the server that would be skipped as already deleted.
       */
      let doomed = 0
      let total = 0
      for (const name of SYNCED_TABLES) {
        const local = (await db.table(name).toArray()) as Row[]
        const incoming = ((remote.data[name] ?? []) as Row[]) ?? []
        const ids = new Set<string | number>()
        for (const row of [...local, ...incoming]) {
          if (row.id == null || ids.has(row.id)) continue
          ids.add(row.id)
          total++
          const buried = graves.get(`${name}:${row.id}`)
          if (buried != null && buried >= stamp(row)) doomed++
        }
      }
      if (doomed > MASS_DELETE_ROWS && doomed > total * MASS_DELETE_SHARE) {
        throw new MassDeletionError(doomed, total)
      }

      for (const name of SYNCED_TABLES) {
        const table = db.table(name)
        const mine = new Map<string | number, Row>()
        for (const row of (await table.toArray()) as Row[]) {
          if (row.id != null) mine.set(row.id, row)
        }

        for (const incoming of ((remote.data[name] ?? []) as Row[]) ?? []) {
          if (incoming.id == null) continue
          const buried = graves.get(`${name}:${incoming.id}`)
          // Deleted after it was last written, so it stays deleted.
          if (buried != null && buried >= stamp(incoming)) continue

          const existing = mine.get(incoming.id)
          if (!existing) {
            await table.put({ ...incoming, updatedAt: stamp(incoming) })
            report.pulled++
          } else if (stamp(incoming) > stamp(existing)) {
            await table.put({ ...incoming, updatedAt: stamp(incoming) })
            report.pulled++
          } else if (stamp(existing) > stamp(incoming)) {
            report.pushed++
          }
        }

        // Anything the remote has not seen at all is ours to send.
        const seen = new Set(
          (((remote.data[name] ?? []) as Row[]) ?? []).map((r) => r.id).filter((x) => x != null),
        )
        for (const [id, row] of mine) {
          const buried = graves.get(`${name}:${id}`)
          if (buried != null && buried >= stamp(row)) {
            await table.delete(id as never)
            report.removed++
            continue
          }
          if (!seen.has(id)) report.pushed++
        }
      }

      // Settings are a single row with no useful identity beyond recency.
      const localSettings = await db.settings.get('settings')
      const remoteSettings = (((remote.data.settings ?? []) as Row[]) ?? [])[0]
      if (remoteSettings && stamp(remoteSettings) > stamp((localSettings ?? {}) as Row)) {
        // The secret is what this device authenticates with; never take
        // another copy's idea of it mid-sync.
        const keep = localSettings?.syncSecret
        await db.settings.put({
          ...(remoteSettings as unknown as Settings),
          id: 'settings',
          syncSecret: keep,
        })
      }

      // Tombstones travel with the data, so every device learns the deletion.
      for (const t of remoteTombs) {
        const dupe = await db.tombstones.where('[table+key]').equals([t.table, t.key]).first()
        if (!dupe) await db.tombstones.put({ ...t, id: undefined })
      }
    },
  )

  return report
}

/**
 * Tombstones are only needed until every device has seen them. Keeping a year
 * of them is harmless in size and removes any question of a deletion being
 * undone by a device that was off for a long time.
 */
export async function pruneTombstones(maxAgeDays = 365): Promise<void> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  await db.tombstones.where('at').below(cutoff).delete()
}
