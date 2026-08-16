import { useCallback, useEffect, useRef, useState } from 'react'
import { db, type Settings } from '../db/db'
import { fetchRemote, push, WrongSecretError } from './sync'

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'remote-newer'

/**
 * Keeps the server copy up to date without being asked.
 *
 * Pushes on open, every few minutes while the app is in front, and when it is
 * backgrounded — but only when something actually changed, checked with a cheap
 * signature so an idle app does not re-upload the same database.
 *
 * It never pulls on its own. If the server copy is newer than what this device
 * last saw, that means another device wrote it, and quietly overwriting local
 * data is exactly the sort of thing that loses a day of logging. It reports
 * `remote-newer` and lets the user decide.
 *
 * While that question is outstanding every automatic push is held. Otherwise
 * the timer, or simply switching apps, pushes this device's copy over the one
 * being asked about — which destroys the very data the prompt exists to
 * protect, before it can even be read.
 */
export function useSync(settings: Settings) {
  const secret = settings.syncSecret
  const [state, setState] = useState<SyncState>(secret ? 'idle' : 'off')
  const [error, setError] = useState<string | null>(null)
  const [remoteAt, setRemoteAt] = useState<number | null>(null)
  // What the stored copy holds, so the choice can be made on evidence rather
  // than on a timestamp and a guess.
  const [remoteCounts, setRemoteCounts] = useState<Record<string, number> | null>(null)
  const lastPushed = useRef<string | null>(null)
  // Read by the timer and the visibility handler, which capture their closure
  // once and would otherwise never see the state change.
  const conflicted = useRef(false)
  // Read rather than depended on: as a dependency, every successful push would
  // rewrite lastSync, re-run the effect and start another round trip.
  const lastSync = useRef(settings.lastSync)
  lastSync.current = settings.lastSync

  const signature = useCallback(async () => {
    const [entries, weighIns, workouts, measurements, foods, templates, recipes] = await Promise.all([
      db.entries.count(),
      db.weighIns.count(),
      db.workouts.count(),
      db.measurements.count(),
      db.foods.count(),
      db.mealTemplates.count(),
      // Left out originally, so correcting a recipe changed nothing the check
      // could see and the push was skipped as redundant.
      db.recipes.count(),
    ])
    // Counts alone would miss edits, so fold in the newest write times too.
    const [newest, recipeTouched] = await Promise.all([
      db.entries.orderBy('createdAt').last(),
      db.recipes.orderBy('lastUsed').last(),
    ])
    return [
      entries, weighIns, workouts, measurements, foods, templates, recipes,
      newest?.createdAt ?? 0,
      recipeTouched?.lastUsed ?? 0,
    ].join(':')
  }, [])

  const syncNow = useCallback(
    async (force = false) => {
      if (!secret) return
      // An unresolved conflict means the server holds something this device has
      // not merged. Pushing over it is never the right automatic answer.
      if (conflicted.current && !force) return
      const sig = await signature()
      if (!force && sig === lastPushed.current) return
      setState('syncing')
      try {
        await push(secret)
        lastPushed.current = sig
        setError(null)
        setState('idle')
      } catch (e) {
        setError(e instanceof WrongSecretError ? e.message : (e as Error).message)
        setState('error')
      }
    },
    [secret, signature],
  )

  // On open: is there a copy on the server this device has not seen?
  useEffect(() => {
    if (!secret) {
      setState('off')
      return
    }
    let alive = true
    void (async () => {
      try {
        const remote = await fetchRemote(secret)
        if (!alive) return
        setRemoteAt(remote?.updatedAt ?? null)
        const backup = remote?.backup as { counts?: Record<string, number> } | undefined
        setRemoteCounts(backup?.counts ?? null)
        if (remote && remote.updatedAt > (lastSync.current ?? 0) + 1000) {
          conflicted.current = true
          setState('remote-newer')
          return
        }
        void syncNow()
      } catch (e) {
        if (!alive) return
        setError((e as Error).message)
        setState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [secret, syncNow])

  // While the app is in front, and once more on the way out.
  useEffect(() => {
    if (!secret) return
    const timer = window.setInterval(() => void syncNow(), 5 * 60 * 1000)
    const onHide = () => {
      if (document.visibilityState === 'hidden') void syncNow()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [secret, syncNow])

  return {
    state,
    error,
    remoteAt,
    remoteCounts,
    syncNow,
    dismissRemote: () => {
      conflicted.current = false
      setState('idle')
    },
  }
}
