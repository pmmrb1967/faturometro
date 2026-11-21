/**
 * One run of the automatic backup: export, encrypt (unless turned off, or for
 * the guest), write to the chosen folder, then remove our oldest copies.
 */
import {
  autoBackupFileName,
  filesToPrune,
  isDue,
  TEMP_SUFFIX,
  tempFilesOf,
} from '../../domain/auto-backup';
import { sha256Hex } from '../../lib/crypto';
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

/** 8 hex characters of the profile id: tells this profile's files from another's. */
export async function profileTag(profileId: string): Promise<string> {
  return (await sha256Hex(profileId)).slice(0, 8);
}

interface MovableFile {
  move?: (newName: string) => Promise<void>;
}

/**
 * Writes under a temporary name the backup names never match, then renames it:
 * a write cut short (the browser closed) never looks like a backup.
 */
async function writeTo(file: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await file.createWritable();
  await writable.write(new Uint8Array(bytes));
  await writable.close();
}

async function exists(folder: BackupFolder, name: string): Promise<boolean> {
  try {
    await folder.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function write(folder: BackupFolder, name: string, bytes: Uint8Array): Promise<void> {
  const temp = `${name}${TEMP_SUFFIX}`;
  const file = (await folder.getFileHandle(temp, { create: true })) as FileSystemFileHandle &
    MovableFile;
  if (file.move) {
    try {
      await writeTo(file, bytes);
      await file.move(name);
    } catch (error) {
      await folder.removeEntry(temp).catch(() => undefined);
      throw error;
    }
    return;
  }
  // Without move() (older browsers): straight to the final name.
  await folder.removeEntry(temp).catch(() => undefined);
  const existed = await exists(folder, name);
  try {
    await writeTo(await folder.getFileHandle(name, { create: true }), bytes);
  } catch (error) {
    // Remove only what this run created: a good backup already under `name` stays.
    if (!existed) await folder.removeEntry(name).catch(() => undefined);
    throw error;
  }
}

async function prune(folder: BackupFolder, keep: number, tag: string): Promise<void> {
  const names: string[] = [];
  for await (const name of folder.keys()) names.push(name);
  for (const name of [...filesToPrune(names, keep, tag), ...tempFilesOf(names, tag)]) {
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
    const tag = await profileTag(config.profileId);
    const name = autoBackupFileName(now, encrypted, tag);
    await write(folder, name, bytes);
    await prune(folder, config.keep, tag);

    await record(config.profileId, { lastRunAt: now.toISOString(), lastError: undefined });
    await updateSettings(session.repos, { lastBackupAt: now.toISOString().slice(0, 10) });
    return { kind: 'written', name };
  } catch (error) {
    const code = errorCode(error);
    await record(config.profileId, { lastError: code });
    return { kind: 'error', code };
  }
}
