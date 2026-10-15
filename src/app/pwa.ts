/**
 * Service worker updates. Reloading keeps the session (session-store.ts) but
 * loses what is being typed, so inside the app a new version is offered
 * instead of applied in the middle of a task; signed out, it is applied at
 * once (update-policy.ts).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { updateAction } from './update-policy';

/** Installed apps resumed from memory never reload: look for new versions now and then. */
const CHECK_MINUTES = 60;

let needRefresh = false;
let signedIn = false;
let holds = 0;
const listeners = new Set<() => void>();
let updateServiceWorker: ((reload?: boolean) => Promise<void>) | undefined;

function settle() {
  const action = updateAction({ needRefresh, signedIn, held: holds > 0 });
  if (action === 'apply') applyUpdate();
  for (const listener of listeners) listener();
}

export function registerPwa(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      settle();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => undefined);
      window.setInterval(check, CHECK_MINUTES * 60_000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

/** Called by the session provider: whether someone is signed in. */
export function setSignedIn(value: boolean): void {
  signedIn = value;
  settle();
}

/** Keeps a new version from reloading the page while `active` (one-time screens). */
export function useHoldUpdates(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    holds++;
    return () => {
      holds--;
      // Next tick: leaving the recovery key signs in, and that must count first.
      window.setTimeout(settle, 0);
    };
  }, [active]);
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
