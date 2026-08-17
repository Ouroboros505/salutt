import { useState } from 'react'
import { db, type ISODate } from '../db/db'
import { RIDE_EFFORTS, RIDE_PLACES, metFromSpeed, rideKcal } from '../lib/ride'
import { Field, NumberInput, Sheet } from './ui'

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
  const [returnTrip, setReturnTrip] = useState(true)

  const legs = returnTrip ? 2 : 1
  const totalMin = (minutes ?? 0) * legs
  // Distance and time give a speed, and a speed is a measurement where "how
  // hard did it feel" is a guess. Used in preference when both are there.
  const fromSpeed = metFromSpeed(km ?? 0, minutes ?? 0)
  const met = fromSpeed?.met ?? effort.met
  const kcal = rideKcal(met, kg, totalMin)

  return (
    <Sheet title="Log a ride" onClose={onClose}>
      <Field label="Where to">
        <input
          autoFocus
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Campus, the shops, a friend's…"
        />
      </Field>
      <div className="scroll-x">
        {RIDE_PLACES.map((p) => (
          <button key={p} className="chip" aria-pressed={place === p} onClick={() => setPlace(p)}>
            {p}
          </button>
        ))}
      </div>

      <div className="grid-2">
        <Field label="One way" hint="minutes in the saddle">
          <NumberInput value={minutes} unit="min" onChange={setMinutes} />
        </Field>
        <Field label="Distance" hint="optional">
          <NumberInput value={km} unit="km" onChange={setKm} />
        </Field>
      </div>

      <label className="row" style={{ gap: 10, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={returnTrip}
          onChange={(e) => setReturnTrip(e.target.checked)}
          style={{ width: 20, height: 20, flex: 'none' }}
        />
        <span className="small">
          There and back
          <span className="tiny muted" style={{ display: 'block' }}>
            {returnTrip ? `counts ${totalMin} min` : 'one way only'}
          </span>
        </span>
      </label>

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
          toast(`${totalMin} min logged`)
          onClose()
        }}
      >
        Log {totalMin} min
      </button>
    </Sheet>
  )
}
