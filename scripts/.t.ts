import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'
setApiBase('https://salutt.montejongas.com')
const phrase=/```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL('../SECRETS.local.md',import.meta.url),'utf8'))![1]
const d:any=(await fetchRemote(phrase))?.backup?.data ?? {}
const T='2026-08-28'
const es=(d.entries??[]).filter((e:any)=>e.date===T).sort((a:any,b:any)=>(a.createdAt||0)-(b.createdAt||0))
let P=0,F=0,Fi=0,K=0
console.log(`FOOD ${T}:`)
for(const e of es){
  const t=e.createdAt?new Date(e.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'--:--'
  console.log(`  ${t} ${e.name} ${e.amountLabel||e.grams+'g'} | ${Math.round(e.kcal)}k fib${e.fiber?.toFixed(1)}`)
  P+=e.protein||0;F+=e.fat||0;Fi+=e.fiber||0;K+=e.kcal||0
}
console.log(`\nTOTALS ${Math.round(K)} kcal · P${P.toFixed(0)} F${F.toFixed(0)} fibre ${Fi.toFixed(1)}`)
