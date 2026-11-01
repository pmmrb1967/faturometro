import { describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './persistent-storage';

describe('requestPersistentStorage', () => {
  it('does not ask again when storage is already persistent', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const persisted = vi.fn(() => Promise.resolve(true));
    await expect(requestPersistentStorage({ persist, persisted })).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks when it is not, and reports the answer', async () => {
    const persisted = vi.fn(() => Promise.resolve(false));
    const granted = vi.fn(() => Promise.resolve(true));
    const refused = vi.fn(() => Promise.resolve(false));
    await expect(requestPersistentStorage({ persist: granted, persisted })).resolves.toBe(true);
    await expect(requestPersistentStorage({ persist: refused, persisted })).resolves.toBe(false);
  });

  it('never throws, with no API or when the browser rejects', async () => {
    const stub = vi.fn(() => Promise.reject(new Error('blocked')));
    await expect(requestPersistentStorage({ persist: stub, persisted: stub })).resolves.toBe(false);
    await expect(
      requestPersistentStorage({} as unknown as Pick<StorageManager, 'persist' | 'persisted'>),
    ).resolves.toBe(false);
  });
});
