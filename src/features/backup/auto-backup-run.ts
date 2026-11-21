/**
 * One run of the automatic backup: export, encrypt (unless turned off, or for
 * the guest), write to the chosen folder or the cloud, then remove our oldest copies.
 */
import { CloudError } from '../../cloud/drive';
import { autoBackupFileName, filesToPrune, isDue, tempFilesOf } from '../../domain/auto-backup';
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
import { targetFor, type BackupTarget } from './backup-target';

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
  /** Where to write; by default the one the configuration names. */
  target?: BackupTarget;
}

function errorCode(error: unknown): AutoBackupErrorCode {
  if (error instanceof CloudError) {
    return error.code === 'quota_full' ? 'cloud_full' : 'cloud_unavailable';
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') return 'folder_missing';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'permission_denied';
    }
  }
  return 'write_failed';
}

/** 8 hex characters of the profile id: tells this profile's files from another's. */
export async function profileTag(profileId: string): Promise<string> {
  return (await sha256Hex(profileId)).slice(0, 8);
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

  const target = run.target ?? targetFor(config, session.profile);
  if (!target) {
    const code: AutoBackupErrorCode =
      config.target === 'cloud' ? 'cloud_unavailable' : 'folder_missing';
    await record(config.profileId, { lastError: code });
    return { kind: 'error', code };
  }
  try {
    const allowed = await target.ready(run.interactive);
    if (allowed === null) return { kind: 'needs_permission' };
    if (!allowed) throw new DOMException('Folder permission refused', 'NotAllowedError');

    // Never in clear outside the device: a copy in the cloud is always encrypted.
    const encrypted = (config.encrypted || config.target === 'cloud') && !isGuest(session.profile);
    const { zip } = await exportBackup(session.repos);
    const bytes = encrypted
      ? await encryptBackup(zip, session.masterKey, wrappedKeyOf(session.profile))
      : zip;
    const tag = await profileTag(config.profileId);
    const name = autoBackupFileName(now, encrypted, tag);
    await target.write(name, bytes);
    const names = await target.list();
    for (const old of [...filesToPrune(names, config.keep, tag), ...tempFilesOf(names, tag)]) {
      // An old copy that cannot be removed now goes on the next run.
      await target.remove(old).catch(() => undefined);
    }

    await record(config.profileId, { lastRunAt: now.toISOString(), lastError: undefined });
    await updateSettings(session.repos, { lastBackupAt: now.toISOString().slice(0, 10) });
    return { kind: 'written', name };
  } catch (error) {
    // The cloud sign-in expired: like a folder that needs a click to allow it again.
    if (error instanceof CloudError && error.code === 'needs_reconnect') {
      return { kind: 'needs_permission' };
    }
    const code = errorCode(error);
    await record(config.profileId, { lastError: code });
    return { kind: 'error', code };
  }
}
