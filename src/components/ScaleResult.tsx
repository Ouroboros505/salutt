import { useState } from 'react'
import type { Settings } from '../db/db'
import { ageFrom } from '../lib/metrics'
import { bodyComposition, bodyFatBand } from '../lib/bodyComp'
import { saveReading } from '../lib/saveWeighIn'
import type { ScaleReading } from '../lib/scale'
import { Icon } from './ui'

/**
 * A finished reading, awaiting your decision. Nothing reaches the database
 * until Record is tapped — stepping on the scale to check a number should not
 * silently become a logged weigh-in.
 */
export default function ScaleResult({
  reading,
  settings,
  onDone,
  toast,
}: {
  reading: ScaleReading
  settings: Settings
  onDone: () => void
  toast: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [offProtocol, setOffProtocol] = useState(false)
  // The same pair the manual sheet asks. This is where weighing actually
  // happens, so a question that exists only on the other form is a question
  // that does not exist.
  const [afterStool, setAfterStool] = useState<boolean | undefined>(undefined)

  const comp = reading.impedance
    ? bodyComposition(
        reading.kg,
        settings.heightCm,
        ageFrom(settings.birthDate),
        settings.sex,
        reading.impedance,
        settings.athlete,
      )
    : null

  const record = async () => {
    setSaving(true)
    try {
      await saveReading(reading, settings, offProtocol, afterStool)
      toast('Weigh-in recorded')
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="card">
        <div className="stat-label">Measured</div>
        <div className="hero num">
          {reading.kg.toFixed(2)} <span className="hero-unit">kg</span>
        </div>
        {reading.impedance ? (
          <div className="tiny muted num">impedance {reading.impedance} Ω</div>
        ) : (
          <div className="tiny muted">
            Weight only — for body composition, stand on it barefoot a moment longer.
          </div>
        )}
      </div>

      {comp && (
        <div className="card tight">
          <h3>Body composition</h3>
          <div className="grid-3">
            <Metric
              label="Body fat"
              value={`${comp.bodyFatPct}%`}
              sub={bodyFatBand(comp.bodyFatPct, settings.sex)}
            />
            <Metric label="Muscle" value={`${comp.muscleKg}`} sub="kg" />
            <Metric label="Water" value={`${comp.waterPct}%`} />
            <Metric label="Bone" value={`${comp.boneKg}`} sub="kg" />
            <Metric label="Visceral" value={`${comp.visceralFat}`} sub="index 1-30" />
            <Metric label="Protein" value={`${comp.proteinPct}%`} />
          </div>
        </div>
      )}

      {/* Correctable, so it is asked separately and the reading still counts. */}
      <div className="stack tight">
        <div className="stat-label">Been to the toilet?</div>
        <div className="scroll-x">
          <button
            className="chip"
            aria-pressed={afterStool === true}
            onClick={() => setAfterStool(afterStool === true ? undefined : true)}
          >
            Yes, emptied
          </button>
          <button
            className="chip"
            aria-pressed={afterStool === false}
            onClick={() => setAfterStool(afterStool === false ? undefined : false)}
          >
            Not yet
          </button>
        </div>
        <div className="tiny muted">
          Optional — but answer it often and the offset gets measured, and taken off.
        </div>
      </div>

      {/* Not correctable, because it never repeats the same way twice. */}
      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={offProtocol}
          onChange={(e) => setOffProtocol(e.target.checked)}
          style={{ width: 20, height: 20, flex: 'none', marginTop: 2 }}
        />
        <span className="small">
          Unusual — evening, after eating, or dressed
          <span className="tiny muted" style={{ display: 'block' }}>
            A meal still digesting is up to 800 g against the 57–140 g of fat you are looking for,
            and unlike the bowel it does not repeat, so it can only be left out. Shown on the chart,
            kept out of the trend. Not going to the toilet is not this — answer that above and the
            reading still counts.
          </span>
        </span>
      </label>

      <button className="btn primary block" disabled={saving} onClick={record}>
        <Icon.check /> Record this weigh-in
      </button>
      <button className="btn ghost block muted" disabled={saving} onClick={onDone}>
        Discard
      </button>
      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Nothing is saved until you tap Record.
      </div>
    </>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stack tight">
      <div className="stat-label">{label}</div>
      <div className="stat-value num">{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  )
}
