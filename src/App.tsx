import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from './db/db'
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
import { bluetoothBlockedReason, pickScale } from './lib/scale'
import { useScaleListener } from './lib/useScaleListener'

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

      {settingsOpen && <Settings settings={settings} onClose={() => setSettingsOpen(false)} toast={show} />}
      {message && <Toast message={message} />}
    </div>
  )
}
