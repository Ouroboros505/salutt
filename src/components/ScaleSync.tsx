import { useCallback, useEffect, useRef, useState } from 'react'
import { db, type Settings, type WeighIn } from '../db/db'
import { todayISO } from '../lib/date'
import { ageFrom } from '../lib/metrics'
import { bodyComposition, bodyFatBand } from '../lib/bodyComp'
import {
  bluetoothBlockedReason,
  connectScale,
  type ScaleReading,
  type ScaleSession,
} from '../lib/scale'
import { Icon, Sheet } from './ui'

type Phase = 'idle' | 'connecting' | 'waiting' | 'reading' | 'error'

export default function ScaleSync({
  settings,
  onClose,
  toast,
}: {
  settings: Settings
  onClose: () => void
  toast: (m: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<ScaleReading | null>(null)
  const [final, setFinal] = useState<ScaleReading | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const session = useRef<ScaleSession | null>(null)

  const blocked = bluetoothBlockedReason()

  useEffect(() => () => session.current?.disconnect(), [])

  const start = useCallback(async () => {
    setError(null)
    setPhase('connecting')
    try {
      const s = await connectScale({
        onReading: (r) => {
          setLive(r)
          // Keep the first stable frame; later frames as you step off are noise.
          // A frame carrying impedance supersedes an earlier weight-only one,
          // since the scale sends weight first and finishes the body pass after.
          setFinal((prev) => {
            if (!r.stable) return prev
            if (!prev) return r
            return r.impedance && !prev.impedance ? r : prev
          })
          if (r.stable) setPhase('reading')
        },
        onDisconnect: () => {
          session.current = null
          setPhase((p) => (p === 'waiting' || p === 'connecting' ? 'idle' : p))
        },
      })
      session.current = s
      setDeviceName(s.info.name)
      setPhase('waiting')
    } catch (e) {
      const err = e as Error
      // Dismissing the browser's device chooser is a choice, not a failure.
      if (err.name === 'NotFoundError' && /cancel/i.test(err.message)) {
        setPhase('idle')
        return
      }
      setError(describeBleError(err))
      setPhase('error')
    }
  }, [])

  const comp =
    final && final.impedance
      ? bodyComposition(
          final.kg,
          settings.heightCm,
          ageFrom(settings.birthDate),
          settings.sex,
          final.impedance,
          settings.athlete,
        )
      : null

  const save = async () => {
    if (!final) return
    const date = todayISO()
    const existing = await db.weighIns.where('date').equals(date).first()
    const record: WeighIn = {
      ...(existing?.id ? { id: existing.id } : {}),
      date,
      kg: final.kg,
      impedance: final.impedance,
      source: 'scale',
      createdAt: Date.now(),
      ...(comp
        ? {
            bodyFatPct: comp.bodyFatPct,
            fatFreeKg: comp.fatFreeKg,
            muscleKg: comp.muscleKg,
            boneKg: comp.boneKg,
            waterPct: comp.waterPct,
            proteinPct: comp.proteinPct,
            visceralFat: comp.visceralFat,
            subcutaneousFatPct: comp.subcutaneousFatPct,
            skeletalMusclePct: comp.skeletalMusclePct,
            bmrKcal: comp.bmrKcal,
          }
        : {}),
    }
    await db.weighIns.put(record)
    session.current?.disconnect()
    toast(existing ? "Today's weigh-in updated" : 'Weigh-in saved')
    onClose()
  }

  return (
    <Sheet title="Sync scale" onClose={onClose}>
      {blocked ? (
        <div className="card tight">
          <h3 style={{ color: 'var(--serious)' }}>Not available here</h3>
          <div className="small secondary">{blocked}</div>
        </div>
      ) : (
        <>
          {phase === 'idle' && (
            <>
              <ol className="small secondary" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
                <li>Turn Bluetooth on.</li>
                <li>
                  <strong>Close the VeSync app completely.</strong> The scale accepts one connection
                  at a time, so if VeSync holds it, Salutt cannot.
                </li>
                <li>
                  <strong>Step on the scale to wake it,</strong> then tap Connect straight away — it
                  only broadcasts for a few seconds before going back to sleep.
                </li>
                <li>Pick <em>Etekcity Fitness Scale</em> from the list Chrome shows.</li>
                <li>Stand on it barefoot and still. Weight lands first; body composition follows a
                  couple of seconds later.</li>
              </ol>
              <button className="btn primary block" onClick={start}>
                Connect to scale
              </button>
            </>
          )}

          {phase === 'connecting' && <div className="empty">Connecting…</div>}

          {(phase === 'waiting' || phase === 'reading') && (
            <>
              <div className="row between small">
                <span className="secondary truncate">{deviceName ?? 'Scale'}</span>
                <span style={{ color: 'var(--success-text)' }}>connected</span>
              </div>

              {phase === 'waiting' && !live && (
                <div className="empty">Step on the scale, barefoot, and stand still.</div>
              )}

              {(live || final) && (
                <div className="card">
                  <div className="stat-label">{final ? 'Measured' : 'Reading…'}</div>
                  <div
                    className="hero num"
                    style={{ opacity: final ? 1 : 0.5 }}
                  >
                    {(final ?? live)!.kg.toFixed(1)} <span className="hero-unit">kg</span>
                  </div>
                  {final ? (
                    final.impedance ? (
                      <div className="tiny muted num">impedance {final.impedance} Ω</div>
                    ) : (
                      <div className="tiny muted">
                        Weight only — stay on the scale a moment longer for body composition.
                      </div>
                    )
                  ) : (
                    <div className="tiny muted">Hold still until the number settles.</div>
                  )}
                </div>
              )}

              {comp && (
                <div className="card tight">
                  <h3>Body composition</h3>
                  <div className="grid-3">
                    <Metric label="Body fat" value={`${comp.bodyFatPct}%`} sub={bodyFatBand(comp.bodyFatPct, settings.sex)} />
                    <Metric label="Muscle" value={`${comp.muscleKg}`} sub="kg" />
                    <Metric label="Water" value={`${comp.waterPct}%`} />
                    <Metric label="Bone" value={`${comp.boneKg}`} sub="kg" />
                    <Metric label="Visceral" value={`${comp.visceralFat}`} sub="index 1-30" />
                    <Metric label="Protein" value={`${comp.proteinPct}%`} />
                  </div>
                  <div className="tiny muted">
                    Derived from weight and impedance using the same algorithm the VeSync app runs for
                    the ESF-551, so these match what VeSync would show. Impedance readings drift with
                    hydration — trust the direction over weeks, not any single figure.
                  </div>
                </div>
              )}

              <button className="btn primary block" disabled={!final} onClick={save}>
                {final ? `Save ${final.kg.toFixed(1)} kg` : 'Waiting for a stable reading…'}
              </button>

              <button
                className="btn ghost block muted"
                onClick={() => {
                  session.current?.disconnect()
                  session.current = null
                  setPhase('idle')
                  setLive(null)
                  setFinal(null)
                }}
              >
                Disconnect
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="card tight">
                <h3 style={{ color: 'var(--critical)' }}>Could not connect</h3>
                <div className="small secondary">{error}</div>
              </div>
              <button className="btn block" onClick={start}>
                <Icon.plus /> Try again
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  )
}

/**
 * Web Bluetooth reports failures as bare DOMExceptions whose messages assume
 * you know the spec. Translate the ones that actually happen with this scale
 * into something you can act on.
 */
function describeBleError(err: Error): string {
  switch (err.name) {
    case 'NotFoundError':
      return 'Chrome could not see the scale. Step on it to wake it up — it only broadcasts for a few seconds — then tap Connect again. If it still does not appear, make sure the VeSync app is fully closed.'
    case 'SecurityError':
      return 'The browser blocked Bluetooth access. Salutt has to be on an https:// address, and Chrome needs the Nearby devices permission.'
    case 'NetworkError':
      return 'Connected, then lost it. The scale probably went back to sleep, or another app grabbed it. Step on it and try again.'
    case 'NotSupportedError':
      return 'This device does not expose the characteristic Salutt expects. If it is definitely an ESF-551, send this message on.'
    case 'InvalidStateError':
      return 'Bluetooth is not ready. Check it is switched on, then try again.'
    default:
      return err.message || 'Could not connect to the scale.'
  }
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
