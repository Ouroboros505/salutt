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
| Long-term upkeep | none; static files | Gradle/plugin churn on every SDK upgrade |
| Signing key | only to change the shell | lose it and you can never update the app again |
| Offline | service worker precaches everything | bundled |
| Real app on the phone | yes, once wrapped as a TWA | yes |

Android WebView not implementing Web Bluetooth is the decisive one:
<https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md>

A TWA gets a real APK *without* giving up any of the left column, because the
APK is a ~2 MB shell around your hosted URL rather than a copy of the code.

**None of this requires the Play Store.** Sideloading a signed APK is fine, and
it sidesteps Play's yearly target-SDK deadline entirely — that is a store
policy, not an Android one, and a sideloaded app keeps working regardless. It
also means the signing key matters far less here than for a bundled app: with a
TWA you almost never rebuild the shell, because content updates arrive over the
web. Back the keystore up anyway, but it is not the landmine it would be for a
Capacitor build.

---

## 1. Host it — Cloudflare Pages, on a domain you own

Same Cloudflare account as `montejongas.com`. That site is a Next.js app
deployed as a **Worker** (OpenNext); Salutt is pure static files, so it belongs
in **Pages** — a separate project in the same account. They do not interact.

Chosen over GitHub Pages because Pages free tier serves project sites from
`user.github.io/repo/`, a subpath on an origin shared with every other repo you
own. TWA verification claims a whole origin via `/.well-known/assetlinks.json`
at its root, so a subpath deploy makes step 3 messy.

### Use `salutt.montejongas.com`, not `salutt.pages.dev`

Both are free and both get automatic certificates. Prefer the one on your own
domain, for a reason that only shows up years later:

**Browser storage is keyed to origin, and `pages.dev` is not an origin you
own.** If you ever leave Cloudflare, that hostname stops resolving and the
installed PWA's database goes with it. A domain you control can be pointed at
any host, forever, and the app carries on with its data intact.

Cloudflare already runs the `montejongas.com` zone, so adding the custom domain
to the Pages project creates the DNS record and issues the certificate
automatically — nothing to configure by hand.

### How private is it, really

Chosen hostname: **`salutt.montejongas.com`**.

**Out of Google: yes, reliably.** Every response carries
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` (see `public/_headers`).
`robots.txt` deliberately *allows* crawling — that is not a mistake. robots.txt
only asks crawlers not to fetch, and a URL blocked that way can still be listed
if anything links to it; blocking would also hide the noindex header from the
crawler that needs to read it. Allow + noindex is the combination that actually
keeps it out of the index.

**Unknowable: no, and nothing can achieve that.** Every publicly-trusted
certificate is published to Certificate Transparency logs, so anyone querying
crt.sh can enumerate subdomains of `montejongas.com`. Unavoidable for any real
HTTPS certificate anywhere.

That costs nothing in practice. A stranger who finds the URL gets an **empty
app** — their own blank instance, in their own browser. There is no account to
attack and no server-side data to leak, because your log lives only in your
device's IndexedDB.

If you want it genuinely gated, **Cloudflare Access** (Zero Trust, free tier)
puts an email-code login in front of the origin. Know the cost first: sessions
expire, and an expired session inside an installed PWA means a login page in a
window with no address bar. For an app with nothing to protect server-side that
is friction bought with little security. Worth it only if the *association*
between a personal health app and your business domain is the thing that
bothers you — and a separate domain is the cleaner fix for that.

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

Open your deployed URL in Chrome → menu → **Add to Home Screen**.

You now have an icon in the app drawer, a window with no browser UI, and the
whole app cached offline. Camera, Web Bluetooth and the service worker all work
because it is a real HTTPS origin — no flags, no ZeroTier, no cable.

**Install from the origin you intend to keep.** Browser storage is keyed to
origin, so a log built up on a dev address does not follow you to the deployed
one. (Recoverable via Settings → Export backup → Restore, but do not find out
the hard way.)

---

## 3. Optional: the TWA APK

Only worth doing if you specifically want a sideloadable file. The installed
PWA is otherwise equivalent — same icon, same standalone window, same offline
behaviour. No Play Store account required; you can host the APK yourself and
download it on the phone, allowing "install unknown apps" once.

```bash
npx @bubblewrap/cli init --manifest https://salutt.montejongas.com/manifest.webmanifest
npx @bubblewrap/cli build
```

Bubblewrap offers to download a JDK and the Android SDK on first run (this box
has `java` but no `gradle`/`sdkmanager`, so let it).

It prints a signing-key fingerprint and generates an `assetlinks.json`. That
file must be served at:

```
https://salutt.montejongas.com/.well-known/assetlinks.json
```

Put it in `public/.well-known/assetlinks.json` and redeploy — Vite copies
`public/` verbatim. Without it the APK still runs but shows a browser address
bar, which defeats the point.

**Keep the generated `android.keystore` and its password somewhere safe.** Lose
it and you cannot update *that installed app* again — you would have to
uninstall and sideload a fresh one, which wipes its storage. It matters less
here than for a bundled app, since the shell rarely changes, but it is still the
only irreversible artefact in the process. Gitignored deliberately; back it up
alongside your Salutt data exports.
