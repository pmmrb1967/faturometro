import { describe, expect, it, vi } from 'vitest';
import { loadOrReload } from './lazy-page';

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
