import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { requestPersistence } from './db/db'
import './styles.css'

// Ask up front, so a long log is never evicted under storage pressure.
void requestPersistence()

/**
 * Recovery route for a service worker that has wedged itself.
 *
 * An offline-first app that fails to boot shows nothing at all, and the usual
 * advice — clear the site's storage — would take the log with it. This throws
 * away every cache and unregisters the worker while leaving IndexedDB, where
 * the data actually lives, completely untouched.
 */
async function resetServiceWorker(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    for (const r of regs ?? []) await r.unregister()
  } catch {
    // Nothing to unregister is a fine outcome.
  }
  try {
    for (const key of await caches.keys()) await caches.delete(key)
  } catch {
    // Same: a browser without the Cache API needs no clearing.
  }
}

/**
 * A crash below here would otherwise leave a black screen, which says nothing
 * and offers nothing. The log is still on the device either way, so the useful
 * thing to show is the error and the way back in.
 */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app">
        <div className="screen">
          <div className="card">
            <h2>Salutt could not start</h2>
            <p className="small secondary">
              Your log is still on this device — this is the app failing to load, not your data
              going missing. Reloading without the cached copy usually fixes it.
            </p>
            <button
              className="btn primary block"
              onClick={async () => {
                await resetServiceWorker()
                location.replace('/')
              }}
            >
              Reload a clean copy
            </button>
            <p className="tiny muted" style={{ marginTop: 12 }}>
              {String(this.state.error?.message ?? this.state.error)}
            </p>
          </div>
        </div>
      </div>
    )
  }
}

async function boot() {
  // A wedged worker cannot fix itself, so this has to work before anything
  // else runs: salutt.stipe.app/?reset-sw
  if (new URLSearchParams(location.search).has('reset-sw')) {
    await resetServiceWorker()
    location.replace('/')
    return
  }

  // Dev-only: `?demo=1` wipes the database and fills it with six weeks of
  // plausible history, so the screens can be reviewed without waiting.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    const { seedDemo } = await import('./db/demo')
    await seedDemo()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Boundary>
        <App />
      </Boundary>
    </StrictMode>,
  )
}

void boot()
