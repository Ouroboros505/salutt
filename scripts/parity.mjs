/**
 * Both ways of doing the same thing must offer the same things.
 *
 * The toilet flag was added to the manual weigh-in form and not to the scale
 * sheet, which is the one actually used — so a question that had been asked
 * for, built and deployed simply did not exist where it mattered. Testing the
 * file I edited would not have caught it; nothing was wrong with that file.
 *
 * What catches it is asking whether every route to the same record offers the
 * same fields. That is what this does, and it runs before every deploy.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(p)) files.push(p)
  }
})('src')

const read = (f) => readFileSync(f, 'utf8')

/** Every route that ends up writing a row, and the fields it must offer. */
const RULES = [
  {
    what: 'a weigh-in',
    // A file is a weigh-in route if it lets you record one.
    routes: (f) => /saveReading\(|db\.weighIns\.put\(/.test(read(f)),
    must: ['afterStool', 'offProtocol'],
  },
  {
    what: 'a food entry',
    routes: (f) => /db\.entries\.add\(|db\.entries\.bulkAdd\(/.test(read(f)),
    must: ['amountLabel', 'fiber'],
  },
]

let bad = 0
for (const rule of RULES) {
  const routes = files.filter(rule.routes)
  console.log(`\n  ${rule.what} — ${routes.length} route${routes.length === 1 ? '' : 's'}`)
  for (const f of routes) {
    const src = read(f)
    const missing = rule.must.filter((k) => !src.includes(k))
    console.log(`    ${missing.length ? 'MISSING ' + missing.join(', ') : 'ok      '}  ${f}`)
    if (missing.length) bad++
  }
}
console.log(bad ? `\n  ${bad} route(s) out of step\n` : '\n  every route offers the same fields\n')
process.exit(bad ? 1 : 0)
