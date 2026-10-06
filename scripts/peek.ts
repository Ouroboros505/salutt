/**
 * Pulls the encrypted backup down and summarises it, so the log can be looked
 * at from the desktop while working on the app.
 *
 * Read-only: it never writes to the server and never touches the phone. The
 * recovery phrase comes from SECRETS.local.md, which is gitignored.
 *
 *   npm run peek            summary
 *   npm run peek -- --json  the whole decrypted backup, for piping elsewhere
 */
import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'

const SITE = process.env.SALUTT_URL ?? 'https://salutt.stipe.app'

function secretFromFile(): string {
  const text = readFileSync(new URL('../SECRETS.local.md', import.meta.url), 'utf8')
  const match = /```\n([a-z0-9-]+)\n```/.exec(text)
  if (!match) throw new Error('no recovery phrase found in SECRETS.local.md')
  return match[1]
}

interface Row {
  date: string
  kcal?: number
  protein?: number
  carbs?: number
  fat?: number
  kg?: number
  bodyFatPct?: number
  name?: string
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)

async function main() {
  setApiBase(SITE)
  const remote = await fetchRemote(secretFromFile())
  if (!remote) {
    console.log('Nothing stored on the server yet.')
    return
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(remote.backup, null, 2))
    return
  }

  const data = (remote.backup as { data: Record<string, Row[]> }).data
  const entries = data.entries ?? []
  const weighIns = data.weighIns ?? []

  console.log(`Salutt — synced ${new Date(remote.updatedAt).toLocaleString()} from ${remote.device}\n`)

  const byDay = new Map<string, Row[]>()
  for (const e of entries) {
    const list = byDay.get(e.date) ?? []
    list.push(e)
    byDay.set(e.date, list)
  }

  console.log(`  ${entries.length} food entries across ${byDay.size} days`)
  console.log(`  ${weighIns.length} weigh-ins`)
  console.log(`  ${(data.workouts ?? []).length} sessions · ${(data.foods ?? []).length} foods in the library\n`)

  if (byDay.size) {
    console.log('  day          kcal   protein   carbs    fat   protein%')
    console.log('  ----------  -----   -------   -----   ----   --------')
    for (const [date, rows] of [...byDay].sort().slice(-14)) {
      const kcal = sum(rows.map((r) => r.kcal ?? 0))
      const p = sum(rows.map((r) => r.protein ?? 0))
      const c = sum(rows.map((r) => r.carbs ?? 0))
      const f = sum(rows.map((r) => r.fat ?? 0))
      const pct = kcal ? ((p * 4) / kcal) * 100 : 0
      console.log(
        `  ${date}  ${kcal.toFixed(0).padStart(5)}   ${p.toFixed(0).padStart(7)}   ${c.toFixed(0).padStart(5)}   ${f.toFixed(0).padStart(4)}   ${pct.toFixed(0).padStart(7)}%`,
      )
    }

    const days = [...byDay.values()].filter((rows) => sum(rows.map((r) => r.kcal ?? 0)) > 200)
    const kcals = days.map((rows) => sum(rows.map((r) => r.kcal ?? 0)))
    const prots = days.map((rows) => sum(rows.map((r) => r.protein ?? 0)))
    console.log(
      `\n  average over ${days.length} logged days: ${avg(kcals).toFixed(0)} kcal, ` +
        `${avg(prots).toFixed(0)} g protein (${((avg(prots) * 4) / avg(kcals) * 100).toFixed(0)}% of calories)`,
    )
  }

  if (weighIns.length) {
    const sorted = [...weighIns].sort((a, b) => a.date.localeCompare(b.date))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    console.log(
      `\n  weight: ${first.kg} kg on ${first.date} -> ${last.kg} kg on ${last.date}` +
        (last.bodyFatPct != null ? ` · body fat ${last.bodyFatPct}%` : ''),
    )
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e))
  process.exit(1)
})
