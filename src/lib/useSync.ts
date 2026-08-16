import { useCallback, useEffect, useRef, useState } from 'react'
import { db, type Settings } from '../db/db'
import { syncMerge, WrongSecretError } from './sync'

export type SyncState = 'off' | 'idle' | 'syncing' | 'error'

/**
 * Keeps the server copy up to date without being asked.
 *
 * Pushes on open, every few minutes while the app is in front, and when it is
 * backgrounded — but only when something actually changed, checked with a cheap
 * signature so an idle app does not re-upload the same database.
 *
 * Every sync folds the stored copy into this one and stores the result, so
 * both directions travel in a single pass. Nothing is ever replaced wholesale,
 * which is what used to make a difference between the two copies into a
 * question the user had to answer — and answering it wrongly cost whichever
 * side lost. Rows carry when they changed; the newer one wins, per row.
 */
export function useSync(settings: Settings) {
  const secret = settings.syncSecret
  const [state, setState] = useState<SyncState>(secret ? 'idle' : 'off')
  const [error, setError] = useState<string | null>(null)
  const [remoteAt, setRemoteAt] = useState<number | null>(null)
  const lastPushed = useRef<string | null>(null)
  // One sync at a time: the merge reads and writes the whole database, and two
  // of them interleaving would each see the other half-applied.
  const running = useRef(false)
  // Read rather than depended on: as a dependency, every successful push would
  // rewrite lastSync, re-run the effect and start another round trip.
  const lastSync = useRef(settings.lastSync)
  lastSync.current = settings.lastSync
  const lastMerge = useRef(0)

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
      if (!secret || running.current) return
      const sig = await signature()
      // A merge still has to run when nothing local changed, or edits made on
      // another device would never arrive. The signature only decides whether
      // this is worth doing off a timer.
      if (!force && sig === lastPushed.current && Date.now() - lastMerge.current < 5 * 60 * 1000) {
        return
      }
      running.current = true
      setState('syncing')
      try {
        const report = await syncMerge(secret)
        lastPushed.current = await signature()
        lastMerge.current = Date.now()
        setRemoteAt(report.updatedAt)
        setError(null)
        setState('idle')
        return report
      } catch (e) {
        setError(e instanceof WrongSecretError ? e.message : (e as Error).message)
        setState('error')
      } finally {
        running.current = false
      }
    },
    [secret, signature],
  )

  // On open, and then on a timer: merge in whatever else has been written.
  useEffect(() => {
    if (!secret) {
      setState('off')
      return
    }
    void syncNow(true)
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

  return { state, error, remoteAt, syncNow }
}
