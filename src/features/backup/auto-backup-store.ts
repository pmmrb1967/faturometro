/** Shared state of the automatic backup (used by the app shell, Início and the settings page). */
import { useEffect, useSyncExternalStore } from 'react';
import { profilesDb } from '../../db/profiles';
import type { Session } from '../auth/session-context';
import { runAutoBackup, type AutoBackupOutcome } from './auto-backup-run';

export const AUTO_BACKUP_CHECK_MINUTES = 60;

export interface AutoBackupState {
  running: boolean;
  outcome?: AutoBackupOutcome;
}

let state: AutoBackupState = { running: false };
/** After an error, the schedule waits for a click in this session (no retry loop). */
let blocked = false;
const listeners = new Set<() => void>();

function set(next: AutoBackupState) {
  state = next;
  for (const listener of listeners) listener();
}

export function autoBackupState(): AutoBackupState {
  return state;
}

/** For tests and when the account is locked. */
export function resetAutoBackupState(): void {
  blocked = false;
  set({ running: false });
}

export function useAutoBackupState(): AutoBackupState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

async function runFor(
  session: Session,
  options: { force: boolean; interactive: boolean },
): Promise<AutoBackupOutcome | null> {
  if (state.running) return null;
  // Read each time: the settings page may have changed it since the last run.
  const config = await profilesDb.autoBackups.get(session.profile.id);
  if (!config) return null;
  // The password may have changed since sign-in (the hook keeps the first session):
  // encrypt with the key as wrapped now, never with a password the user replaced.
  const profile = (await profilesDb.profiles.get(session.profile.id)) ?? session.profile;
  set({ ...state, running: true });
  let outcome: AutoBackupOutcome;
  try {
    outcome = await runAutoBackup({
      session: { ...session, profile },
      config,
      now: new Date(),
      ...options,
    });
  } catch {
    outcome = { kind: 'error', code: 'write_failed' };
  }
  blocked = outcome.kind === 'error';
  // "Not due" says nothing new: keep showing the last real outcome.
  set({ running: false, outcome: outcome.kind === 'not_due' ? state.outcome : outcome });
  return outcome;
}

/** On schedule: never asks for the folder (the browser needs a click for that). */
export async function autoBackupTick(session: Session): Promise<void> {
  if (blocked) return;
  await runFor(session, { force: false, interactive: false });
}

/** "Fazer cópia agora": only from a click. */
export async function backupNow(session: Session): Promise<AutoBackupOutcome | null> {
  return runFor(session, { force: true, interactive: true });
}

/** Backs up when the account opens and every hour while the app is open. */
export function useAutoBackup(session: Session | null): void {
  const profileId = session?.profile.id;
  useEffect(() => {
    if (!session) return;
    resetAutoBackupState();
    const tick = () => void autoBackupTick(session);
    tick();
    const timer = window.setInterval(tick, AUTO_BACKUP_CHECK_MINUTES * 60_000);
    return () => window.clearInterval(timer);
    // Restart only when the profile changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
}
