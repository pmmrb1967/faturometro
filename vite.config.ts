/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { headersFile } from './security-headers.ts';
import { PROJECT_SYNC_URL } from './src/sync/default-server.ts';

/** dist/_headers: CSP and other security headers for Cloudflare (security-headers.ts). */
function securityHeaders(syncUrl: string): Plugin {
  return {
    name: 'faturometro-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(syncUrl) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    securityHeaders(loadEnv(mode, process.cwd(), 'VITE_').VITE_SYNC_URL || PROJECT_SYNC_URL),
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
        // "Share → Faturómetro" from email or file apps (handled in public/share-target.js).
        share_target: {
          action: '/app/partilhar',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'file',
                accept: ['application/pdf', '.pdf', 'image/jpeg', 'image/png', 'image/webp'],
              },
            ],
          },
        },
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
        importScripts: ['share-target.js'],
        // ERSE offers (about 4 MB, refreshed weekly): fetched when the comparator opens, then
        // cached. The URL carries the format version (OFFERS_URL), so an update never reads an
        // older cached file.
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
}));
