/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Faturómetro',
        short_name: 'Faturómetro',
        description: 'Acompanha as faturas da casa, sem os teus dados saírem do dispositivo.',
        lang: 'pt-PT',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f7f4',
        theme_color: '#1f5c4a',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,wasm,woff2}'],
        // ERSE offers (1,7 MB, refreshed weekly): fetched when the comparator opens, then cached.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'erse-data' },
          },
        ],
      },
    }),
  ],
  // HTTPS tunnel for testing on a phone (pnpm tunnel); see README.
  server: { allowedHosts: ['.trycloudflare.com'] },
  preview: { allowedHosts: ['.trycloudflare.com'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
