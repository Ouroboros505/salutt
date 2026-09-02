import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'
import { weightTrend, adaptiveTDEE, usualActivity, dayEnergy } from '../src/lib/metrics'
setApiBase('https://salutt.montejongas.com')
const phrase=/```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL('../SECRETS.local.md',import.meta.url),'utf8'))![1]
const d:any=(await fetchRemote(phrase))?.backup?.data ?? {}
const st=(d.settings??[])[0]
const t=weightTrend(d.weighIns??[],7)
const kg=t[t.length-1].trend
const tdee=adaptiveTDEE(d.entries??[],t)!
const usual=usualActivity(d.workouts??[],'2026-09-02')!
const byDay:Record<string,number>={}
for(const e of d.entries??[]) byDay[e.date]=(byDay[e.date]||0)+(e.kcal||0)
const done=Object.keys(byDay).filter(x=>byDay[x]>200&&x<'2026-09-02')
const mean=done.reduce((s,x)=>s+byDay[x],0)/done.length
const e=dayEnergy(st,kg,mean,usual.mean,tdee.kcal,usual,mean)
console.log('YOUR AVERAGE DAY, DECOMPOSED')
console.log(`  BMR (just existing)        ${e.bmr}`)
console.log(`  digesting food             ${e.digestion}`)
console.log(`  everyday movement (NEAT)   ${e.rest}`)
console.log(`  logged training + rides    ${Math.round(usual.mean)}`)
console.log(`  ${'-'.repeat(38)}`)
console.log(`  total maintenance          ${e.total}`)
console.log(`\nSEDENTARY maintenance (no training, no rides): ${e.bmr+e.digestion+e.rest}`)
console.log(`  -> that is what a true couch day costs`)
console.log(`\nAT GOAL WEIGHT, same habits:`)
for(const w of [64,62,60]){
  const e2=dayEnergy(st,w,mean,usual.mean,tdee.kcal,usual,mean)
  console.log(`  ${w} kg: BMR ${e2.bmr}, total ~${e2.total}  (sedentary ~${e2.bmr+e2.digestion+e2.rest})`)
}
