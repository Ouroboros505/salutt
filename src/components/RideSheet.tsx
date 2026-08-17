import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ISODate, type Route } from '../db/db'
import { RIDE_EFFORTS, RIDE_PLACES, metFromSpeed, rideKcal } from '../lib/ride'
import { Field, Icon, NumberInput, Sheet } from './ui'

/**
 * Logging one trip.
 *
 * Transport is irregular in a way a daily default cannot capture — campus some
 * days, across town other days, nothing on others — so each ride is entered on
 * its own. The friction that matters is naming the thing, which is why the
 * places you actually ride to are buttons.
 */
export default function RideSheet({
  date,
  kg,
  onClose,
  toast,
}: {
  date: ISODate
  /** Body weight, since the energy cost scales with what is being moved. */
  kg: number
  onClose: () => void
  toast: (m: string) => void
}) {
  const [place, setPlace] = useState('')
  const [minutes, setMinutes] = useState<number | undefined>(15)
  const [km, setKm] = useState<number | undefined>(undefined)
  const [effort, setEffort] = useState(RIDE_EFFORTS[1])
  // One way by default: the ride home is rarely the ride out. A full
  // backpack, a different route, a headwind, or simply being tired all make
  // the return leg its own trip, and logging it as one keeps the speed — and
  // so the energy — honest for each direction.
  const [returnTrip, setReturnTrip] = useState(false)

  // The journeys you actually make, most-used first. A distance looked up
  // once on a map is worth keeping forever.
  const routes = useLiveQuery(() => db.routes.orderBy('lastUsed').reverse().toArray(), []) ?? []
  const [routeId, setRouteId] = useState<number | null>(null)

  const pick = (r: Route) => {
    setPlace(r.name)
    setKm(r.km)
    setMinutes(r.minutes)
    setRouteId(r.id ?? null)
  }

  const known = routes.find((r) => r.name.toLowerCase() === place.trim().toLowerCase())
  const worthSaving = place.trim() !== '' && !!km && !!minutes && !known

  const legs = returnTrip ? 2 : 1
  const totalMin = (minutes ?? 0) * legs
  // Distance and time give a speed, and a speed is a measurement where "how
  // hard did it feel" is a guess. Used in preference when both are there.
  const fromSpeed = metFromSpeed(km ?? 0, minutes ?? 0)
  const met = fromSpeed?.met ?? effort.met
  const kcal = rideKcal(met, kg, totalMin)

  return (
    <Sheet title="Log a ride" onClose={onClose}>
      {routes.length > 0 && (
        <div className="scroll-x">
          {routes.map((r) => (
            <button key={r.id} className="chip" aria-pressed={routeId === r.id} onClick={() => pick(r)}>
              {r.name} <span className="muted num">{r.km} km</span>
            </button>
          ))}
        </div>
      )}

      <Field label="Where to">
        <input
          autoFocus
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Campus, the shops, a friend's…"
        />
      </Field>
      {routes.length === 0 && (
        <div className="scroll-x">
          {RIDE_PLACES.map((p) => (
            <button key={p} className="chip" aria-pressed={place === p} onClick={() => setPlace(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="grid-2">
        <Field label="Time" hint="what it actually took, this trip">
          <NumberInput value={minutes} unit="min" onChange={setMinutes} />
        </Field>
        <Field label="Distance" hint="optional">
          <NumberInput value={km} unit="km" onChange={setKm} />
        </Field>
      </div>

      <div className="scroll-x">
        <button className="chip" aria-pressed={!returnTrip} onClick={() => setReturnTrip(false)}>
          One way
        </button>
        <button className="chip" aria-pressed={returnTrip} onClick={() => setReturnTrip(true)}>
          There and back
        </button>
      </div>
      <div className="tiny muted num">
        {returnTrip
          ? `counts ${totalMin} min — only if both legs were much the same`
          : 'log the way back separately if it was different — heavier, slower, another route'}
      </div>

      {fromSpeed ? (
        <div className="tiny muted num">
          {fromSpeed.kmh} km/h from the distance and time → {fromSpeed.met} MET, mountain bike.
          Measured, so the effort guess below is not needed.
        </div>
      ) : (
        <>
          <Field label="How hard">
            <div className="scroll-x">
              {RIDE_EFFORTS.map((e) => (
                <button
                  key={e.label}
                  className="chip"
                  aria-pressed={effort.label === e.label}
                  onClick={() => setEffort(e)}
                  title={e.hint}
                >
                  {e.label} <span className="muted num">{e.met} MET</span>
                </button>
              ))}
            </div>
          </Field>
          <div className="tiny muted">
            {effort.hint}. Add the distance and this becomes a speed instead of a guess.
          </div>
        </>
      )}

      {worthSaving && (
        <button
          className="btn block"
          onClick={async () => {
            const id = await db.routes.add({
              name: place.trim(),
              km: km!,
              minutes: minutes!,
              useCount: 0,
              lastUsed: Date.now(),
              createdAt: Date.now(),
            })
            setRouteId(id as number)
            toast(`${place.trim()} saved — ${km} km`)
          }}
        >
          <Icon.plus /> Save “{place.trim()}” as a route, {km} km
        </button>
      )}

      <div className="card tight">
        <div className="row between">
          <span className="stat-label">
            {totalMin} min{km ? ` · ${(km * legs).toFixed(1)} km` : ''}
          </span>
          <span className="stat-value num">{kcal} kcal</span>
        </div>
        <div className="tiny muted">
          Not added to today's target. The target comes from what you eat measured against your
          weight trend, and that was measured while you were already riding everywhere — adding it
          back would count it twice and cancel the deficit.
        </div>
      </div>

      <button
        className="btn primary block"
        disabled={!totalMin}
        onClick={async () => {
          await db.workouts.add({
            date,
            kind: 'ride',
            name: place.trim() ? `Ride — ${place.trim()}` : 'Ride',
            durationMin: totalMin,
            distanceKm: km ? Math.round(km * legs * 10) / 10 : undefined,
            kcal,
            sets: [],
            createdAt: Date.now(),
          })
          // Keep the route ordered by what you actually ride, and let its
          // stored time follow the last real one rather than an old guess.
          if (routeId) {
            const r = await db.routes.get(routeId)
            if (r) {
              await db.routes.update(routeId, {
                useCount: r.useCount + 1,
                lastUsed: Date.now(),
                minutes: minutes ?? r.minutes,
                km: km ?? r.km,
              })
            }
          }
          toast(`${totalMin} min logged`)
          onClose()
        }}
      >
        Log {totalMin} min
      </button>
    </Sheet>
  )
}
