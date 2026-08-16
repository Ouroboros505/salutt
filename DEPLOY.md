# Deploying Salutt

The plan, in the order it should happen:

1. **Host the built app** at a stable HTTPS origin.
2. **Install it from the phone** (Add to Home Screen) and use it.
3. **Optionally wrap it in a TWA APK** at the end — a real Android app that
   still updates over the web, so you install it once and never again.

Step 3 depends on step 1, which is why hosting comes first rather than being a
detour on the way to an APK.

---

## Why a hosted PWA rather than a bundled native app

| | Hosted PWA (+ optional TWA) | Capacitor / bundled APK |
|---|---|---|
| Iterate | save file → live on phone | rebuild + reinstall every time |
| Web Bluetooth (the scale) | works — runs on Chrome's engine | **broken** — Android WebView has no Web Bluetooth |
| Long-term upkeep | none; static files | yearly target-SDK bumps or Play delists you; Gradle/plugin churn |
| Signing key | none | lose it and you can never update the app again |
| Offline | service worker precaches everything | bundled |
| Real app on the phone | yes, once wrapped as a TWA | yes |

Android WebView not implementing Web Bluetooth is the decisive one:
<https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md>

A TWA gets a real APK *without* giving up any of the left column, because the
APK is a ~2 MB shell around your hosted URL rather than a copy of the code.

---

## 1. Host it — Cloudflare Pages

Chosen over GitHub Pages because Pages free tier serves project sites from
`user.github.io/repo/`, a subpath on an origin shared with every other repo you
own. TWA verification claims a whole origin via `/.well-known/assetlinks.json`
at its root, so a subpath deploy makes step 3 messy. `salutt.pages.dev` is its
own origin. It also keeps the source private and does not force a public repo.

### Credentials, headless

This box has no browser, so prefer an API token over the OAuth flow:

1. On your own machine, open <https://dash.cloudflare.com/profile/api-tokens>
2. **Create Token → Custom token**, permission: **Account → Cloudflare Pages → Edit**
3. Then here:

```bash
export CLOUDFLARE_API_TOKEN=<the-token>
npm run deploy
```

Put the export in `~/.bashrc` (or a gitignored `.env.local`) so it persists.

Alternatively `npx wrangler login` works over an SSH tunnel, since the OAuth
callback lands on port 8976 of *this* box:

```bash
ssh -L 8976:localhost:8976 <user>@<host>
npx wrangler login          # open the printed URL in your own browser
```

### Deploying

```bash
npm run deploy      # builds, then uploads dist/ to Cloudflare Pages
```

First run creates the project. Afterwards it is one command, a few seconds.

---

## 2. Install it on the phone

Open `https://salutt.pages.dev` in Chrome → menu → **Add to Home Screen**.

You now have an icon in the app drawer, a window with no browser UI, and the
whole app cached offline. Camera, Web Bluetooth and the service worker all work
because it is a real HTTPS origin — no flags, no ZeroTier, no cable.

**Install from the origin you intend to keep.** Browser storage is keyed to
origin, so a log built up on a dev address does not follow you to the deployed
one. (Recoverable via Settings → Export backup → Restore, but do not find out
the hard way.)

---

## 3. Optional: the TWA APK

Only worth doing if you specifically want a sideloadable file or a Play Store
listing. The installed PWA is otherwise equivalent.

```bash
npx @bubblewrap/cli init --manifest https://salutt.pages.dev/manifest.webmanifest
npx @bubblewrap/cli build
```

Bubblewrap offers to download a JDK and the Android SDK on first run (this box
has `java` but no `gradle`/`sdkmanager`, so let it).

It prints a signing-key fingerprint and generates an `assetlinks.json`. That
file must be served at:

```
https://salutt.pages.dev/.well-known/assetlinks.json
```

Put it in `public/.well-known/assetlinks.json` and redeploy — Vite copies
`public/` verbatim. Without it the APK still runs but shows a browser address
bar, which defeats the point.

**Keep the generated `android.keystore` and its password somewhere safe.** Lose
it and you cannot ship an update to that app ever again — this is the one
irreversible thing in the whole process. It is gitignored deliberately; back it
up alongside your Salutt data exports.
