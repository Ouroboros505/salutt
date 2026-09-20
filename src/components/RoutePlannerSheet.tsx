import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { geocode, geoDoubt, planRoute, NoSyncError, type PlannedRoute } from '../lib/maps'
import { Field, Icon, Sheet } from './ui'
import PlacesSheet from './PlacesSheet'

/**
 * Plan a new route once and keep it.
 *
 * The start is always a saved place. The destination can be a saved place too,
 * or a brand-new address typed right here — which is the common case, since a
 * new route usually means a new somewhere (a friend's, a restaurant). Typing it
 * geocodes and saves it as a place in the same step, so "ride to Deb's" is one
 * flow, not "first go and add Deb's, then come back and plan it".
 *
 * The daily flow never comes here — it picks a saved route and goes. This is
 * setup, which is why it lives at the bottom of the ride sheet.
 */
const NEW = '__new__'

export default function RoutePlannerSheet({
  onClose,
  toast,
}: {
  onClose: () => void
  toast: (m: string) => void
}) {
  const places = useLiveQuery(() => db.places.orderBy('name').toArray(), []) ?? []
  const [fromId, setFromId] = useState<number | null>(null)
  // The destination is either a saved place id, or the sentinel NEW to type one.
  const [toChoice, setToChoice] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')

  // Every route Google offered, and which one he picked. Google's own order
  // is best-first, so index 0 is the default until he says otherwise.
  const [options, setOptions] = useState<PlannedRoute[] | null>(null)
  const [picked, setPicked] = useState(0)
  const result = options ? (options[picked] ?? options[0]) : null
  const [routeName, setRouteName] = useState('')
  const [busy, setBusy] = useState(false)
  const [managing, setManaging] = useState(false)

  const from = places.find((p) => p.id === fromId)
  const savedTo = toChoice && toChoice !== NEW ? places.find((p) => p.id === Number(toChoice)) : undefined
  const addingNew = toChoice === NEW

  const canMeasure =
    !!from && (savedTo ? true : addingNew ? newName.trim() !== '' && newAddress.trim() !== '' : false)

  const measure = async () => {
    if (!from) return
    setBusy(true)
    setOptions(null)
    setPicked(0)
    try {
      // Resolve the destination: an existing place, or geocode + save a new one.
      let toPlace = savedTo
      let toName = savedTo?.name ?? ''
      if (addingNew) {
        const g = await geocode(newAddress.trim())
        if (!g) {
          toast(`Couldn't find "${newAddress.trim()}"`)
          return
        }
        // The same guard the places sheet uses: a street centroid saved here
        // would give every future ride to this place a plausible wrong length.
        const doubt = geoDoubt(g)
        if (doubt) {
          toast(`${doubt} Google found: ${g.formatted}`)
          return
        }
        const id = await db.places.add({
          name: newName.trim(),
          address: newAddress.trim(),
          formatted: g.formatted,
          lat: g.lat,
          lng: g.lng,
          useCount: 0,
          lastUsed: Date.now(),
          createdAt: Date.now(),
        })
        toPlace = { id: id as number, name: newName.trim(), address: newAddress.trim(), formatted: g.formatted, lat: g.lat, lng: g.lng, useCount: 0, lastUsed: Date.now(), createdAt: Date.now() }
        toName = newName.trim()
        // Keep it selected as a saved place now that it exists.
        setToChoice(String(id))
        setNewName('')
        setNewAddress('')
      }
      if (!toPlace) return

      const rs = await planRoute({ lat: from.lat, lng: from.lng }, { lat: toPlace.lat, lng: toPlace.lng })
      if (!rs?.length) {
        toast('No route found between those places')
        return
      }
      setOptions(rs)
      setPicked(0)
      setRouteName(`${from.name} → ${toName}`)
      if (rs[0].mode === 'driving') toast('No cycling route there — showing the driving distance')
    } catch (e) {
      toast(e instanceof NoSyncError ? 'Set up sync first (Settings) to plan routes' : 'Route lookup failed')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!result || !from) return
    const toPlace = places.find((p) => p.id === Number(toChoice))
    await db.routes.add({
      name: routeName.trim() || `${from.name} → ${toPlace?.name ?? ''}`,
      km: result.km,
      minutes: result.minutes,
      climbM: result.climbM,
      fromPlaceId: from.id,
      toPlaceId: toPlace?.id,
      source: 'google',
      polyline: result.polyline,
      useCount: 0,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    })
    await db.places.update(from.id!, { useCount: from.useCount + 1, lastUsed: Date.now() })
    if (toPlace?.id) await db.places.update(toPlace.id, { useCount: toPlace.useCount + 1, lastUsed: Date.now() })
    toast(`${routeName.trim() || 'Route'} saved — ${result.km} km`)
    onClose()
  }

  if (managing) return <PlacesSheet onClose={() => setManaging(false)} toast={toast} />

  return (
    <Sheet title="Plan a route" onClose={onClose}>
      {places.length === 0 ? (
        <div className="card">
          <div className="small">Save a starting place first — your house, say — then plan rides from it.</div>
          <button className="btn primary block" onClick={() => setManaging(true)}>
            <Icon.plus /> Add places
          </button>
        </div>
      ) : (
        <>
          <Field label="From">
            <select
              value={fromId ?? ''}
              onChange={(e) => {
                setFromId(e.target.value ? Number(e.target.value) : null)
                setOptions(null)
              }}
            >
              <option value="">Choose a starting place…</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="To">
            <select
              value={toChoice}
              onChange={(e) => {
                setToChoice(e.target.value)
                setOptions(null)
              }}
            >
              <option value="">Choose a destination…</option>
              {places
                .filter((p) => p.id !== fromId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              <option value={NEW}>＋ New address…</option>
            </select>
          </Field>

          {addingNew && (
            <div className="card tight">
              <Field label="Name it" hint="what you'll call this place — Deb's, the gym, work">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Deb's" />
              </Field>
              <Field label="Address" hint="street and city — saved so you never type it again">
                <input
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="1200 Main St, Lafayette, IN"
                />
              </Field>
            </div>
          )}

          <button className="btn primary block" disabled={!canMeasure || busy} onClick={measure}>
            {busy ? 'Measuring…' : addingNew ? 'Save place & measure' : 'Get distance & climb'}
          </button>

          {options && result && (
            <div className="card">
              {options.length > 1 && (
                <>
                  <div className="stat-label">
                    {options.length} ways to ride it — pick the one you actually take
                  </div>
                  <div className="stack tight">
                    {options.map((o, i) => (
                      <button
                        key={i}
                        className={`btn block ${i === picked ? 'primary' : ''}`}
                        onClick={() => setPicked(i)}
                      >
                        <span className="num">
                          {o.km} km · {o.minutes} min
                          {o.climbM != null ? ` · ↑${o.climbM} m` : ''}
                        </span>
                        {o.summary ? <span className="tiny muted"> via {o.summary}</span> : null}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="row between">
                <span className="stat-label">
                  {result.km} km · {result.minutes} min
                  {result.climbM != null ? ` · climb ${result.climbM} m` : ''}
                  {result.summary ? ` · via ${result.summary}` : ''}
                </span>
                {result.mode === 'driving' && <span className="tiny muted">driving est.</span>}
              </div>
              <Field label="Route name">
                <input value={routeName} onChange={(e) => setRouteName(e.target.value)} />
              </Field>
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
