import { useCallback, useEffect, useRef, useState } from 'react'
import { db, type Settings, type WeighIn } from '../db/db'
import { todayISO } from '../lib/date'
import { ageFrom } from '../lib/metrics'
import { bodyComposition, bodyFatBand } from '../lib/bodyComp'
import { openScale, type ScaleReading, type ScaleSession } from '../lib/scale'
import { Icon, Sheet } from './ui'

type Phase = 'connecting' | 'waiting' | 'reading' | 'saved' | 'error'

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
  const session = useRef<ScaleSession | null>(null)
  const savedId = useRef<number | null>(null)

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

  // Held in a ref so the connection effect depends only on the device. As a
  // dependency this would drop and re-establish the Bluetooth session any time
  // a setting changed while standing on the scale.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const persist = useCallback(
    async (r: ScaleReading) => {
      const cfg = settingsRef.current
      const c = r.impedance
        ? bodyComposition(
            r.kg,
            cfg.heightCm,
            ageFrom(cfg.birthDate),
            cfg.sex,
            r.impedance,
            cfg.athlete,
          )
        : null
      const date = todayISO()
      const existing = await db.weighIns.where('date').equals(date).first()
      const id = await db.weighIns.put({
        ...(existing?.id ? { id: existing.id } : {}),
        date,
        kg: r.kg,
        impedance: r.impedance,
        source: 'scale',
        createdAt: Date.now(),
        ...(c
          ? {
              bodyFatPct: c.bodyFatPct,
              fatFreeKg: c.fatFreeKg,
              muscleKg: c.muscleKg,
              boneKg: c.boneKg,
              waterPct: c.waterPct,
              proteinPct: c.proteinPct,
              visceralFat: c.visceralFat,
              subcutaneousFatPct: c.subcutaneousFatPct,
              skeletalMusclePct: c.skeletalMusclePct,
              bmrKcal: c.bmrKcal,
            }
          : {}),
      } as WeighIn)
      savedId.current = id as number
    },
    [],
  )

  useEffect(() => {
    let alive = true
    // Saving happens as soon as the reading is complete rather than on a tap:
    // one less thing to do while standing on a scale. It is reversible from
    // this sheet, and a second weigh-in the same day overwrites rather than
    // duplicating, so there is nothing to undo later either.
    let settle: number | undefined

    openScale(device, {
      onReading: (r) => {
        if (!alive) return
        setLive(r)
        if (!r.stable) return

        setFinal((prev) => {
          // First stable frame wins, but a later one carrying impedance
          // supersedes it — the scale sends weight first and finishes the
          // body-composition pass a second or two afterwards.
          const next = !prev ? r : r.impedance && !prev.impedance ? r : prev
          if (next !== prev) {
            window.clearTimeout(settle)
            // Give the impedance pass a moment to arrive before committing.
            settle = window.setTimeout(
              () => {
                void persist(next).then(() => alive && setPhase('saved'))
              },
              next.impedance ? 250 : 2500,
            )
          }
          return next
        })
        setPhase((p) => (p === 'saved' ? p : 'reading'))
      },
      onDisconnect: () => {
        if (alive) setPhase((p) => (p === 'saved' || p === 'error' ? p : 'error'))
      },
    })
      .then((s) => {
        if (!alive) {
          s.disconnect()
          return
        }
        session.current = s
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
  }, [device, persist])

  // persist is stable (no deps), so the effect above runs once per device.

  const discard = async () => {
    if (savedId.current != null) await db.weighIns.delete(savedId.current)
    toast('Discarded')
    onClose()
  }

  const shown = final ?? live

  return (
    <Sheet title={device.name ?? 'Scale'} onClose={onClose}>
      {phase === 'connecting' && <div className="empty">Connecting…</div>}

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

      {(phase === 'waiting' || phase === 'reading' || phase === 'saved') && (
        <>
          {!shown && (
            <div className="empty">
              Connected. Step on the scale barefoot and stand still.
            </div>
          )}

          {shown && (
            <div className="card">
              <div className="row between">
                <span className="stat-label">
                  {phase === 'saved' ? 'Saved' : final ? 'Measured' : 'Reading…'}
                </span>
                {phase === 'saved' && (
                  <span style={{ color: 'var(--success-text)' }}>
                    <Icon.check />
                  </span>
                )}
              </div>
              <div className="hero num" style={{ opacity: final ? 1 : 0.45 }}>
                {shown.kg.toFixed(1)} <span className="hero-unit">kg</span>
              </div>
              {final?.impedance ? (
                <div className="tiny muted num">impedance {final.impedance} Ω</div>
              ) : final ? (
                <div className="tiny muted">
                  Weight only — stay on a moment longer, barefoot, for body composition.
                </div>
              ) : (
                <div className="tiny muted">Hold still until it settles.</div>
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
            </div>
          )}

          {phase === 'saved' ? (
            <>
              <button className="btn primary block" onClick={onClose}>
                Done
              </button>
              <button className="btn ghost block muted" onClick={discard}>
                Discard this reading
              </button>
            </>
          ) : (
            <div className="tiny muted" style={{ textAlign: 'center' }}>
              Saves by itself once the reading completes.
            </div>
          )}
        </>
      )}
    </Sheet>
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
