import { useEffect, useRef, useState } from 'react'
import { db, saveSettings, type Settings as S } from '../db/db'
import { exportBackup, importBackup } from '../lib/backup'
import { ageFrom, bmrMifflin, computeTargets } from '../lib/metrics'
import { Field, Icon, Sheet } from '../components/ui'
import { bluetoothBlockedReason, canRememberDevices } from '../lib/scale'
import { foodDbSize } from '../lib/foodDb'
import SyncSetup from '../components/SyncSetup'
import { syncMerge } from '../lib/sync'
import {
  formatBytes,
  requestPersistentStorage,
  storageStatus,
  type StorageStatus,
} from '../lib/storage'

const ACTIVITY = [
  { v: 1.2, label: 'Sedentary — desk work, little movement' },
  { v: 1.375, label: 'Light — some walking, 1-3 sessions a week' },
  { v: 1.55, label: 'Moderate — 3-5 sessions a week' },
  { v: 1.725, label: 'Very active — 6-7 sessions a week' },
  { v: 1.9, label: 'Athlete or physical job' },
]

export default function Settings({
  settings,
  onClose,
  toast,
}: {
  settings: S
  onClose: () => void
  toast: (m: string) => void
}) {
  const [s, setS] = useState<S>(settings)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const patch = (p: Partial<S>) => {
    const next = { ...s, ...p }
    setS(next)
    void saveSettings(p)
  }

  const num = (v: string) => (v === '' ? undefined : parseFloat(v))
  const scaleBlocked = bluetoothBlockedReason()
  const remembers = canRememberDevices()

  const [dbCount, setDbCount] = useState<number | null>(null)
  useEffect(() => {
    foodDbSize().then(setDbCount).catch(() => setDbCount(0))
  }, [])

  const [syncOpen, setSyncOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [store, setStore] = useState<StorageStatus | null>(null)
  const refreshStore = () => void storageStatus().then(setStore)
  useEffect(refreshStore, [])
  const preview = computeTargets(s, s.startWeightKg ?? 75, null)

  return (
    <Sheet title="Settings" onClose={onClose}>
      {/* ------------------------------------------------ profile */}
      <div className="card tight">
        <h3>You</h3>
        <div className="grid-2">
          <Field label="Height (cm)">
            <input
              type="number"
              inputMode="decimal"
              value={s.heightCm}
              onChange={(e) => patch({ heightCm: num(e.target.value) ?? 175 })}
            />
          </Field>
          <Field label="Date of birth">
            <input
              type="date"
              value={s.birthDate ?? ''}
              onChange={(e) => patch({ birthDate: e.target.value || undefined })}
            />
          </Field>
        </div>
        <Field label="Sex" hint="Used only by the BMR formula and the tape body-fat estimate.">
          <select value={s.sex} onChange={(e) => patch({ sex: e.target.value as S['sex'] })}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </Field>
        <Field label="Activity">
          <select value={s.activity} onChange={(e) => patch({ activity: parseFloat(e.target.value) })}>
            {ACTIVITY.map((a) => (
              <option key={a.v} value={a.v}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* ------------------------------------------------ goal */}
      <div className="card tight">
        <h3>Goal</h3>
        <div className="grid-2">
          <Field label="Goal weight (kg)">
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={s.goalWeightKg ?? ''}
              onChange={(e) => patch({ goalWeightKg: num(e.target.value) })}
            />
          </Field>
          <Field label="Rate (kg / week)" hint="Negative to lose">
            <input
              type="number"
              inputMode="decimal"
              step="0.05"
              value={s.goalKgPerWeek}
              onChange={(e) => patch({ goalKgPerWeek: num(e.target.value) ?? -0.5 })}
            />
          </Field>
        </div>

        {Math.abs(s.goalKgPerWeek) > 0.9 && (
          <div className="tiny" style={{ color: 'var(--serious)' }}>
            Faster than about 0.75-1 kg/week usually costs muscle and adherence. Slower holds better.
          </div>
        )}

        <Field label="Protein target">
          <div className="scroll-x">
            <button
              className="chip"
              aria-pressed={s.proteinMode !== 'pctKcal'}
              onClick={() => patch({ proteinMode: 'gPerKg' })}
            >
              g per kg
            </button>
            <button
              className="chip"
              aria-pressed={s.proteinMode === 'pctKcal'}
              onClick={() => patch({ proteinMode: 'pctKcal' })}
            >
              % of calories
            </button>
          </div>
        </Field>

        {s.proteinMode === 'pctKcal' ? (
          <Field
            label="Protein (% of calories)"
            hint={`${Math.round((preview.kcal * (s.proteinPctKcal ?? 0.3)) / 4)} g at ${preview.kcal} kcal · ${(
              (preview.kcal * (s.proteinPctKcal ?? 0.3)) /
              4 /
              (s.startWeightKg ?? 75)
            ).toFixed(2)} g/kg`}
          >
            <input
              type="number"
              inputMode="numeric"
              value={Math.round((s.proteinPctKcal ?? 0.3) * 100)}
              onChange={(e) => patch({ proteinPctKcal: (num(e.target.value) ?? 30) / 100 })}
            />
          </Field>
        ) : (
          <Field
            label="Protein (g per kg bodyweight)"
            hint={`1.6-2.2 g/kg protects muscle in a deficit · ${Math.round(
              ((s.proteinGPerKg * (s.startWeightKg ?? 75) * 4) / preview.kcal) * 100,
            )}% of calories`}
          >
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={s.proteinGPerKg}
              onChange={(e) => patch({ proteinGPerKg: num(e.target.value) ?? 1.8 })}
            />
          </Field>
        )}

        {preview.protein * 4 + preview.fat * 9 > preview.kcal && (
          <div className="tiny" style={{ color: 'var(--serious)' }}>
            Protein and fat together already exceed the calorie target, leaving no room for carbs.
            Lower one of them.
          </div>
        )}

        <Field label="Fat (% of calories)">
          <input
            type="number"
            inputMode="numeric"
            value={Math.round(s.fatPctKcal * 100)}
            onChange={(e) => patch({ fatPctKcal: (num(e.target.value) ?? 28) / 100 })}
          />
        </Field>

        <Field
          label="Manual calorie target"
          hint="Leave empty to let Salutt derive it from your measured maintenance."
        >
          <input
            type="number"
            inputMode="numeric"
            value={s.kcalTargetOverride ?? ''}
            placeholder={String(preview.kcal)}
            onChange={(e) => patch({ kcalTargetOverride: num(e.target.value) })}
          />
        </Field>

        <Field label="Trend smoothing (days)" hint="Higher is smoother but slower to react. 10 is a good default.">
          <input
            type="number"
            inputMode="numeric"
            value={s.trendHalfLifeDays}
            onChange={(e) => patch({ trendHalfLifeDays: Math.max(1, num(e.target.value) ?? 10) })}
          />
        </Field>

        {s.startWeightKg && (
          <div className="tiny muted num">
            Formula BMR at {s.startWeightKg} kg:{' '}
            {Math.round(bmrMifflin(s.startWeightKg, s.heightCm, ageFrom(s.birthDate), s.sex))} kcal.
          </div>
        )}
      </div>

      {/* ------------------------------------------------ food databases */}
      <div className="card tight">
        <h3>Food databases</h3>
        <div className="small secondary">
          <strong>{dbCount === null ? '…' : dbCount.toLocaleString()} foods built in</strong> — USDA
          generic and whole foods, restaurant and takeaway dishes, and Aldi own-brand groceries.
          Works offline and answers instantly.
        </div>
        <div className="tiny muted">
          Barcode scanning also queries Open Food Facts live, and their text search is used when it
          is up — it is frequently not, which is why the database above ships with the app.
        </div>

        <details>
          <summary className="tiny muted" style={{ cursor: 'pointer' }}>
            USDA API key — not needed
          </summary>
          <div className="stack tight" style={{ paddingTop: 8 }}>
            <div className="tiny muted">
              The built-in database is a snapshot of USDA's generic, restaurant and Aldi foods. A
              free key additionally searches USDA's live catalogue of ~1.9 million branded American
              products. Worth adding only if you keep failing to find a specific packaged item.
            </div>
            <input
              value={s.usdaApiKey ?? ''}
              placeholder="leave empty"
              onChange={(e) => patch({ usdaApiKey: e.target.value.trim() || undefined })}
            />
            <a
              className="tiny"
              href="https://fdc.nal.usda.gov/api-key-signup.html"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Get a free key →
            </a>
          </div>
        </details>
      </div>

      {/* ------------------------------------------------ data */}
      <div className="card tight">
        <h3>Your data</h3>

        {s.syncSecret ? (
          <>
            <div className="tiny" style={{ color: 'var(--success-text)' }}>
              Backed up to the server, encrypted on this device. A new phone needs only your
              recovery code.
            </div>
            {s.lastSync && (
              <div className="tiny muted">
                Last synced {new Date(s.lastSync).toLocaleString()}
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn sm grow"
                disabled={syncBusy}
                onClick={async () => {
                  setSyncBusy(true)
                  try {
                    await syncMerge(s.syncSecret!)
                    toast('Synced')
                    refreshStore()
                  } catch (e) {
                    toast((e as Error).message)
                  } finally {
                    setSyncBusy(false)
                  }
                }}
              >
                {syncBusy ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="btn sm grow" onClick={() => setShowCode((v) => !v)}>
                {showCode ? 'Hide code' : 'Show code'}
              </button>
            </div>
            {showCode && (
              <div className="card tight">
                <div className="tiny muted">Recovery code — this is what restores your data.</div>
                <div className="num" style={{ fontWeight: 650, wordBreak: 'break-all' }}>
                  {s.syncSecret}
                </div>
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(s.syncSecret!)
                      toast('Copied')
                    } catch {
                      toast('Select and copy it by hand')
                    }
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="tiny" style={{ color: 'var(--serious)' }}>
              This log exists only on this phone. Losing or wiping the device loses it.
            </div>
            <button className="btn primary block" onClick={() => setSyncOpen(true)}>
              Set up encrypted sync
            </button>
          </>
        )}

        {store && (
          <>
            <div className="grid-2">
              <div className="stack tight">
                <div className="stat-label">Logged</div>
                <div className="stat-value num">{store.daysLogged}</div>
                <div className="tiny muted">days of food</div>
              </div>
              <div className="stack tight">
                <div className="stat-label">Weigh-ins</div>
                <div className="stat-value num">{store.rows.weighIns}</div>
                <div className="tiny muted">
                  {store.rows.workouts} sessions · {formatBytes(store.usageBytes)}
                </div>
              </div>
            </div>

            {store.persistent ? (
              <div className="tiny" style={{ color: 'var(--success-text)' }}>
                Storage is marked persistent — Android will not evict it to reclaim space.
              </div>
            ) : (
              <div className="stack tight">
                <div className="tiny" style={{ color: 'var(--serious)' }}>
                  Storage is <strong>not</strong> persistent. Android may clear it if the phone runs
                  low on space. Installing Salutt to the home screen usually earns this
                  automatically.
                </div>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const ok = await requestPersistentStorage()
                    toast(ok ? 'Storage is now persistent' : 'The browser declined')
                    refreshStore()
                  }}
                >
                  Request persistent storage
                </button>
              </div>
            )}

          </>
        )}

        {s.lastBackup && (
          <div className="tiny muted">
            Last backup {new Date(s.lastBackup).toLocaleDateString()}
          </div>
        )}

        <button
          className="btn block"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const name = await exportBackup()
              toast(`Saved ${name}`)
              refreshStore()
            } catch (e) {
              if ((e as DOMException)?.name !== 'AbortError') toast('Export failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          Export backup
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setBusy(true)
            try {
              const r = await importBackup(file, true)
              toast(`Restored ${r.counts.entries ?? 0} log entries`)
              onClose()
            } catch (err) {
              toast((err as Error).message || 'Import failed')
            } finally {
              setBusy(false)
            }
          }}
        />
        <button className="btn block" disabled={busy} onClick={() => fileRef.current?.click()}>
          Restore from backup
        </button>
        <div className="tiny muted">Restoring replaces everything currently on this device.</div>
      </div>

      {/* ------------------------------------------------ scale */}
      <div className="card tight">
        <h3>Etekcity scale</h3>
        <div className="tiny muted">
          Salutt talks to the ESF-551 directly over Bluetooth — no VeSync account involved. Sync it
          from the Body tab. Body composition is computed with the same algorithm the VeSync app uses
          for this scale, so the numbers agree with what that app would show.
        </div>
        {scaleBlocked ? (
          <div className="tiny" style={{ color: 'var(--serious)' }}>{scaleBlocked}</div>
        ) : remembers ? (
          <div className="tiny" style={{ color: 'var(--success-text)' }}>
            This browser can remember the scale — open Body with the scale awake and it connects on
            its own, no tap.
          </div>
        ) : (
          <details>
            <summary className="tiny" style={{ cursor: 'pointer', color: 'var(--serious)' }}>
              Remove the device picker (two Chrome flags)
            </summary>
            <div className="stack tight" style={{ paddingTop: 8 }}>
              <div className="tiny muted">
                Chrome forgets Bluetooth devices between visits, so it asks you to pick the scale
                every time. Both switches below are still experimental, which is why they are off by
                default — this is a browser limitation, not a Salutt one. Turn them on and Salutt
                connects by itself whenever you open Body with the scale awake.
              </div>
              <div className="tiny num" style={{ lineHeight: 1.8 }}>
                <div>
                  1. <strong>chrome://flags/#enable-experimental-web-platform-features</strong> →
                  Enabled
                </div>
                <div>
                  2. <strong>chrome://flags/#enable-web-bluetooth-new-permissions-backend</strong> →
                  Enabled
                </div>
                <div>3. Relaunch Chrome, then pair the scale once more.</div>
              </div>
            </div>
          </details>
        )}

        <label className="row between" style={{ gap: 10, cursor: 'pointer' }}>
          <span className="small">
            Athletic body type
            <span className="tiny muted" style={{ display: 'block' }}>
              Shifts the body-fat calculation. Only turn this on if you train hard several times a
              week — otherwise it will read low.
            </span>
          </span>
          <input
            type="checkbox"
            checked={!!s.athlete}
            onChange={(e) => patch({ athlete: e.target.checked })}
            style={{ width: 22, height: 22, flex: 'none' }}
          />
        </label>
      </div>

      {syncOpen && (
        <Sheet title="Encrypted sync" onClose={() => setSyncOpen(false)}>
          <SyncSetup settings={s} onClose={() => setSyncOpen(false)} toast={toast} />
        </Sheet>
      )}

      {/* ------------------------------------------------ danger */}
      <DangerZone toast={toast} onDone={onClose} />

      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Salutt · built {__BUILD__}
      </div>
    </Sheet>
  )
}

function DangerZone({ toast, onDone }: { toast: (m: string) => void; onDone: () => void }) {
  const [armed, setArmed] = useState(false)
  const [confirm, setConfirm] = useState('')

  if (!armed) {
    return (
      <button className="btn ghost block muted" onClick={() => setArmed(true)}>
        Erase all data…
      </button>
    )
  }

  return (
    <div className="card tight">
      <h3 style={{ color: 'var(--critical)' }}>Erase everything</h3>
      <div className="tiny muted">
        This deletes every food, log entry, weigh-in, measurement and session on this device. Export a
        backup first if you might want any of it. Type ERASE to confirm.
      </div>
      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="ERASE" />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => setArmed(false)}>
          Cancel
        </button>
        <button
          className="btn danger grow"
          disabled={confirm !== 'ERASE'}
          onClick={async () => {
            await db.delete()
            toast('All data erased')
            onDone()
            location.reload()
          }}
        >
          <Icon.trash /> Erase
        </button>
      </div>
    </div>
  )
}
