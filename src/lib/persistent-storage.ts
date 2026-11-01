type StorageApi = Pick<StorageManager, 'persist' | 'persisted'>;

/**
 * Asks the browser not to evict this site's data when space runs short. The browser decides
 * and may refuse silently, so this is a best effort: never a reason to stop the app.
 */
export async function requestPersistentStorage(
  storage: StorageApi | undefined = navigator.storage,
): Promise<boolean> {
  try {
    if (!storage?.persist || !storage.persisted) return false;
    return (await storage.persisted()) || (await storage.persist());
  } catch {
    return false;
  }
}
