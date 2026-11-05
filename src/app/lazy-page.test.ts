import { describe, expect, it, vi } from 'vitest';
import { dropStoredApp, loadOrReload } from './lazy-page';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe('loadOrReload', () => {
  it('returns the loaded page', async () => {
    const reload = vi.fn();
    const page = await loadOrReload(() => Promise.resolve('page'), memoryStorage(), reload);
    expect(page).toBe('page');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a file of an older version is gone (new deploy)', async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const pending = loadOrReload(() => Promise.reject(new Error('gone')), storage, reload);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // The page is reloading: the promise never settles.
    const settled = await Promise.race([pending.then(() => true), Promise.resolve(false)]);
    expect(settled).toBe(false);

    // After that reload it fails again: the error shows instead of reloading forever.
    await expect(
      loadOrReload(() => Promise.reject(new Error('gone')), storage, reload),
    ).rejects.toThrow('gone');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows a new reload after a page loaded fine', async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    void loadOrReload(() => Promise.reject(new Error('gone')), storage, reload);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await loadOrReload(() => Promise.resolve('page'), storage, reload);
    void loadOrReload(() => Promise.reject(new Error('gone')), storage, reload);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });
});

describe('dropStoredApp', () => {
  it('unregisters the service worker and deletes only its precache', async () => {
    const unregister = vi.fn(async () => true);
    const deleted: string[] = [];
    await dropStoredApp(
      { getRegistrations: async () => [{ unregister } as unknown as ServiceWorkerRegistration] },
      {
        keys: async () => ['workbox-precache-v2-https://app/', 'shared-files', 'erse-data'],
        delete: async (key) => {
          deleted.push(key);
          return true;
        },
      },
    );
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleted).toEqual(['workbox-precache-v2-https://app/']);
  });

  it('settles without a service worker or caches, and when they fail', async () => {
    await expect(dropStoredApp(undefined, undefined)).resolves.toBeUndefined();
    await expect(
      dropStoredApp({ getRegistrations: () => Promise.reject(new Error('blocked')) }, undefined),
    ).resolves.toBeUndefined();
  });
});
