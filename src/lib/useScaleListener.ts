import { useEffect, useRef, useState } from 'react'
import { getRememberedScale, openScale, type ScaleReading, type ScaleSession } from './scale'
import { betterReading } from './saveWeighIn'

export type ListenerState = 'off' | 'searching' | 'listening' | 'ready'

/**
 * Connects to an already-paired scale on its own, so stepping on it surfaces a
 * reading without touching the phone. It never writes anything: the reading is
 * handed back for confirmation, because checking a number should not silently
 * become a logged weigh-in.
 *
 * Only possible because `gatt.connect()` on a remembered device needs no user
 * gesture; only `requestDevice()` does. So once Chrome remembers the scale
 * (behind two flags — see Settings), the whole flow becomes: wake the scale,
 * open Salutt, stand on it.
 *
 * A sleeping scale simply refuses the connection, so this quietly does nothing
 * most of the time. It retries when the screen is shown again rather than
 * polling, which would hold the radio open for no reason.
 */
export function useScaleListener(enabled: boolean) {
  const [state, setState] = useState<ListenerState>('off')
  const [live, setLive] = useState<ScaleReading | null>(null)
  const [settled, setSettled] = useState<ScaleReading | null>(null)
  const session = useRef<ScaleSession | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let settle: number | undefined
    let best: ScaleReading | null = null

    const stop = () => {
      window.clearTimeout(settle)
      session.current?.disconnect()
      session.current = null
    }

    const attempt = async () => {
      if (!alive || session.current) return
      setState('searching')
      const device = await getRememberedScale()
      if (!device || !alive) {
        setState('off')
        return
      }

      try {
        const s = await openScale(device, {
          onReading: (r) => {
            if (!alive) return
            setLive(r)
            const next = betterReading(best, r)
            if (!next || next === best) return
            best = next
            window.clearTimeout(settle)
            // Wait for the impedance pass, exactly as the manual sheet does,
            // so an automatic reading is not a lesser one.
            settle = window.setTimeout(
              () => {
                if (!alive) return
                setSettled(next)
                setState('ready')
                // Hand it over and let go of the radio; the confirmation step
                // does not need the connection.
                session.current?.disconnect()
                session.current = null
              },
              next.impedance ? 250 : 2500,
            )
          },
          onDisconnect: () => {
            session.current = null
            if (alive) setState((p) => (p === 'ready' ? p : 'off'))
          },
        })
        if (!alive) {
          s.disconnect()
          return
        }
        session.current = s
        setState('listening')
      } catch {
        // Asleep, out of range, or held by another app. Nothing to report —
        // the manual button is still there.
        if (alive) setState('off')
      }
    }

    void attempt()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void attempt()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      stop()
    }
  }, [enabled])

  const clear = () => {
    setSettled(null)
    setLive(null)
    setState('off')
  }

  return { state, live, settled, clear }
}
