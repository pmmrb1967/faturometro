/**
 * One run of the automatic backup: export, encrypt (unless turned off, or for
 * the guest), write to the chosen folder, then remove our oldest copies.
 */
import { autoBackupFileName, filesToPrune, isDue } from '../../domain/auto-backup';
import {
  isGuest,
  profilesDb,
  wrappedKeyOf,
  type AutoBackupConfig,
  type AutoBackupErrorCode,
} from '../../db/profiles';
import type { Session } from '../auth/session-context';
import { updateSettings } from '../settings/settings';
import { exportBackup } from './backup';
import { encryptBackup } from './encrypted-backup';
import { asBackupFolder, type BackupFolder } from './fs-access';

export type AutoBackupOutcome =
  | { kind: 'written'; name: string }
  | { kind: 'not_due' }
  | { kind: 'needs_permission' }
  | { kind: 'error'; code: AutoBackupErrorCode };

export interface AutoBackupRun {
  session: Pick<Session, 'profile' | 'repos' | 'masterKey'>;
  config: AutoBackupConfig;
  now: Date;
  /** From "Fazer cópia agora": ignores the schedule. */
  force: boolean;
  /** From a click: the browser lets the app ask for the folder again. */
  interactive: boolean;
}

function errorCode(error: unknown): AutoBackupErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') return 'folder_missing';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'permission_denied';
    }
  }
  return 'write_failed';
}

async function hasPermission(folder: BackupFolder, interactive: boolean): Promise<boolean | null> {
  const mode = { mode: 'readwrite' } as const;
  const current = await folder.queryPermission(mode);
  if (current === 'granted') return true;
  if (!interactive) return null;
  return (await folder.requestPermission(mode)) === 'granted';
}

async function write(folder: BackupFolder, name: string, bytes: Uint8Array): Promise<void> {
  const file = await folder.getFileHandle(name, { create: true });
  try {
    const writable = await file.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  } catch (error) {
    // The handle already created an empty file with a valid name: never leave it behind.
    await folder.removeEntry(name).catch(() => undefined);
    throw error;
  }
}

async function prune(folder: BackupFolder, keep: number): Promise<void> {
  const names: string[] = [];
  for await (const name of folder.keys()) names.push(name);
  for (const name of filesToPrune(names, keep)) {
    // An old copy that cannot be removed now goes on the next run.
    await folder.removeEntry(name).catch(() => undefined);
  }
}

async function record(profileId: string, patch: Partial<AutoBackupConfig>): Promise<void> {
  const stored = await profilesDb.autoBackups.get(profileId);
  if (!stored) return;
  const next: AutoBackupConfig = { ...stored, ...patch };
  if (patch.lastError === undefined) delete next.lastError;
  await profilesDb.autoBackups.put(next);
}

export async function runAutoBackup(run: AutoBackupRun): Promise<AutoBackupOutcome> {
  const { session, config, now } = run;
  if (!run.force && !isDue(config.lastRunAt, config.every, now)) return { kind: 'not_due' };
  // Stored before the first run, so the outcome can be recorded.
  if (!(await profilesDb.autoBackups.get(config.profileId))) {
    await profilesDb.autoBackups.put(config);
  }

  const folder = asBackupFolder(config.dir);
  try {
    const allowed = await hasPermission(folder, run.interactive);
    if (allowed === null) return { kind: 'needs_permission' };
    if (!allowed) throw new DOMException('Folder permission refused', 'NotAllowedError');

    const encrypted = config.encrypted && !isGuest(session.profile);
    const { zip } = await exportBackup(session.repos);
    const bytes = encrypted
      ? await encryptBackup(zip, session.masterKey, wrappedKeyOf(session.profile))
      : zip;
    const name = autoBackupFileName(now, encrypted);
    await write(folder, name, bytes);
    await prune(folder, config.keep);

    await record(config.profileId, { lastRunAt: now.toISOString(), lastError: undefined });
    await updateSettings(session.repos, { lastBackupAt: now.toISOString().slice(0, 10) });
    return { kind: 'written', name };
  } catch (error) {
    const code = errorCode(error);
    await record(config.profileId, { lastError: code });
    return { kind: 'error', code };
  }
}
