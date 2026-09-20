import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Place } from '../db/db'
import { geocode, geoDoubt, NoSyncError } from '../lib/maps'
import { Field, Icon, Sheet } from './ui'

/**
 * The address book behind route planning.
 *
 * Each place is a name you choose and an address Google resolves to a point,
 * once. Naming is deliberately free — "House", "Campus", "Mum's", "Restaurant
 * Nine" — because the name is what you pick from later, not the address. The
 * address is kept too, so a place can be re-found if a building moves or you
 * mistyped it the first time.
 */
export default function PlacesSheet({
  onClose,
  toast,
}: {
  onClose: () => void
  toast: (m: string) => void
}) {
  const places = useLiveQuery(() => db.places.orderBy('name').toArray(), []) ?? []
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  // Set when Google answered with something vaguer than a building; cleared
  // when the address is edited, so a retype starts the check over.
  const [warning, setWarning] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const save = async () => {
    const nm = name.trim()
    const addr = address.trim()
    if (!nm || !addr) return
    setBusy(true)
    try {
      const g = await geocode(addr)
      if (!g) {
        toast(`Couldn't find "${addr}"`)
        return
      }
      /**
       * A vague address is worse than none, because it fails quietly.
       * Saving the middle of a street gives every route to that place a
       * plausible, wrong distance forever. Say so and let him retype.
       */
      const doubt = geoDoubt(g)
      if (doubt && !confirmed) {
        setWarning(`${doubt}\n\nGoogle found: ${g.formatted}`)
        setConfirmed(true)
        return
      }
      await db.places.add({
        name: nm,
        address: addr,
        formatted: g.formatted,
        lat: g.lat,
        lng: g.lng,
        useCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now(),
      })
      toast(`${nm} saved`)
      setName('')
      setAddress('')
      setWarning(null)
      setConfirmed(false)
    } catch (e) {
      toast(e instanceof NoSyncError ? 'Set up sync first (Settings) to look up addresses' : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Place) => {
    await db.places.delete(p.id!)
    toast(`${p.name} removed`)
  }

  return (
    <Sheet title="Places" onClose={onClose}>
      {places.length > 0 && (
        <div className="stack">
          {places.map((p) => (
            <div key={p.id} className="card tight">
              <div className="row between">
                <div className="grow">
                  <div className="stat-label">{p.name}</div>
                  <div className="tiny muted truncate">{p.formatted ?? p.address}</div>
                </div>
                <button className="iconbtn" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}>
                  <Icon.trash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <Field label="Name" hint="what you call it — House, Campus, a friend's">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="House" />
        </Field>
        <Field label="Address" hint="house number, street, town and state — all four">
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setWarning(null)
              setConfirmed(false)
            }}
            placeholder="100 Main St, Lafayette, IN"
          />
        </Field>
        {warning && (
          <div className="note-block tiny warn" style={{ whiteSpace: 'pre-line' }}>
            {warning}
          </div>
        )}
        <button className="btn primary block" disabled={busy || !name.trim() || !address.trim()} onClick={save}>
          <Icon.plus /> {busy ? 'Finding…' : warning ? 'Find & save anyway' : 'Find & save'}
        </button>
      </div>
    </Sheet>
  )
}
