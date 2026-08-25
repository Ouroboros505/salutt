import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'
import { byName, canonicalName, WEEK } from '../src/lib/program'
setApiBase('https://salutt.montejongas.com')
const phrase=/```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL('../SECRETS.local.md',import.meta.url),'utf8'))![1]
const d:any=(await fetchRemote(phrase))?.backup?.data ?? {}
const ws=(d.workouts??[]).filter((w:any)=>w.kind!=='ride')

// every name ever logged
const logged=new Map<string,string[]>()
for(const w of ws) for(const s of w.sets){
  if(!logged.has(s.exercise)) logged.set(s.exercise,[])
  logged.get(s.exercise)!.push(w.date)
}
// every name the current plan asks for
const planned=new Set<string>()
for(const day of WEEK) for(const n of day.exercises) planned.add(n)

console.log('=== A. LOGGED NAMES NOT IN THE CATALOGUE (orphans) ===')
let orphan=0
for(const [name,dates] of [...logged].sort()){
  if(!byName(name)){ console.log(`  ✗ "${name}"  logged ${dates.length}x (${dates[0]}..)`); orphan++ }
}
if(!orphan) console.log('  none — every logged name resolves')

console.log('\n=== B. PLANNED NAMES WITH NO MATCHING HISTORY (would show no "last time") ===')
const canonLogged=new Set([...logged.keys()].map(canonicalName))
let miss=0
for(const n of [...planned].sort()){
  if(!canonLogged.has(canonicalName(n))){ console.log(`  – "${n}"  (never logged yet — expected if new)`); miss++ }
}
if(!miss) console.log('  none')

console.log('\n=== C. NAMES THAT DIFFER ONLY BY RENAME (the bug class) ===')
for(const [name] of logged){
  const c=canonicalName(name)
  if(c!==name) console.log(`  ↪ logged "${name}" -> now "${c}"  ${planned.has(c)?'(in current plan ✓ fixed)':'(not in plan)'}`)
}

console.log('\n=== D. NEAR-MISS names (same words, different punctuation/case) — silent orphans ===')
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'')
const planNorm=new Map([...planned].map(n=>[norm(n),n]))
for(const [name] of logged){
  const c=canonicalName(name)
  if(planned.has(c)) continue
  const hit=planNorm.get(norm(c))
  if(hit) console.log(`  ⚠ logged "${name}" ~ plan "${hit}" (differs only in punctuation/case!)`)
}
