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

export type Tab = 'today' | 'foods' | 'body' | 'train' | 'insights'

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
  const [tab, setTab] = useState<Tab>('today')
  const [date, setDate] = useState(todayISO())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { message, show } = useToast()

  const settings = useLiveQuery(async () => (await db.settings.get('settings')) ?? DEFAULT_SETTINGS, [])

  // If IndexedDB is blocked or slow to open, say so instead of showing a blank
  // screen forever. Private-browsing modes and locked-down profiles do this.
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (settings) return
    const t = window.setTimeout(() => setStalled(true), 4000)
    return () => window.clearTimeout(t)
  }, [settings])

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

      {tab === 'today' && <Today settings={settings} date={date} setDate={setDate} toast={show} />}
      {tab === 'foods' && <Foods toast={show} />}
      {tab === 'body' && <Body settings={settings} toast={show} />}
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

      {settingsOpen && <Settings settings={settings} onClose={() => setSettingsOpen(false)} toast={show} />}
      {message && <Toast message={message} />}
    </div>
  )
}
