/**
 * Pages of the app load in their own files, so the landing page stays light.
 * The service worker keeps every file of the installed version; without it, a
 * deploy in the middle of a visit removes the old files, and the page reloads
 * once to get the new version. Before reloading it drops the stored copy of
 * the app, which may be the old version itself (as public/boot-recover.js does
 * for the first page).
 */
import { lazy, type ComponentType } from 'react';

const RELOADED_KEY = 'faturometro-chunk-reload';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export async function loadOrReload<T>(
  load: () => Promise<T>,
  storage: Store,
  reload: () => void,
): Promise<T> {
  try {
    const loaded = await load();
    storage.removeItem(RELOADED_KEY);
    return loaded;
  } catch (error) {
    if (storage.getItem(RELOADED_KEY)) throw error;
    storage.setItem(RELOADED_KEY, '1');
    reload();
    return new Promise<T>(() => undefined);
  }
}

/**
 * Removes the stored copy of the app (service worker and its precache), so the
 * next load comes from the server. Data and the other caches are kept.
 */
export async function dropStoredApp(
  serviceWorker: Pick<ServiceWorkerContainer, 'getRegistrations'> | undefined,
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete'> | undefined,
): Promise<void> {
  try {
    const registrations = (await serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const keys = (await cacheStorage?.keys()) ?? [];
    await Promise.all(
      keys
        .filter((key) => key.startsWith('workbox-precache'))
        .map((key) => cacheStorage?.delete(key)),
    );
  } catch {
    // The reload still happens; at worst it brings the stored version again.
  }
}

function reloadCurrentVersion(): void {
  void dropStoredApp(navigator.serviceWorker, window.caches).then(() => window.location.reload());
}

/** A page component loaded on first use (`load` picks the named export). */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => ({
    default: await loadOrReload(load, sessionStorage, reloadCurrentVersion),
  }));
}
