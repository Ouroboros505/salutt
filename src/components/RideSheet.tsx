import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type ISODate, type Route } from '../db/db'
import {
  RIDE_EFFORTS,
  RIDE_PLACES,
  STOPS_PER_KM,
  rideEnergy,
  rideKcal,
  type RideStyle,
} from '../lib/ride'
import { Field, Icon, NumberInput, Sheet } from './ui'
import { setLiveRide, clearLiveRide } from '../lib/liveRide'
import RoutePlannerSheet from './RoutePlannerSheet'
import PlacesSheet from './PlacesSheet'
import { mapsUsage, type MapsUsage } from '../lib/maps'
import { adaptiveTDEE, weightTrend } from '../lib/metrics'

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
  bmrPerMin,
  initial,
  onClose,
  toast,
}: {
  date: ISODate
  /** When finishing a timed ride: the route and the measured minutes. */
  initial?: {
    place?: string
    km?: number
    climbM?: number
    loadKg?: number
    routeId?: number | null
    minutes?: number
  }
  /** Body weight, since the energy cost scales with what is being moved. */
  kg: number
  /** Resting cost per minute, which runs whether you pedal or not. */
  bmrPerMin: number
  onClose: () => void
  toast: (m: string) => void
}) {
  const [place, setPlace] = useState(initial?.place ?? '')
  const [minutes, setMinutes] = useState<number | undefined>(initial?.minutes ?? 15)
  const [km, setKm] = useState<number | undefined>(initial?.km)
  const [effort, setEffort] = useState(RIDE_EFFORTS[1])
  // One way by default: the ride home is rarely the ride out. A full
  // backpack, a different route, a headwind, or simply being tired all make
  // the return leg its own trip, and logging it as one keeps the speed — and
  // so the energy — honest for each direction.
  const [returnTrip, setReturnTrip] = useState(false)
  const [style, setStyle] = useState<RideStyle>('commute')
  const [climbM, setClimbM] = useState<number | undefined>(initial?.climbM)
  // Shopping, a laptop, whatever is on your back. It is mass like any other
  // and the rolling resistance and the climbing both scale with it.
  const [loadKg, setLoadKg] = useState<number | undefined>(initial?.loadKg)

  // The journeys you actually make, most-used first. A distance looked up
  // once on a map is worth keeping forever.
  const routes = useLiveQuery(() => db.routes.orderBy('lastUsed').reverse().toArray(), []) ?? []
  const [routeId, setRouteId] = useState<number | null>(initial?.routeId ?? null)
  // The route-planning setup and its cost meter live at the very bottom, out
  // of the daily path. Usage is fetched once and quietly; failing (no sync yet)
  // just hides the line.
  const [planning, setPlanning] = useState(false)
  const [managingPlaces, setManagingPlaces] = useState(false)
  const [usage, setUsage] = useState<MapsUsage | null>(null)
  useEffect(() => {
    let live = true
    mapsUsage()
      .then((u) => live && setUsage(u))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  /**
   * Whether the day's target is anchored to a measured maintenance yet.
   *
   * It decides which of two true things to say below, and they are opposites.
   * Once maintenance has been measured from intake against the weight trend,
   * the unloggable part of the day is solved against it, so logging a ride
   * moves energy between the parts of the estimate and leaves the total alone.
   * Until then the total is built up from a formula, and a logged ride adds to
   * it — which does raise what the day asks you to eat.
   */
  const settings = useLiveQuery(() => db.settings.get('settings'), []) ?? DEFAULT_SETTINGS
  const weighIns = useLiveQuery(() => db.weighIns.orderBy('date').toArray(), []) ?? []
  const entries = useLiveQuery(() => db.entries.toArray(), []) ?? []
  const adaptive = adaptiveTDEE(entries, weightTrend(weighIns, settings.trendHalfLifeDays), undefined, undefined, settings.trips)
  const anchored = !!adaptive && adaptive.confidence !== 'low'

  const pick = (r: Route) => {
    setPlace(r.name)
    setKm(r.km)
    setMinutes(r.minutes)
    setClimbM(r.climbM)
    setLoadKg(r.loadKg)
    setRouteId(r.id ?? null)
  }

  const known = routes.find((r) => r.name.toLowerCase() === place.trim().toLowerCase())
  const worthSaving = place.trim() !== '' && !!km && !!minutes && !known

  const legs = returnTrip ? 2 : 1
  const totalMin = (minutes ?? 0) * legs
  // With a distance the ride can be worked out from mechanics, which is what
  // cycling actually obeys: the work is a force over a distance. Without one,
  // fall back to an effort guess against the clock.
  const physics = rideEnergy(km ?? 0, minutes ?? 0, kg + (loadKg ?? 0), {
    stops: style === 'commute' ? Math.round((km ?? 0) * STOPS_PER_KM) : 0,
    climbM,
    bmrPerMin,
  })
  const kcal = physics ? physics.kcal * legs : rideKcal(effort.met, kg, totalMin)

  return (
    <Sheet title="Log a ride" onClose={onClose}>
      {routes.length > 0 && (
        <Field label="Saved route" hint="pick one and the distance, climb and last time fill in">
          <select
            value={routeId ?? ''}
            onChange={(e) => {
              const r = routes.find((x) => x.id === Number(e.target.value))
              if (r) pick(r)
              else setRouteId(null)
            }}
          >
            <option value="">Pick a saved route…</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.km} km
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={routes.length ? 'Or a quick one-off' : 'Where to'} hint={routes.length ? 'a ride with no saved route — just give it a label' : undefined}>
        <input
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

      {physics ? (
        <>
          <div className="scroll-x">
            <button className="chip" aria-pressed={style === 'commute'} onClick={() => setStyle('commute')}>
              Lights and junctions
            </button>
            <button className="chip" aria-pressed={style === 'steady'} onClick={() => setStyle('steady')}>
              Barely stopped
            </button>
          </div>
          <div className="grid-2">
            <Field label="Climbing" hint="metres of ascent, if you know it">
              <NumberInput value={climbM} unit="m" placeholder="0" onChange={setClimbM} />
            </Field>
            <Field label="Carrying" hint="shopping, a loaded backpack">
              <NumberInput value={loadKg} unit="kg" placeholder="0" onChange={setLoadKg} />
            </Field>
          </div>
          <div className="tiny muted num">
            {physics.kmh} km/h · rolling {physics.rolling} kJ · air {physics.air} kJ
            {physics.restarts ? ` · restarts ${physics.restarts} kJ` : ''}
            {physics.climb ? ` · climb ${physics.climb} kJ` : ''}
          </div>
        </>
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
              climbM,
              loadKg,
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
          {anchored ? (
            <>
              Not added to today's target. Your maintenance has been measured from what you eat
              against your weight trend, and it was measured while you were already riding
              everywhere — so logging this moves energy between the parts of the day rather than
              handing its calories back.
            </>
          ) : (
            <>
              This does raise today's target. Until there is enough clean data to measure your
              maintenance, the day is built up from a formula and a logged ride adds to it. Once
              the measurement takes over, riding you do routinely will already be inside it and
              logging will stop moving the number.
            </>
          )}
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
                climbM: climbM ?? r.climbM,
                loadKg: loadKg ?? r.loadKg,
              })
            }
          }
          clearLiveRide()
          toast(`${totalMin} min logged`)
          onClose()
        }}
      >
        Log {totalMin} min
      </button>

      {/* Start it now and let the clock run in your pocket. The time is a
          stored start moment, so locking the phone or the app being closed
          mid-ride loses nothing — you finish it when you arrive. */}
      {!initial && (
        <button
          className="btn block"
          onClick={() => {
            setLiveRide({
              startedAt: Date.now(),
              place: place.trim() || undefined,
              routeId: routeId ?? undefined,
              km,
              climbM,
              loadKg,
            })
            toast(place.trim() ? `Timing your ride to ${place.trim()}` : 'Ride started')
            onClose()
          }}
        >
          <Icon.play /> Start &amp; time it — finish when you arrive
        </button>
      )}

      {/* Setup, not daily use: planning a brand-new journey with the map, kept
          at the bottom so picking a saved route above stays the fast path. */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 4px' }} />
      <button className="btn ghost block" onClick={() => setPlanning(true)}>
        <Icon.plus /> Plan a new route
      </button>
      <button className="btn ghost block muted" onClick={() => setManagingPlaces(true)}>
        Manage places
      </button>
      {usage && (
        <div className="tiny muted num" style={{ textAlign: 'center', marginTop: 6 }}>
          Google usage: {usage.calls} call{usage.calls === 1 ? '' : 's'} · ~${usage.estUsd.toFixed(2)}
        </div>
      )}

      {planning && <RoutePlannerSheet onClose={() => setPlanning(false)} toast={toast} />}
      {managingPlaces && <PlacesSheet onClose={() => setManagingPlaces(false)} toast={toast} />}
    </Sheet>
  )
}
