/**
 * The real Google Maps usage, straight from the horse's mouth.
 *
 * `npm run usage`. Authenticates as the salutt-usage-reader service account
 * (Monitoring Viewer only — it can read metrics and nothing else) and pulls the
 * exact per-API request counts Google itself recorded, then prices them at the
 * real published rate. This is Google's own count, not the app's KV tally, and
 * unlike a Maps API key it can actually see usage.
 *
 * Needs gcp-usage-sa.json in the project root (gitignored). The dollar figure
 * is list price before Google's monthly free tier, so the amount actually
 * charged is lower — usually zero.
 */
import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

const sa = JSON.parse(readFileSync(new URL('../gcp-usage-sa.json', import.meta.url),'utf8'))
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')

// --- sign a JWT and exchange it for an access token ---
async function accessToken() {
  const now = Math.floor(Date.now()/1000)
  const header = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/monitoring.read',
    aud: sa.token_uri,
    iat: now, exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${claim}`); signer.end()
  const sig = b64url(signer.sign(sa.private_key))
  const jwt = `${header}.${claim}.${sig}`
  const res = await fetch(sa.token_uri, {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('token: '+JSON.stringify(j))
  return j.access_token
}

// --- query request_count per API service over the last N days ---
async function usage(days=35) {
  const token = await accessToken()
  const end = new Date()
  const start = new Date(end.getTime() - days*86400*1000)
  const params = new URLSearchParams({
    'filter': 'metric.type="serviceruntime.googleapis.com/api/request_count"',
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    'aggregation.groupByFields': 'resource.label."service"',
    'view': 'FULL',
  })
  const url = `https://monitoring.googleapis.com/v3/projects/${sa.project_id}/timeSeries?${params}`
  const res = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } })
  const j = await res.json()
  if (j.error) throw new Error('monitoring: '+JSON.stringify(j.error))
  const totals = {}
  for (const ts of j.timeSeries ?? []) {
    const svc = ts.resource?.labels?.service ?? 'unknown'
    let sum = 0
    for (const p of ts.points ?? []) sum += Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0)
    totals[svc] = (totals[svc] ?? 0) + sum
  }
  return totals
}

const PRICE = { // real Google Maps published rate, basic tier: $5 per 1,000
  'geocoding-backend.googleapis.com': 0.005,
  'directions-backend.googleapis.com': 0.005,
  'elevation-backend.googleapis.com': 0.005,
}
const t = await usage()
console.log('REAL request counts (Google Monitoring, last 35 days):')
let mapsCalls = 0, mapsCost = 0
for (const [svc,n] of Object.entries(t).sort((a,b)=>b[1]-a[1])) {
  const isMaps = svc in PRICE
  const cost = isMaps ? n*PRICE[svc] : null
  if (isMaps){ mapsCalls += n; mapsCost += cost }
  console.log(`  ${svc.padEnd(40)} ${String(n).padStart(6)}${cost!=null?`  ~$${cost.toFixed(3)}`:''}`)
}
console.log(`\nMAPS TOTAL: ${mapsCalls} calls  ~$${mapsCost.toFixed(3)}  (real Google prices, before free tier)`)
