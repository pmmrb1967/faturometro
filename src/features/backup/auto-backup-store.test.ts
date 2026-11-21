import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profilesDb, type AutoBackupConfig } from '../../db/profiles';
import type { Session } from '../auth/session-context';
import { runAutoBackup, type AutoBackupOutcome } from './auto-backup-run';
import {
  autoBackupState,
  autoBackupTick,
  backupNow,
  resetAutoBackupState,
} from './auto-backup-store';

vi.mock('./auto-backup-run', () => ({ runAutoBackup: vi.fn() }));
const run = vi.mocked(runAutoBackup);

const session = {
  profile: { id: 'p1', email: 'a@b.pt', createdAt: '2026-11-01' },
} as unknown as Session;

const config: AutoBackupConfig = {
  profileId: 'p1',
  dir: {} as FileSystemDirectoryHandle,
  dirName: 'Faturometro',
  every: 'week',
  keep: 5,
  encrypted: true,
};

const written: AutoBackupOutcome = {
  kind: 'written',
  name: 'faturometro-auto-2026-11-21-1230.zip',
};
const failed: AutoBackupOutcome = { kind: 'error', code: 'write_failed' };

beforeEach(async () => {
  resetAutoBackupState();
  run.mockReset();
  await profilesDb.autoBackups.clear();
});

describe('automatic backup state', () => {
  it('does nothing without a chosen folder', async () => {
    await autoBackupTick(session);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs on schedule, without asking for the folder', async () => {
    await profilesDb.autoBackups.put(config);
    run.mockResolvedValue(written);
    await autoBackupTick(session);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ force: false, interactive: false, config }),
    );
    expect(autoBackupState().outcome).toEqual(written);
  });

  it('stops trying on schedule after an error, until a click', async () => {
    await profilesDb.autoBackups.put(config);
    run.mockResolvedValue(failed);
    await autoBackupTick(session);
    await autoBackupTick(session);
    expect(run).toHaveBeenCalledTimes(1);
    expect(autoBackupState().outcome).toEqual(failed);

    run.mockResolvedValue(written);
    expect(await backupNow(session)).toEqual(written);
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true, interactive: true }),
    );
    await autoBackupTick(session);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('keeps asking on schedule while it only waits for permission', async () => {
    await profilesDb.autoBackups.put(config);
    run.mockResolvedValue({ kind: 'needs_permission' });
    await autoBackupTick(session);
    await autoBackupTick(session);
    expect(run).toHaveBeenCalledTimes(2);
    expect(autoBackupState().outcome).toEqual({ kind: 'needs_permission' });
  });

  it('tries again on schedule when the cloud was only out of reach', async () => {
    await profilesDb.autoBackups.put({ ...config, target: 'cloud' });
    run.mockResolvedValue({ kind: 'error', code: 'cloud_unavailable' });
    await autoBackupTick(session);
    await autoBackupTick(session);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('after a password change', () => {
  it('encrypts scheduled backups with the profile as saved now, not as it was at sign-in', async () => {
    await profilesDb.autoBackups.put(config);
    const renewed = { ...session.profile, wrappedKey: { renewed: true } as never };
    await profilesDb.profiles.put(renewed);
    run.mockResolvedValue(written);
    await autoBackupTick(session);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ profile: renewed }) as unknown,
      }),
    );
    await profilesDb.profiles.delete(renewed.id);
  });
});
