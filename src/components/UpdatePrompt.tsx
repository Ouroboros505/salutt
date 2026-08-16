import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Tells you when a newer version is waiting.
 *
 * Without this the service worker updates silently on some future load, so a
 * fix can be live on the server while the phone still runs last week's code —
 * which looks exactly like the fix not working.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check on load and hourly, so a long-lived tab does not sit on stale code.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="toast" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>New version ready</span>
      <button
        className="btn sm primary"
        style={{ minHeight: 30, padding: '4px 12px' }}
        onClick={() => void updateServiceWorker(true)}
      >
        Reload
      </button>
      <button
        className="btn sm ghost"
        style={{ minHeight: 30, padding: '4px 8px', color: 'inherit', opacity: 0.7 }}
        onClick={() => setNeedRefresh(false)}
      >
        Later
      </button>
    </div>
  )
}
