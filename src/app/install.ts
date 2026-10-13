/**
 * "Install app": Chrome/Edge (Android and computer) fire beforeinstallprompt,
 * which is kept to show the browser's own install dialog from a button.
 * Safari on iPhone/iPad has no such event: the user adds the app from the
 * Share menu, so instructions are shown instead.
 */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  { kind: 'installed' } | { kind: 'prompt' } | { kind: 'ios' } | { kind: 'manual' };

let deferred: BeforeInstallPromptEvent | undefined;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function standalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac with touch.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Called once at start-up, before the browser fires the event. */
export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = undefined;
    notify();
  });
}

let snapshot: InstallState = { kind: 'manual' };

function current(): InstallState {
  const next: InstallState =
    installed || standalone()
      ? { kind: 'installed' }
      : deferred
        ? { kind: 'prompt' }
        : isIos()
          ? { kind: 'ios' }
          : { kind: 'manual' };
  if (next.kind !== snapshot.kind) snapshot = next;
  return snapshot;
}

export function useInstallState(): InstallState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}

/** Shows the browser's install dialog; true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  await event.prompt();
  const { outcome } = await event.userChoice;
  deferred = undefined;
  notify();
  return outcome === 'accepted';
}
