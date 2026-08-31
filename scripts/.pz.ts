import { readFileSync } from 'node:fs'
import { fetchRemote, setApiBase } from '../src/lib/syncCrypto'
setApiBase('https://salutt.montejongas.com')
const phrase=/```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL('../SECRETS.local.md',import.meta.url),'utf8'))![1]
const d:any=(await fetchRemote(phrase))?.backup?.data ?? {}
for(const f of (d.foods??[]).filter((x:any)=>/popz|sparkling|whey|protein/i.test(x.name)))
  console.log(`${f.name} (${f.brand??'-'}): ${f.kcal} kcal, ${f.protein} P per 100  -> ${(f.protein*4/f.kcal*100).toFixed(0)}% protein cals  portions=${JSON.stringify(f.portions)}`)
