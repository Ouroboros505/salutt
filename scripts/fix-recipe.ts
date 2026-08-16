/**
 * One-off: corrects the ingredients in a synced recipe and pushes it back.
 *
 * The matcher put a bag of crisps in a braise and picked the trimmed cut for
 * an untrimmed joint, and two spices were added at the picker's default 100 g.
 * The code paths that caused each are fixed, but the recipe already saved
 * still carries the results, and it is only reachable from here.
 *
 *   npm run fix-recipe -- --dry     show the diff, change nothing
 *   npm run fix-recipe              write it back
 */
import { readFileSync } from 'node:fs'
import { fetchRemote, pushPayload, setApiBase } from '../src/lib/syncCrypto'

const SITE = process.env.SALUTT_URL ?? 'https://salutt.montejongas.com'
const DRY = process.argv.includes('--dry')

function secret(): string {
  const text = readFileSync(new URL('../SECRETS.local.md', import.meta.url), 'utf8')
  const m = /```\n([a-z0-9-]+)\n```/.exec(text)
  if (!m) throw new Error('no recovery phrase in SECRETS.local.md')
  return m[1]
}

/** name match -> replacement macros per 100 g, and the weight to use. */
const FIXES: Record<string, { name: string; grams: number; per100: number[] }> = {
  Krinkle: {
    // A braising cut, raw, weighed raw like everything else here.
    name: 'Beef, chuck for stew, separable lean and fat, all grades, raw',
    grams: 454,
    per100: [128, 21.8, 0.16, 4.48, 0],
  },
  'separable lean only, raw': {
    // Cooked whole, untrimmed. Raw figures, because the recipe is raw weights.
    name: 'Pork, fresh, shoulder, (Boston butt), blade (steaks), separable lean and fat, raw',
    grams: 1361,
    per100: [186, 17.4, 0, 12.4, 0],
  },
  'cumin seed': { name: 'Spices, cumin seed', grams: 4.2, per100: [375, 17.8, 44.2, 22.3, 10.5] },
  'thyme, dried': { name: 'Spices, thyme, dried', grams: 2, per100: [276, 9.11, 63.9, 7.43, 37] },
}

const KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const

async function main() {
  setApiBase(SITE)
  const remote = await fetchRemote(secret())
  if (!remote) throw new Error('nothing stored on the server')
  const backup = remote.backup as { data: Record<string, any[]>; counts: Record<string, number>; exportedAt: string }
  const recipes = backup.data.recipes ?? []
  if (!recipes.length) throw new Error('no recipes in the stored copy')

  for (const recipe of recipes) {
    for (const item of recipe.items) {
      const key = Object.keys(FIXES).find((k) => item.name.includes(k))
      if (!key) continue
      const fix = FIXES[key]
      const before = `${item.grams} g ${item.name.slice(0, 44)} = ${Math.round(item.kcal)} kcal`
      item.name = fix.name
      item.grams = fix.grams
      // Items store the totals for their own weight, like a log entry does.
      KEYS.forEach((k, i) => {
        item[k] = Math.round(((fix.per100[i] * fix.grams) / 100) * 10) / 10
      })
      console.log(`  ${before}\n  -> ${item.grams} g ${item.name.slice(0, 44)} = ${Math.round(item.kcal)} kcal\n`)
    }
    // Nothing was weighed after cooking, and nothing will be. A covered pot
    // loses only what evaporates, so the raw total less that is the dish.
    if (!recipe.cookedG) recipe.cookLossPct = 8
    if (!recipe.density) recipe.density = 1.03
    if (!recipe.containerMl) recipe.containerMl = 750
    const kcal = recipe.items.reduce((t: number, i: any) => t + i.kcal, 0)
    const protein = recipe.items.reduce((t: number, i: any) => t + i.protein, 0)
    const grams = recipe.items.reduce((t: number, i: any) => t + i.grams, 0)
    console.log(`  ${recipe.name}: ${Math.round(grams)} g raw, ${Math.round(kcal)} kcal, P${Math.round(protein)}`)
  }

  if (DRY) {
    console.log('\n--dry, nothing written')
    return
  }
  backup.exportedAt = new Date().toISOString()
  const res = await pushPayload(secret(), backup)
  console.log('\npushed:', JSON.stringify(res))
}

void main()
