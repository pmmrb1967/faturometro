/**
 * Service worker updates. Reloading locks the app (the key lives only in
 * memory), so a new version is offered to the user instead of applied
 * automatically in the middle of a task.
 */
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

let needRefresh = false;
const listeners = new Set<() => void>();
let updateServiceWorker: ((reload?: boolean) => Promise<void>) | undefined;

export function registerPwa(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      for (const listener of listeners) listener();
    },
  });
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => needRefresh,
  );
}

export function applyUpdate(): void {
  void updateServiceWorker?.(true);
}
