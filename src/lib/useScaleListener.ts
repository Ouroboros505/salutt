import { useEffect, useRef, useState } from 'react'
import {
  armScale,
  getRememberedScale,
  type ArmedScale,
  type ArmedStatus,
  type ScaleReading,
} from './scale'
import { betterReading } from './saveWeighIn'

export type ListenerState = 'off' | ArmedStatus | 'ready'

/**
 * Waits for the scale in the background and surfaces a reading when you step
 * on it — no tap anywhere.
 *
 * Nothing is written: the settled reading is handed back for confirmation,
 * because stepping on a scale to check a number should not silently become a
 * logged weigh-in.
 *
 * Lives at app level rather than on the Body screen, so the scale is picked up
 * whichever tab happens to be open.
 */
export function useScaleListener(enabled: boolean) {
  const [state, setState] = useState<ListenerState>('off')
  const [live, setLive] = useState<ScaleReading | null>(null)
  const [settled, setSettled] = useState<ScaleReading | null>(null)
  const armed = useRef<ArmedScale | null>(null)
  const best = useRef<ScaleReading | null>(null)

  useEffect(() => {
    if (!enabled) {
      setState('off')
      return
    }
    let alive = true
    let settle: number | undefined

    void (async () => {
      const device = await getRememberedScale()
      if (!device || !alive) return

      armed.current = armScale(device, {
        onStatus: (s) => alive && setState((p) => (p === 'ready' ? p : s)),
        onReading: (r) => {
          if (!alive) return
          setLive(r)
          const next = betterReading(best.current, r)
          if (!next || next === best.current) return
          best.current = next
          window.clearTimeout(settle)
          // Hold for the impedance pass, as the manual sheet does, so an
          // automatic reading carries body composition too.
          settle = window.setTimeout(
            () => {
              if (!alive) return
              setSettled(next)
              setState('ready')
            },
            next.impedance ? 250 : 2500,
          )
        },
      })
    })()

    return () => {
      alive = false
      window.clearTimeout(settle)
      armed.current?.cancel()
      armed.current = null
    }
  }, [enabled])

  const clear = () => {
    // Reset the best-so-far as well: without this, stepping on the scale again
    // at the same weight is discarded as "no better than last time" and never
    // surfaces a second reading.
    best.current = null
    setSettled(null)
    setLive(null)
    // Stay armed: stepping on the scale again should just work.
    setState((p) => (p === 'ready' ? 'waiting' : p))
  }

  return { state, live, settled, clear }
}
