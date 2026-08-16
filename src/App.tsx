import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Settings as SettingsType } from './db/db'
import { todayISO } from './lib/date'
import { Icon, Toast } from './components/ui'
import Today from './screens/Today'
import Body from './screens/Body'
import Train from './screens/Train'
import Insights from './screens/Insights'
import Foods from './screens/Foods'
import Settings from './screens/Settings'
import ScaleSync from './components/ScaleSync'
import ScaleResult from './components/ScaleResult'
import { Sheet } from './components/ui'
import UpdatePrompt from './components/UpdatePrompt'
import { bluetoothBlockedReason, pickScale } from './lib/scale'
import { useScaleListener } from './lib/useScaleListener'
import { useSync } from './lib/useSync'
import { pull } from './lib/sync'

export type Tab = 'today' | 'foods' | 'body' | 'train' | 'insights'

/** A manifest shortcut the app was launched from (long-press on the icon). */
export type LaunchAction = 'food' | 'weigh' | 'scale'

const LAUNCH_TAB: Record<LaunchAction, Tab> = { food: 'today', weigh: 'body', scale: 'body' }

function readLaunchAction(): LaunchAction | null {
  const a = new URLSearchParams(location.search).get('a')
  return a === 'food' || a === 'weigh' || a === 'scale' ? a : null
}

const TABS: { id: Tab; label: string; icon: () => ReactElement }[] = [
  { id: 'today', label: 'Today', icon: Icon.today },
  { id: 'foods', label: 'Foods', icon: Icon.food },
  { id: 'body', label: 'Body', icon: Icon.body },
  { id: 'train', label: 'Train', icon: Icon.train },
  { id: 'insights', label: 'Insights', icon: Icon.chart },
]

const TITLES: Record<Tab, string> = {
  today: 'Salutt',
  foods: 'Foods',
  body: 'Body',
  train: 'Training',
  insights: 'Insights',
}

/**
 * Runs background sync and surfaces the one case it refuses to resolve alone:
 * a server copy newer than anything this device has seen, which means another
 * device wrote it. Overwriting either side silently is how a day of logging
 * disappears, so it asks.
 */
const SYNC_TABLES = ['entries', 'foods', 'recipes', 'weighIns', 'workouts', 'measurements'] as const

function SyncGate({ settings, toast }: { settings: SettingsType; toast: (m: string) => void }) {
  const sync = useSync(settings)
  const [busy, setBusy] = useState(false)

  // Counting both sides turns "whichever you choose replaces the other" into
  // something answerable: a row that differs is a row about to be lost.
  const local = useLiveQuery(async () => {
    const pairs = await Promise.all(SYNC_TABLES.map(async (t) => [t, await db.table(t).count()] as const))
    return Object.fromEntries(pairs) as Record<string, number>
  }, [])

  if (sync.state !== 'remote-newer') return null

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <div className="sheet">
        <div className="sheet-head">
          <h2 className="grow">Newer data on the server</h2>
        </div>
        <div className="sheet-body">
          <div className="small secondary">
            The stored copy was updated {sync.remoteAt ? new Date(sync.remoteAt).toLocaleString() : ''}
            , after this device last synced. That usually means you logged something on another
            device.
          </div>
          {local && sync.remoteCounts && (
            <div className="card tight">
              <div className="row between tiny muted">
                <span>&nbsp;</span>
                <span>this phone · server</span>
              </div>
              {SYNC_TABLES.filter((t) => (local[t] ?? 0) || (sync.remoteCounts![t] ?? 0)).map((t) => {
                const mine = local[t] ?? 0
                const theirs = sync.remoteCounts![t] ?? 0
                return (
                  <div className="row between small" key={t}>
                    <span style={{ textTransform: 'capitalize' }}>{t}</span>
                    <span className="num" style={{ color: mine === theirs ? 'var(--text-muted)' : 'var(--serious)' }}>
                      {mine} · {theirs}
                    </span>
                  </div>
                )
              })}
              <div className="tiny muted">
                Equal counts can still differ in their contents — an edited recipe counts the same
                either way.
              </div>
            </div>
          )}

          <button
            className="btn primary block"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const n = await pull(settings.syncSecret!)
                toast(`Restored ${n} entries from the server`)
                sync.dismissRemote()
              } catch (e) {
                toast((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Use the server copy
          </button>
          <button
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await sync.syncNow(true)
                toast('This device is now the stored copy')
                sync.dismissRemote()
              } finally {
                setBusy(false)
              }
            }}
          >
            Keep what is on this phone
          </button>
          <div className="tiny muted">
            Whichever you choose replaces the other. The previous server copy is kept for one
            generation, so a wrong choice here is recoverable.
          </div>
        </div>
      </div>
    </div>
  )
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((m: string) => {
    setMessage(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 2200)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { message, show }
}

export default function App() {
  // Read once, before first paint, so the app opens straight onto the right
  // screen rather than visibly jumping there.
  const [launch, setLaunch] = useState<LaunchAction | null>(readLaunchAction)
  const [tab, setTab] = useState<Tab>(() => {
    const a = readLaunchAction()
    return a ? LAUNCH_TAB[a] : 'today'
  })
  const [date, setDate] = useState(todayISO())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { message, show } = useToast()

  // The scale lives at app level so it is picked up on any tab, not just Body.
  // Paused while the manual sheet is open: the scale accepts one connection at
  // a time, and the two halves would otherwise compete for it.
  const [manualDevice, setManualDevice] = useState<BluetoothDevice | null>(null)
  const [picking, setPicking] = useState(false)
  const scale = useScaleListener(!manualDevice)

  // requestDevice() is only permitted inside a user gesture, which is why the
  // chooser is opened straight from the button rather than from a later step.
  const syncScale = async () => {
    setPicking(true)
    try {
      const { device } = await pickScale()
      setManualDevice(device)
    } catch (e) {
      const err = e as Error
      if (err.name === 'NotFoundError' && /cancel/i.test(err.message)) return
      show(bluetoothBlockedReason() ?? err.message ?? 'Could not reach the scale')
    } finally {
      setPicking(false)
    }
  }

  const settings = useLiveQuery(async () => (await db.settings.get('settings')) ?? DEFAULT_SETTINGS, [])

  // If IndexedDB is blocked or slow to open, say so instead of showing a blank
  // screen forever. Private-browsing modes and locked-down profiles do this.
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (settings) return
    const t = window.setTimeout(() => setStalled(true), 4000)
    return () => window.clearTimeout(t)
  }, [settings])

  // Drop the shortcut parameter once consumed, so a reload or a later launch
  // from the icon itself does not reopen the same sheet.
  useEffect(() => {
    if (launch) history.replaceState(null, '', location.pathname)
    // The scale shortcut only needs to land on Body — the background listener
    // connects on its own, and requestDevice() could not be called here anyway
    // without a user gesture.
    if (launch === 'scale') setLaunch(null)
  }, [launch])

  // Returning to the app after midnight should not leave you on yesterday.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setDate((d) => (d < todayISO() ? todayISO() : d))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!settings) {
    return (
      <div className="app">
        {stalled && (
          <div className="screen">
            <div className="card">
              <h2>Storage is not available</h2>
              <p className="small secondary">
                Salutt keeps everything in this browser's local database, and it did not open. Private
                or incognito windows usually block it. Try a normal window, or a different browser.
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>{TITLES[tab]}</h1>
        <button className="iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <Icon.gear />
        </button>
      </div>

      {tab === 'today' && (
        <Today
          settings={settings}
          date={date}
          setDate={setDate}
          toast={show}
          launch={launch === 'food' ? 'food' : null}
          onLaunchHandled={() => setLaunch(null)}
        />
      )}
      {tab === 'foods' && <Foods toast={show} />}
      {tab === 'body' && (
        <Body
          settings={settings}
          toast={show}
          launch={launch === 'weigh' ? 'weigh' : null}
          onLaunchHandled={() => setLaunch(null)}
          onSyncScale={syncScale}
          picking={picking}
          scaleState={scale.state}
          scaleLive={scale.live}
        />
      )}
      {tab === 'train' && <Train date={date} toast={show} />}
      {tab === 'insights' && <Insights settings={settings} />}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <t.icon />
            {t.label}
          </button>
        ))}
      </nav>

      {manualDevice && (
        <ScaleSync
          device={manualDevice}
          settings={settings}
          onClose={() => setManualDevice(null)}
          toast={show}
        />
      )}

      {scale.settled && !manualDevice && (
        <Sheet title="Weigh-in detected" onClose={scale.clear}>
          <ScaleResult
            reading={scale.settled}
            settings={settings}
            onDone={scale.clear}
            toast={show}
          />
        </Sheet>
      )}

      <SyncGate settings={settings} toast={show} />

      {settingsOpen && <Settings settings={settings} onClose={() => setSettingsOpen(false)} toast={show} />}
      {message && <Toast message={message} />}
      <UpdatePrompt />
    </div>
  )
}
