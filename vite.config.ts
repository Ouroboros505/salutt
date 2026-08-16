import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD_STAMP) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Salutt',
        short_name: 'Salutt',
        description: 'Personal health, nutrition and training log',
        theme_color: '#1a1a19',
        background_color: '#1a1a19',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        categories: ['health', 'fitness', 'lifestyle'],
        // Long-pressing the app icon offers these, the way a native app does.
        shortcuts: [
          {
            name: 'Log food',
            short_name: 'Food',
            description: 'Add something to today',
            url: '/?a=food',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Weigh in',
            short_name: 'Weight',
            description: 'Record today\'s weight',
            url: '/?a=weigh',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Sync scale',
            short_name: 'Scale',
            description: 'Read the Etekcity scale over Bluetooth',
            url: '/?a=scale',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        // Take over as soon as the new worker is installed, so accepting an
        // update needs one reload rather than closing every tab.
        skipWaiting: true,
        clientsClaim: true,
        // Without this every deploy leaves its whole precache behind — and
        // this one includes a 2 MB food database, so a handful of deploys can
        // put a phone under real storage pressure.
        cleanupOutdatedCaches: true,
        // The food database is ~2 MB. Precaching put it in the worker's
        // install step, where it is the largest thing that can fail and it
        // takes the whole app shell down with it if it does. It is fetched on
        // first search instead and cached from there, so the shell installs in
        // a few hundred kilobytes and offline search still works after one use.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // Food-database lookups are cached so a repeated barcode works offline.
        runtimeCaching: [
          {
            // Rarely changes, and a stale copy beats no search at all.
            urlPattern: ({ url }) => url.pathname === '/food-db.json',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'food-db',
              expiration: { maxEntries: 2 },
            },
          },
          {
            urlPattern: /^https:\/\/(world|us)\.openfoodfacts\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'openfoodfacts',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.nal\.usda\.gov\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'usda-fdc',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Bind every interface so the phone can reach the dev server over wifi,
    // ZeroTier or an adb reverse tunnel without passing --host every time.
    host: true,
    // This is a personal dev server on a private machine; the default host
    // allowlist only gets in the way when reaching it by IP or through a tunnel.
    allowedHosts: true,
    // The source tree lives on an rclone FUSE mount, where inotify is unreliable.
    watch: { usePolling: true, interval: 400 },
    // Behind an HTTPS tunnel the page is served on 443 while Vite still listens
    // on 5173, so the HMR socket has to be told where to reconnect.
    hmr: process.env.TUNNEL_HOST
      ? { protocol: 'wss', host: process.env.TUNNEL_HOST, clientPort: 443 }
      : undefined,
  },
})
