import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '뷰티포스트',
        short_name: '뷰티포스트',
        description: '뷰티 원장님을 위한 SNS 자동화 서비스',
        theme_color: '#a23553',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache only hashed, immutable assets — NOT index.html. The app
        // shell is always fetched fresh from the network (Vercel serves it with
        // no-cache), so a new deploy's chunk hashes are picked up immediately
        // and we never serve a stale shell that points at deleted chunks.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.vercel\.blob\.store\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
      '@beautypost/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      // 더 구체적인 경로를 먼저 (별칭은 앞에서부터 접두어로 맞춘다)
      '@beautypost/platform/web': resolve(__dirname, '../../packages/platform/src/web/index.ts'),
      '@beautypost/platform': resolve(__dirname, '../../packages/platform/src/index.ts'),
      '@beautypost/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: true }, // 다른 포트의 테스트 API 는 API_PROXY
    },
  },
})
