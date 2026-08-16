import { useState } from 'react'
import { saveSettings, type Settings } from '../db/db'
import { generateSecret, hasLocalData, looksLikeSecret, pull, push, WrongSecretError } from '../lib/sync'
import { Field, Icon } from './ui'

/**
 * Turning sync on, and restoring onto a new device.
 *
 * The whole scheme rests on one recovery code, so the first screen exists to
 * make sure it gets written down before anything depends on it. There is no
 * reset: the server never sees the key, which is the point.
 */
export default function SyncSetup({
  settings,
  onClose,
  toast,
}: {
  settings: Settings
  onClose: () => void
  toast: (m: string) => void
}) {
  const [mode, setMode] = useState<'choose' | 'new' | 'restore'>('choose')
  const [fresh, setFresh] = useState<string>('')
  const [entered, setEntered] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startNew = () => {
    setFresh(generateSecret())
    setMode('new')
  }

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveSettings({ syncSecret: fresh })
      await push(fresh)
      toast('Sync on — your data is backed up')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    setBusy(true)
    setError(null)
    try {
      if (await hasLocalData()) {
        // Restoring replaces everything, so refuse to do it silently on top of
        // a device that already has a log of its own.
        const ok = window.confirm(
          'This device already has data. Restoring replaces it with the copy from the server. Continue?',
        )
        if (!ok) {
          setBusy(false)
          return
        }
      }
      const n = await pull(entered)
      await saveSettings({ syncSecret: entered })
      toast(`Restored ${n} log entries`)
      onClose()
    } catch (e) {
      setError(
        e instanceof WrongSecretError
          ? 'That code does not match any backup.'
          : (e as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'choose') {
    return (
      <>
        <div className="small secondary">
          Your log is stored encrypted on the server, so a new phone only needs your recovery code to
          get everything back. The encryption happens here on the device — the server holds a blob it
          cannot read, and neither can anyone with access to it.
        </div>
        <button className="btn primary block" onClick={startNew} disabled={settings.syncSecret != null}>
          Set up sync on this device
        </button>
        <button className="btn block" onClick={() => setMode('restore')}>
          I already have a recovery code
        </button>
      </>
    )
  }

  if (mode === 'new') {
    return (
      <>
        <div className="card tight">
          <h3>Your recovery code</h3>
          <div
            className="num"
            style={{
              fontSize: 17,
              fontWeight: 650,
              letterSpacing: '0.04em',
              lineHeight: 1.6,
              wordBreak: 'break-all',
            }}
          >
            {fresh}
          </div>
          <button
            className="btn sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fresh)
                toast('Copied')
              } catch {
                toast('Select and copy it by hand')
              }
            }}
          >
            Copy
          </button>
        </div>

        <div className="card tight" style={{ borderColor: 'var(--serious)' }}>
          <div className="small">
            <strong>Save this somewhere safe now</strong> — a password manager, or written down.
          </div>
          <div className="tiny muted">
            It is the only key to your data. Nobody can reset it, recover it, or read your backup
            without it: the server stores ciphertext and never receives the key. Lose the code and
            the backup is permanently unreadable.
          </div>
        </div>

        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            style={{ width: 22, height: 22, flex: 'none' }}
          />
          <span className="small">I have saved my recovery code</span>
        </label>

        {error && <div className="tiny" style={{ color: 'var(--critical)' }}>{error}</div>}

        <button className="btn primary block" disabled={!saved || busy} onClick={enable}>
          {busy ? 'Uploading…' : 'Turn on sync'}
        </button>
        <button className="btn ghost block muted" onClick={() => setMode('choose')}>
          Back
        </button>
      </>
    )
  }

  return (
    <>
      <div className="small secondary">
        Enter the recovery code from your other device. Everything on this one will be replaced by
        the stored copy.
      </div>
      <Field label="Recovery code">
        <input
          autoFocus
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          placeholder="SLT-XXXX-XXXX-XXXX…"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      {error && <div className="tiny" style={{ color: 'var(--critical)' }}>{error}</div>}
      <button
        className="btn primary block"
        disabled={busy || !looksLikeSecret(entered)}
        onClick={restore}
      >
        <Icon.check /> {busy ? 'Restoring…' : 'Restore my data'}
      </button>
      <button className="btn ghost block muted" onClick={() => setMode('choose')}>
        Back
      </button>
    </>
  )
}
