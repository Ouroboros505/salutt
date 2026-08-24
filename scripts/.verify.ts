import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'
import { weightTrend, progressSoFar, trendSlopeKgPerWeek } from '../src/lib/metrics'
setApiBase('https://salutt.montejongas.com')
const phrase=/```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL('../SECRETS.local.md',import.meta.url),'utf8'))![1]
const d:any=(await fetchRemote(phrase))?.backup?.data ?? {}
const settings=(d.settings??[])[0]??{}
const t=weightTrend(d.weighIns??[], settings.trendHalfLifeDays ?? 7)
console.log('trend now uses', t.length, 'readings (contaminated ones excluded):')
for(const p of t) console.log(`  ${p.date}  raw ${p.raw}  trend ${p.trend.toFixed(3)}`)
const pr=progressSoFar(t)!
console.log('\nPROGRESS CARD:')
console.log(`  ${pr.fromKg.toFixed(2)} -> ${pr.toKg.toFixed(2)} kg`)
console.log(`  change: ${(pr.changeKg*1000).toFixed(0)} g over ${pr.days} days  (settled: ${pr.settled})`)
console.log(`  rate: ${((pr.changeKg/pr.days)*7).toFixed(2)} kg/week`)
console.log('\ntrend weight shown on Body:', t[t.length-1].trend.toFixed(1))
console.log('slope kg/wk:', trendSlopeKgPerWeek(t)?.toFixed(3))
