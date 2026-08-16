import { db, saveSettings } from '../db/db'
import { todayISO } from './date'

const FORMAT = 'salutt-backup'
const VERSION = 1

export interface Backup {
  format: string
  version: number
  exportedAt: string
  counts: Record<string, number>
  data: Record<string, unknown[]>
}

const TABLES = [
  'foods',
  'entries',
  'weighIns',
  'measurements',
  'workouts',
  'mealTemplates',
  // Recipes arrived after this list was written and were silently left out of
  // every backup and every sync, which would have lost them on a new phone.
  // Restores tolerate its absence, so older backups still load.
  'recipes',
  'settings',
] as const

export async function buildBackup(): Promise<Backup> {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const name of TABLES) {
    const rows = await db.table(name).toArray()
    data[name] = rows
    counts[name] = rows.length
  }
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), counts, data }
}

/**
 * Writes a backup out. On desktop Chrome this offers a real save dialog (point
 * it at ~/Drive/personal/Personal/Salutt/backups); on Android it falls back to
 * a normal download.
 */
export async function exportBackup(): Promise<string> {
  const backup = await buildBackup()
  const json = JSON.stringify(backup, null, 2)
  const filename = `salutt-${todayISO()}.json`

  const picker = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await (picker as (o: unknown) => Promise<FileSystemFileHandle>)({
        suggestedName: filename,
        types: [{ description: 'Salutt backup', accept: { 'application/json': ['.json'] } }],
      })
      const w = await handle.createWritable()
      await w.write(json)
      await w.close()
      await saveSettings({ lastBackup: Date.now() })
      return handle.name
    } catch (err) {
      // User cancelled the dialog — do not silently fall through to a download.
      if ((err as DOMException)?.name === 'AbortError') throw err
    }
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  await saveSettings({ lastBackup: Date.now() })
  return filename
}

export interface ImportResult {
  counts: Record<string, number>
}

/**
 * Restores a backup. `replace` wipes existing tables first; otherwise rows are
 * appended with fresh ids, which is what you want when merging two devices.
 */
export async function importBackup(file: File, replace: boolean): Promise<ImportResult> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Backup
  if (parsed.format !== FORMAT) throw new Error('Not a Salutt backup file')
  if (parsed.version > VERSION) throw new Error('Backup is from a newer version of Salutt')

  const counts: Record<string, number> = {}
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const name of TABLES) {
      // A backup written before a table existed carries no key for it. Clearing
      // on that basis would delete live data to match a file that never had an
      // opinion about it — which is how restoring an older copy would have
      // wiped every recipe. Absent means "unknown", not "empty".
      if (!(name in parsed.data)) {
        counts[name] = 0
        continue
      }
      const rows = (parsed.data[name] ?? []) as Record<string, unknown>[]
      const table = db.table(name)
      if (replace) await table.clear()
      if (name === 'settings') {
        for (const row of rows) await table.put(row)
      } else {
        const prepared = replace ? rows : rows.map(({ id: _id, ...rest }) => rest)
        await table.bulkPut(prepared)
      }
      counts[name] = rows.length
    }
  })
  return { counts }
}
