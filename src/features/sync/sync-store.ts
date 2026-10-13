/** Shared sync status (used by the automatic sync and by the settings page). */
import { useEffect, useSyncExternalStore } from 'react';
import { runSync, SyncError, type SyncErrorCode } from '../../sync/account';
import { refreshAlerts } from '../alerts/refresh';
import type { Session } from '../auth/session-context';

export const AUTO_SYNC_MINUTES = 5;

export interface SyncStatus {
  running: boolean;
  error?: SyncErrorCode | 'unexpected';
  lastReceived?: number;
  lastConflicts?: number;
}

let status: SyncStatus = { running: false };
const listeners = new Set<() => void>();

function set(next: SyncStatus) {
  status = next;
  for (const listener of listeners) listener();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}

export async function syncSession(
  session: Session,
  updateProfile: (profile: Session['profile']) => void,
): Promise<void> {
  if (!session.profile.sync || status.running) return;
  set({ ...status, running: true });
  try {
    const { profile, result } = await runSync(session);
    updateProfile(profile);
    if (result.received > 0) await refreshAlerts(session.repos);
    set({ running: false, lastReceived: result.received, lastConflicts: result.conflicts });
  } catch (error) {
    set({ running: false, error: error instanceof SyncError ? error.code : 'unexpected' });
  }
}

/** Syncs when the app opens, every few minutes and when the connection comes back. */
export function useAutoSync(
  session: Session | null,
  updateProfile: (profile: Session['profile']) => void,
): void {
  const enabled = Boolean(session?.profile.sync);
  const profileId = session?.profile.id;
  useEffect(() => {
    if (!session || !enabled) return;
    const run = () => void syncSession(session, updateProfile);
    run();
    const timer = window.setInterval(run, AUTO_SYNC_MINUTES * 60_000);
    window.addEventListener('online', run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', run);
    };
    // Restart only when sync is turned on/off or the profile changes, not on every sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, profileId]);
}
