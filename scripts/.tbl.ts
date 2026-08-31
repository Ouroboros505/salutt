import { WEEK, byName, sessionMinutes } from '../src/lib/program'
const D=['Sun','Monday','Tuesday','Wednesday','Thursday','Friday','Sat']
const work=(ns:string[])=>ns.reduce((s,n)=>{const e=byName(n);return s+(e?e.sets*e.secPerSet:0)},0)/60
for(const d of WEEK){
  console.log(`\n### ${D[d.weekday]} — ${d.name}  (${sessionMinutes(work(d.exercises),d.exercises.length)} min)\n`)
  console.log('| Exercise | Sets | Reps |')
  console.log('|---|---|---|')
  for(const n of d.exercises){const e=byName(n)!
    const sets = e.byMinutes ? '—' : String(e.sets)
    const reps = e.byMinutes ? `${e.sets} min` : e.reps
    console.log(`| ${n} | ${sets} | ${reps} |`)}
}
