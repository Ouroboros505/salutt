import { useRef, useState } from 'react'
import { db, saveSettings, type Settings as S } from '../db/db'
import { exportBackup, importBackup } from '../lib/backup'
import { ageFrom, bmrMifflin, computeTargets } from '../lib/metrics'
import { Field, Icon, Sheet } from '../components/ui'
import { bluetoothBlockedReason } from '../lib/scale'

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

        <Field label="Protein (g per kg bodyweight)" hint="1.6-2.2 g/kg protects muscle in a deficit.">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={s.proteinGPerKg}
            onChange={(e) => patch({ proteinGPerKg: num(e.target.value) ?? 1.8 })}
          />
        </Field>

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
        <div className="tiny muted">
          Open Food Facts is always on and needs no key — it covers packaged products with barcodes.
          Add a free USDA FoodData Central key for much better generic and raw ingredients.
        </div>
        <Field label="USDA API key">
          <input
            value={s.usdaApiKey ?? ''}
            placeholder="optional"
            onChange={(e) => patch({ usdaApiKey: e.target.value.trim() || undefined })}
          />
        </Field>
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

      {/* ------------------------------------------------ data */}
      <div className="card tight">
        <h3>Your data</h3>
        <div className="tiny muted">
          Everything lives on this device. Back up regularly — clearing browser storage would take the
          log with it.
        </div>
        {s.lastBackup && (
          <div className="tiny muted">Last backup {new Date(s.lastBackup).toLocaleDateString()}</div>
        )}

        <button
          className="btn block"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const name = await exportBackup()
              toast(`Saved ${name}`)
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
        ) : (
          <div className="tiny" style={{ color: 'var(--success-text)' }}>
            Bluetooth available in this browser.
          </div>
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

      {/* ------------------------------------------------ danger */}
      <DangerZone toast={toast} onDone={onClose} />

      <div className="tiny muted" style={{ textAlign: 'center' }}>
        Salutt · local-first · no accounts, no servers
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
