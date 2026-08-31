import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'
setApiBase('https://salutt.montejongas.com')
const phrase=/```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL('../SECRETS.local.md',import.meta.url),'utf8'))![1]
const d:any=(await fetchRemote(phrase))?.backup?.data ?? {}
const E=d.entries??[]
const by:Record<string,{k:number,p:number,c:number,f:number,fi:number}>={}
for(const e of E){const b=(by[e.date] ??= {k:0,p:0,c:0,f:0,fi:0})
  b.k+=e.kcal||0; b.p+=e.protein||0; b.c+=e.carbs||0; b.f+=e.fat||0; b.fi+=e.fiber||0}
const days=Object.keys(by).sort()
console.log('date         kcal   P     C     F    fibre   P g/kg')
for(const dt of days.slice(-14)){const b=by[dt]
  console.log(`${dt}  ${b.k.toFixed(0).padStart(4)}  ${b.p.toFixed(0).padStart(3)}  ${b.c.toFixed(0).padStart(4)}  ${b.f.toFixed(0).padStart(3)}   ${b.fi.toFixed(0).padStart(3)}    ${(b.p/67.8).toFixed(2)}`)}
const done=days.filter(x=>x<'2026-08-30')
const last7=done.slice(-7), last14=done.slice(-14)
const avg=(ds:string[],k:keyof typeof by[string])=>ds.reduce((s,x)=>s+by[x][k],0)/ds.length
console.log(`\nCOMPLETED DAYS ONLY`)
console.log(`  last 7  : ${avg(last7,'k').toFixed(0)} kcal, ${avg(last7,'p').toFixed(0)} g protein (${(avg(last7,'p')/67.8).toFixed(2)} g/kg), ${avg(last7,'f').toFixed(0)} g fat, ${avg(last7,'fi').toFixed(0)} g fibre`)
console.log(`  last 14 : ${avg(last14,'k').toFixed(0)} kcal, ${avg(last14,'p').toFixed(0)} g protein (${(avg(last14,'p')/67.8).toFixed(2)} g/kg)`)
console.log(`\n  fat as % of kcal, last 7: ${(avg(last7,'f')*9/avg(last7,'k')*100).toFixed(0)}%`)
console.log(`  days at or above 1850: ${done.filter(x=>by[x].k>=1850).length} of ${done.length}`)
console.log(`  days below 1700     : ${done.filter(x=>by[x].k<1700).length} of ${done.length}`)
