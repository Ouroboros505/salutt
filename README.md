# Salutt

A personal health log: food, body, training. Installable PWA — runs on an Android
home screen and in Chrome on the desktop from the same codebase.

Everything lives in the browser's IndexedDB **on the device**. No account, no
server, no third party holding your health data. Back up with a JSON file.

---

## Running it

```bash
npm install          # node_modules is bind-mounted from ~/Storage (see below)
npm run dev          # http://localhost:5173
npm run build        # static files into dist/
npm run preview      # serve the built version
npm run test:scale   # golden-vector check of the scale protocol + body comp
```

During development, `http://localhost:5173/?demo=1` **wipes the database** and
fills it with six weeks of plausible history — useful for looking at the charts
without waiting six weeks. It is stripped from production builds.

### node_modules

The source tree lives on the rclone Google Drive mount, where thousands of
package files would be a disaster. Following the same pattern as
`montejongas-web` on this machine:

```bash
mkdir -p ~/Storage/Developer/modules/salutt
bindfs ~/Storage/Developer/modules/salutt \
       ~/Drive/personal/Personal/Salutt/node_modules
```

The bind mount does not survive a reboot — re-run that line if `npm` suddenly
wants to reinstall everything.

---

## Getting it onto the phone

```bash
npm run dev      # binds every interface
npm run phone    # prints every reachable URL + a QR code to scan
```

Plain `http://` gives you the UI and live reload. It does **not** give you the
camera (barcode scanning), Web Bluetooth (the scale), or Add to Home Screen —
all three need a **secure context**. `localhost` counts, so the simplest way to
get one on a machine you are not sitting at is an SSH tunnel:

```bash
ssh -L 5173:localhost:5173 <user>@<host>     # then open http://localhost:5173
```

For the phone, deploy it (see `DEPLOY.md`) and install from the HTTPS URL. Real
certificates mean every capability works with no flags.

### Pick the permanent URL *before* logging real data

Browser storage is keyed to **origin**. A PWA installed from a dev address and
one installed from `https://salutt.pages.dev` are two different apps with two
different databases. Whichever you install from owns your log.

Recoverable via Settings → Export backup then Restore on the other origin, but
much easier to choose first. Once installed, the service worker caches the whole
app, so it keeps working with the dev machine switched off.

If deploying under a subpath, set `base` in `vite.config.ts`.

---

## How it works

### Trend weight, not scale weight

Daily weight is mostly water, gut contents and glycogen. Salutt shows a smoothed
trend and keeps the raw readings as faint dots behind it.

The smoothing is **Brown's double exponential**, not the usual single EMA. A
single EMA is smooth but *lags*: while you are losing steadily it sits above your
real weight by roughly `half-life / ln 2 × rate` — about 0.9 kg at a 10-day
half-life and 0.45 kg/week. Smoothing the smoothed series measures that lag, and
`2·s1 − s2` adds it back. Simulated over 400 runs, this cut the error on the
displayed number from 0.86 kg to 0.20 kg while staying nearly as smooth.

The smoothing factor comes from the actual gap between weigh-ins, so skipping
days does not distort the curve.

### Adaptive maintenance calories

Since both intake and weight are logged, maintenance can be *measured* instead of
guessed:

```
TDEE = mean intake − (trend weight change in kg × 7700) / days
```

After ~2-3 weeks this beats any BMR formula, because it is measured on you and
already includes however much you train. Until there is enough data, the target
falls back to Mifflin-St Jeor and the Today screen says so.

Days you did not log are **excluded**, not averaged in as zero — otherwise
forgetting to log would fake a deficit that never happened.

Because maintenance already reflects your training, **workout calories are never
added back to the target**.

### Fast food entry

The thing that kills every food app. Salutt attacks it four ways:

- **Your library answers instantly** — local search hits before any network call.
- **Quick-add chips** for what you actually eat, ranked by frequency × recency.
- **Quick meals** — save a whole meal, re-log it in one tap. Plus *Copy yesterday*.
- **Barcode scanning** via Chrome's built-in `BarcodeDetector` (no library), with
  Open Food Facts behind it; type the number if the camera is unavailable.

Portions are remembered: log something as "1 cup" and that is preselected next time.

Logged entries **snapshot** their macros. Correcting a food later never silently
rewrites days you already logged.

### Food databases

- **Open Food Facts** — always on, no key. Packaged products, barcodes, worldwide.
- **USDA FoodData Central** — optional free key in Settings. Much better for raw
  and generic ingredients. Get one at <https://fdc.nal.usda.gov/api-key-signup.html>.

Both are cached by the service worker, so a repeated barcode works offline.

---

## Your data

Settings → **Export backup** writes a JSON file with everything. On desktop Chrome
you get a real save dialog (point it at `backups/` in this folder); on Android it
downloads. **Restore** replaces everything on the device.

Back up regularly. Clearing browser storage takes the log with it. Salutt calls
`navigator.storage.persist()` on startup, which stops routine eviction, but it is
not a substitute for a file you actually hold.

---

## The Etekcity ESF-551 scale

Wired up, over Web Bluetooth, with no VeSync account involved. **Body → Sync
scale**, then step on it barefoot.

The ESF-551 is the easy case: it delivers readings as GATT **notifications**
after you connect, not as BLE advertisements. Advertisement scanning
(`requestLEScan`) is still behind an experimental Chrome flag, but plain
connect-and-subscribe is fully supported — so this needs **no flags**, only a
secure context and a tap to open the device chooser.

The scale reports exactly two numbers: **weight** and **bioelectrical impedance
in ohms**. Body fat, muscle, water, visceral fat and the rest are all *derived*,
and every vendor pairs its scales with a particular derivation algorithm. Salutt
ports the one the VeSync app uses for the ESF-551, so its numbers agree with what
that app would have shown. Both the raw impedance and the derived values are
stored, so the composition can be recomputed if your height ever changes.

Protocol and algorithm come from the reverse-engineered
[etekcity_esf551_ble](https://github.com/ronnnnnnnnnnnnn/etekcity_esf551_ble)
project:

```
notify characteristic  0000fff1-…    22-byte frames
write characteristic   0000fff2-…    display-unit command

byte  0..1   a5 02        header
byte  3..4   10 00
byte  6..9   01 61 a1 00
byte 10..12  weight, 24-bit little-endian, grams
byte 13..14  impedance, 16-bit little-endian, ohms
byte 19      1 = reading final; otherwise still settling
byte 20      1 = impedance field valid
byte 21      display unit: 0 kg, 1 lb, 2 st
```

The weight arrives first and the impedance pass finishes a second or two later,
so the sync sheet keeps the first stable frame and upgrades it when a frame
carrying impedance shows up.

The vendor never documented **which service** holds `fff1`, and the Python
reference never needs to know (bleak resolves characteristics across all
services). Web Bluetooth does need it, so `src/lib/scale.ts` declares a list of
candidates and probes them at connect time — `fff0` is the conventional pairing
and almost certainly right. If none matches, the error names the services that
*were* found, which is enough to add the correct UUID in one line.

### Verifying it

`npm run test:scale` checks 400 synthetic BLE frames and 9,900 derived
composition values against golden vectors generated from the Python reference.
They must match **exactly**, not approximately: body fat is *floored* off a BMI
derived from the weight, so one digit in the last decimal propagates into every
downstream metric.

That exactness needs Python's rounding, which is neither of the obvious JS
equivalents — see `src/lib/round.ts`. `Math.round(v * 100) / 100` is wrong
because the multiply's own error can shove a value sitting just below a midpoint
past it, and `toFixed` is wrong at genuine midpoints such as `3.625` or
`151.625`, which real gram readings hit often. Getting this wrong produced 47
mismatched values on the first pass.

### If it will not connect

- **No "Sync scale" response / "not available here"** — Web Bluetooth needs
  Chrome (Android or desktop) and a secure context. Safari and Firefox have no
  Web Bluetooth at all.
- **The chooser is empty** — the scale only advertises for a few seconds after it
  wakes. Step on it, then hit connect.
- **VeSync is holding it** — a BLE peripheral accepts one connection at a time.
  Force-quit VeSync first.

---

## Layout

```
src/
  db/
    db.ts       Dexie schema and types
    ops.ts      logging, scaling, search, quick-add ranking
    demo.ts     dev-only seed data
  lib/
    metrics.ts  trend smoothing, adaptive TDEE, targets, body fat
    scale.ts    ESF-551 over Web Bluetooth
    bodyComp.ts impedance -> body composition (VeSync's algorithm)
    round.ts    Python-compatible rounding, needed by both of the above
    foodApi.ts  Open Food Facts + USDA
    backup.ts   export / import
    date.ts     local calendar days
  components/
    charts.tsx  trend line and bar chart (hand-rolled SVG)
    AddFood.tsx search → portion → log
    ScaleSync.tsx connect → read → save
    BarcodeScanner.tsx
    ui.tsx      sheet, fields, icons
  screens/      Today, Foods, Body, Train, Insights, Settings
test/
  scale.test.ts + golden vectors from the Python reference
```

Chart colours are a validated categorical palette — the three macro colours clear
colourblind-separation and contrast gates in both light and dark mode.
