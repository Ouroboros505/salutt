import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { planRoute, NoSyncError, type PlannedRoute } from '../lib/maps'
import { Icon, Sheet } from './ui'
import PlacesSheet from './PlacesSheet'

/**
 * Plan a new route once, from two saved places, and keep it.
 *
 * The whole reason this exists is to spend a routing call exactly once per
 * journey: measure House → the new restaurant today, save it, and every ride
 * there afterwards is a tap with a real distance and a real climb behind it.
 * The daily flow never comes here — it picks a saved route and goes. This is
 * the setup step, which is why it sits at the bottom of the ride sheet.
 */
export default function RoutePlannerSheet({
  onClose,
  toast,
}: {
  onClose: () => void
  toast: (m: string) => void
}) {
  const places = useLiveQuery(() => db.places.orderBy('name').toArray(), []) ?? []
  const [fromId, setFromId] = useState<number | null>(null)
  const [toId, setToId] = useState<number | null>(null)
  const [result, setResult] = useState<PlannedRoute | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [managing, setManaging] = useState(false)

  const from = places.find((p) => p.id === fromId)
  const to = places.find((p) => p.id === toId)

  const measure = async () => {
    if (!from || !to) return
    setBusy(true)
    setResult(null)
    try {
      const r = await planRoute({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng })
      if (!r) {
        toast('No route found between those places')
        return
      }
      setResult(r)
      setName(`${from.name} → ${to.name}`)
      if (r.mode === 'driving') toast('No cycling route there — showing the driving distance')
    } catch (e) {
      toast(e instanceof NoSyncError ? 'Set up sync first (Settings) to plan routes' : 'Route lookup failed')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!result || !from || !to) return
    await db.routes.add({
      name: name.trim() || `${from.name} → ${to.name}`,
      km: result.km,
      // Google's time is a generic pace; your own rides overwrite it once you
      // ride this and the ride sheet updates the stored minutes.
      minutes: result.minutes,
      climbM: result.climbM,
      fromPlaceId: from.id,
      toPlaceId: to.id,
      source: 'google',
      polyline: result.polyline,
      useCount: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    })
    // Nudge the places up the used-order so the pair is easy to pick again.
    await db.places.update(from.id!, { useCount: from.useCount + 1, lastUsed: Date.now() })
    await db.places.update(to.id!, { useCount: to.useCount + 1, lastUsed: Date.now() })
    toast(`${name.trim() || 'Route'} saved — ${result.km} km`)
    onClose()
  }

  const picker = (selected: number | null, set: (id: number) => void, exclude: number | null) => (
    <div className="scroll-x">
      {places
        .filter((p) => p.id !== exclude)
        .map((p) => (
          <button
            key={p.id}
            className="chip"
            aria-pressed={selected === p.id}
            onClick={() => {
              set(p.id!)
              setResult(null)
            }}
          >
            {p.name}
          </button>
        ))}
    </div>
  )

  if (managing) return <PlacesSheet onClose={() => setManaging(false)} toast={toast} />

  return (
    <Sheet title="Plan a route" onClose={onClose}>
      {places.length < 2 ? (
        <div className="card">
          <div className="small">
            Save at least two places first — a start and a destination — then measure the ride
            between them.
          </div>
          <button className="btn primary block" onClick={() => setManaging(true)}>
            <Icon.plus /> Add places
          </button>
        </div>
      ) : (
        <>
          <label className="tiny muted">From</label>
          {picker(fromId, setFromId, toId)}
          <label className="tiny muted" style={{ marginTop: 8 }}>
            To
          </label>
          {picker(toId, setToId, fromId)}

          <button
            className="btn primary block"
            disabled={!from || !to || busy}
            onClick={measure}
            style={{ marginTop: 12 }}
          >
            {busy ? 'Measuring…' : 'Get distance & climb'}
          </button>

          {result && (
            <div className="card">
              <div className="row between">
                <span className="stat-label">
                  {result.km} km · {result.minutes} min
                  {result.climbM != null ? ` · climb ${result.climbM} m` : ''}
                </span>
                {result.mode === 'driving' && <span className="tiny muted">driving est.</span>}
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button className="btn primary block" onClick={save}>
                <Icon.check /> Save route
              </button>
            </div>
          )}

          <button className="btn ghost block muted" onClick={() => setManaging(true)}>
            Manage places
          </button>
        </>
      )}
    </Sheet>
  )
}
