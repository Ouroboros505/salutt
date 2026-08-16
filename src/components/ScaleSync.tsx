import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../db/db'
import { openScale, type ScaleReading, type ScaleSession } from '../lib/scale'
import { betterReading } from '../lib/saveWeighIn'
import { Sheet } from './ui'
import ScaleResult from './ScaleResult'

type Phase = 'connecting' | 'waiting' | 'reading' | 'done' | 'error'

/**
 * Everything after the device chooser. The device is picked in the Body screen,
 * inside the click handler, because Chrome only allows requestDevice() during a
 * user gesture — so by the time this mounts there is nothing left to tap.
 */
export default function ScaleSync({
  device,
  settings,
  onClose,
  toast,
}: {
  device: BluetoothDevice
  settings: Settings
  onClose: () => void
  toast: (m: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<ScaleReading | null>(null)
  const [final, setFinal] = useState<ScaleReading | null>(null)
  const [battery, setBattery] = useState<number | null>(null)
  const session = useRef<ScaleSession | null>(null)

  useEffect(() => {
    let alive = true
    let settle: number | undefined
    let best: ScaleReading | null = null

    openScale(device, {
      onReading: (r) => {
        if (!alive) return
        setLive(r)
        const next = betterReading(best, r)
        if (!next || next === best) return
        best = next
        setPhase('reading')
        window.clearTimeout(settle)
        // Hold briefly before presenting: the scale sends a stable weight
        // first and repeats it with impedance once the body-composition pass
        // finishes, so showing the first frame would drop the composition.
        settle = window.setTimeout(
          () => {
            if (!alive) return
            setFinal(next)
            setPhase('done')
            // Reading complete — release the radio while it is being reviewed.
            session.current?.disconnect()
            session.current = null
          },
          next.impedance ? 250 : 2500,
        )
      },
      onDisconnect: () => {
        if (alive) setPhase((p) => (p === 'done' || p === 'error' ? p : 'error'))
      },
    })
      .then((s) => {
        if (!alive) {
          s.disconnect()
          return
        }
        session.current = s
        setBattery(s.info.batteryPct ?? null)
        setPhase('waiting')
      })
      .catch((e) => {
        if (!alive) return
        setError((e as Error).message || 'Could not connect.')
        setPhase('error')
      })

    return () => {
      alive = false
      window.clearTimeout(settle)
      session.current?.disconnect()
    }
  }, [device])

  return (
    <Sheet title={device.name ?? 'Scale'} onClose={onClose}>
      {phase === 'connecting' && <div className="empty">Connecting…</div>}

      {battery != null && (
        <div className="row between small">
          <span className="muted">Scale battery</span>
          <span className="num">{battery}%</span>
        </div>
      )}

      {phase === 'error' && (
        <>
          <div className="card tight">
            <h3 style={{ color: 'var(--critical)' }}>Lost the scale</h3>
            <div className="small secondary">
              {error ??
                'The scale went back to sleep or the connection dropped. Step on it and tap Sync again.'}
            </div>
          </div>
          <button className="btn block" onClick={onClose}>
            Close
          </button>
        </>
      )}

      {(phase === 'waiting' || phase === 'reading') &&
        (!live ? (
          <div className="empty">Connected. Step on the scale barefoot and stand still.</div>
        ) : (
          <div className="card">
            <div className="stat-label">Reading…</div>
            <div className="hero num" style={{ opacity: 0.45 }}>
              {live.kg.toFixed(2)} <span className="hero-unit">kg</span>
            </div>
            <div className="tiny muted">Hold still until it settles.</div>
          </div>
        ))}

      {phase === 'done' && final && (
        <ScaleResult reading={final} settings={settings} onDone={onClose} toast={toast} />
      )}
    </Sheet>
  )
}
