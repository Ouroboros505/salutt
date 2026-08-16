import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
      },
      workbox: {
        // Food-database lookups are cached so a repeated barcode works offline.
        runtimeCaching: [
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
