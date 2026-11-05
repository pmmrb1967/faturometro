/**
 * Pages of the app load in their own files, so the landing page stays light.
 * The service worker keeps every file of the installed version; without it, a
 * deploy in the middle of a visit removes the old files, and the page reloads
 * once to get the new version.
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

/** A page component loaded on first use (`load` picks the named export). */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => ({
    default: await loadOrReload(load, sessionStorage, () => window.location.reload()),
  }));
}
