import { useState } from 'react'
import { saveSettings, type Settings } from '../db/db'
import {
  estimateBits,
  generatePassphrase,
  generateSecret,
  hasLocalData,
  looksLikeSecret,
  pull,
  push,
  strengthOf,
  WrongSecretError,
} from '../lib/sync'
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
  const [custom, setCustom] = useState(false)
  const [entered, setEntered] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startNew = () => {
    setFresh(generatePassphrase())
    setCustom(false)
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
      // A wrong phrase derives a different id, which simply does not exist —
      // the server answers 404 rather than "wrong password", and deliberately
      // so. For someone who has mistyped, that needs translating.
      const msg = (e as Error).message
      setError(
        e instanceof WrongSecretError || /Nothing stored/i.test(msg)
          ? 'No backup found for that phrase. Check for typos — it must match exactly, though dashes and capitals do not matter.'
          : msg,
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
    const bits = estimateBits(fresh)
    const strength = strengthOf(fresh)
    const tooWeak = custom && strength === 'weak'

    return (
      <>
        <div className="card tight">
          <h3>Your recovery phrase</h3>
          {custom ? (
            <input
              autoFocus
              value={fresh}
              onChange={(e) => setFresh(e.target.value)}
              placeholder="something only you would pick"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          ) : (
            <div
              className="num"
              style={{ fontSize: 19, fontWeight: 650, lineHeight: 1.5, wordBreak: 'break-word' }}
            >
              {fresh}
            </div>
          )}

          <div className="row between tiny">
            <span
              style={{
                color:
                  strength === 'strong'
                    ? 'var(--success-text)'
                    : strength === 'fair'
                      ? 'var(--serious)'
                      : 'var(--critical)',
              }}
            >
              {strength === 'strong' ? 'Strong' : strength === 'fair' ? 'Fair' : 'Too easy to guess'}
              {fresh ? ` · about ${bits} bits` : ''}
            </span>
            <span className="muted">{fresh.length} chars</span>
          </div>

          <div className="row" style={{ gap: 8 }}>
            {!custom && (
              <button className="btn sm grow" onClick={() => setFresh(generatePassphrase())}>
                Another
              </button>
            )}
            <button
              className="btn sm grow"
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

          <div className="scroll-x">
            <button
              className="chip"
              aria-pressed={!custom && fresh.includes('-') && !fresh.startsWith('SLT')}
              onClick={() => {
                setCustom(false)
                setFresh(generatePassphrase())
              }}
            >
              Words
            </button>
            <button
              className="chip"
              aria-pressed={fresh.startsWith('SLT')}
              onClick={() => {
                setCustom(false)
                setFresh(generateSecret())
              }}
            >
              Random code
            </button>
            <button
              className="chip"
              aria-pressed={custom}
              onClick={() => {
                setCustom(true)
                setFresh('')
              }}
            >
              My own
            </button>
          </div>
        </div>

        {tooWeak ? (
          <div className="card tight" style={{ borderColor: 'var(--critical)' }}>
            <div className="small">
              <strong>That is guessable.</strong>
            </div>
            <div className="tiny muted">
              Anyone can reach the sync endpoint, so a short phrase — especially one built round a
              date — can be tried until it works. Five random words are easier to remember and far
              harder to guess. Aim for 45 bits or more.
            </div>
          </div>
        ) : (
          <div className="card tight" style={{ borderColor: 'var(--serious)' }}>
            <div className="small">
              <strong>Save this somewhere you will still have it in a year.</strong>
            </div>
            <div className="tiny muted">
              It is the only key to your data. Nobody can reset or recover it: the server stores
              ciphertext and never receives the key. Lose the phrase and the backup is permanently
              unreadable.
            </div>
          </div>
        )}

        <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            style={{ width: 22, height: 22, flex: 'none' }}
          />
          <span className="small">I have saved my recovery phrase</span>
        </label>

        {error && <div className="tiny" style={{ color: 'var(--critical)' }}>{error}</div>}

        <button
          className="btn primary block"
          disabled={!saved || busy || tooWeak || !looksLikeSecret(fresh)}
          onClick={enable}
        >
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
        Enter the recovery phrase from your other device. Everything on this one will be replaced
        by the stored copy.
      </div>
      <Field label="Recovery phrase">
        <input
          autoFocus
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          placeholder="word-word-word-word-word"
          autoCapitalize="none"
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
