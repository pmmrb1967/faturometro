/** Default sync server (override at build time with VITE_SYNC_URL). */
export const DEFAULT_SYNC_URL: string =
  import.meta.env.VITE_SYNC_URL ?? 'https://faturometro-sync.faturometro.workers.dev';
