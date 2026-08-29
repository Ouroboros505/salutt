import { PLATE } from '../src/lib/plate'
let n=0
for(const c of PLATE){ console.log(`\n${c.label}  [${c.choices.length}]`); for(const ch of c.choices){n++; console.log(`   ${ch.label.padEnd(36)} ${ch.per100.kcal} kcal`)} }
console.log(`\nTOTAL: ${n} choices, ${PLATE.length} categories`)
const search=(q:string)=>{const s=q.toLowerCase();const o:string[]=[];for(const c of PLATE)for(const ch of c.choices)if(`${ch.label} ${(ch.keywords??[]).join(' ')}`.toLowerCase().includes(s))o.push(ch.label);return o}
console.log('\nSEARCH TESTS:')
for(const q of ['pad thai','tikka masala','sushi','empanada','burrito','ramen','falafel','wings','risotto','bandeja','naan','ceviche','pho'])
  console.log(`  "${q}" -> ${search(q).join(', ')||'(nothing)'}`)
