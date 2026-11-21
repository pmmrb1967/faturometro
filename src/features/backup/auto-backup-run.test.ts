import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb, type AutoBackupConfig, type Profile } from '../../db/profiles';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys, sha256Hex, type NewAccountKeys } from '../../lib/crypto';
import { getSettings } from '../settings/settings';
import { importBackup } from './backup';
import { runAutoBackup } from './auto-backup-run';
import { CLOUD_BACKUP_FOLDER, cloudTarget } from './backup-target';
import { MemoryDrive } from '../../cloud/memory-drive';
import { isEncryptedBackup } from './encrypted-backup';
import type { BackupFolder, FolderPermission } from './fs-access';

/**
 * In-memory folder. Like Chrome: a file exists (empty) as soon as its handle is
 * created, the content lands on close(), and move() renames over an existing name.
 */
class FakeFolder implements BackupFolder {
  readonly name = 'Faturometro';
  files = new Map<string, Uint8Array>();
  permission: FolderPermission = 'granted';
  grantOnRequest = true;
  failClose = false;
  missing = false;
  supportsMove = true;

  queryPermission() {
    return Promise.resolve(this.permission);
  }
  requestPermission() {
    if (this.grantOnRequest) this.permission = 'granted';
    return Promise.resolve(this.permission);
  }
  getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.missing) return Promise.reject(new DOMException('gone', 'NotFoundError'));
    if (!this.files.has(name)) {
      if (!options?.create) return Promise.reject(new DOMException('no file', 'NotFoundError'));
      this.files.set(name, new Uint8Array());
    }
    let current = name;
    const chunks: Uint8Array[] = [];
    const handle: Record<string, unknown> = {
      createWritable: () =>
        Promise.resolve({
          write: (data: Uint8Array) => {
            chunks.push(data);
            return Promise.resolve();
          },
          close: () => {
            if (this.failClose) {
              return Promise.reject(new DOMException('full', 'QuotaExceededError'));
            }
            this.files.set(current, chunks[0] ?? new Uint8Array());
            return Promise.resolve();
          },
          abort: () => Promise.resolve(),
        }),
    };
    if (this.supportsMove) {
      handle.move = (newName: string) => {
        const bytes = this.files.get(current) ?? new Uint8Array();
        this.files.delete(current);
        this.files.set(newName, bytes);
        current = newName;
        return Promise.resolve();
      };
    }
    return Promise.resolve(handle as unknown as FileSystemFileHandle);
  }
  removeEntry(name: string) {
    this.files.delete(name);
    return Promise.resolve();
  }
  async *keys() {
    for (const name of [...this.files.keys()]) yield await Promise.resolve(name);
  }
}

const NOW = new Date('2026-11-21T12:30');
let keys: NewAccountKeys;
let repos: Repositories;
let folder: FakeFolder;
let account: Profile;
let guest: Profile;
/** The tag of `account` in file names. */
let tag: string;

const name = (stamp: string, encrypted = true, owner = tag) =>
  `faturometro-auto-${owner}-${stamp}${encrypted ? '-cifrado' : ''}.zip`;
const autoNames = () =>
  [...folder.files.keys()].filter((file) => file.startsWith('faturometro-auto-')).sort();

function configFor(profile: Profile, patch: Partial<AutoBackupConfig> = {}): AutoBackupConfig {
  return {
    profileId: profile.id,
    dir: folder as unknown as FileSystemDirectoryHandle,
    dirName: folder.name,
    every: 'week',
    keep: 5,
    encrypted: true,
    ...patch,
  };
}

function run(
  profile: Profile,
  config: AutoBackupConfig,
  options: { force?: boolean; interactive?: boolean; now?: Date } = {},
) {
  return runAutoBackup({
    session: { profile, repos, masterKey: keys.masterKey },
    config,
    now: options.now ?? NOW,
    force: options.force ?? false,
    interactive: options.interactive ?? false,
  });
}

beforeEach(async () => {
  keys = await createAccountKeys('palavra-passe', 1_000);
  repos = createRepositories(new ProfileDb(crypto.randomUUID()), keys.masterKey);
  await repos.providers.put({
    id: 'p1',
    nif: '500000000',
    name: 'NOS',
    sectors: ['telecom'],
  } as never);
  folder = new FakeFolder();
  account = {
    id: crypto.randomUUID(),
    email: 'a@b.pt',
    createdAt: '2026-11-01',
    wrappedKey: keys.wrapped,
  };
  guest = { id: crypto.randomUUID(), email: '', createdAt: '2026-11-01', guestKey: 'AAAA' };
  tag = (await sha256Hex(account.id)).slice(0, 8);
});

describe('runAutoBackup', () => {
  it('does nothing before it is due', async () => {
    const config = configFor(account, { lastRunAt: new Date('2026-11-20T10:00').toISOString() });
    expect(await run(account, config)).toEqual({ kind: 'not_due' });
    expect(folder.files.size).toBe(0);
  });

  it('writes an encrypted backup and records it', async () => {
    const outcome = await run(account, configFor(account));
    expect(outcome).toEqual({ kind: 'written', name: name('2026-11-21-1230') });
    const bytes = folder.files.get(name('2026-11-21-1230'));
    expect(bytes && isEncryptedBackup(bytes)).toBe(true);
    expect([...folder.files.keys()]).toEqual([name('2026-11-21-1230')]);
    expect(await profilesDb.autoBackups.get(account.id)).toMatchObject({
      lastRunAt: NOW.toISOString(),
    });
    expect((await getSettings(repos)).lastBackupAt).toBe(NOW.toISOString().slice(0, 10));
  });

  it('writes a plain backup when encryption is off', async () => {
    await run(account, configFor(account, { encrypted: false }));
    const bytes = folder.files.get(name('2026-11-21-1230', false));
    expect(bytes).toBeDefined();
    const target = createRepositories(new ProfileDb(crypto.randomUUID()), keys.masterKey);
    await importBackup(target, bytes ?? new Uint8Array());
    expect((await target.providers.list()).map((provider) => provider.name)).toEqual(['NOS']);
  });

  it('writes in clear for the guest, who has no password', async () => {
    const guestTag = (await sha256Hex(guest.id)).slice(0, 8);
    const outcome = await run(guest, configFor(guest, { encrypted: true }));
    expect(outcome).toEqual({ kind: 'written', name: name('2026-11-21-1230', false, guestTag) });
  });

  it('removes only its own oldest automatic backups beyond the kept number', async () => {
    for (const day of ['01', '02', '03', '04', '05']) {
      folder.files.set(name(`2026-11-${day}-1000`), new Uint8Array([1]));
    }
    folder.files.set(name('2026-10-01-1000', true, '9f8e7d6c'), new Uint8Array([1]));
    folder.files.set('faturometro-2026-11-01.zip', new Uint8Array([1]));
    folder.files.set('notas.txt', new Uint8Array([1]));
    await run(account, configFor(account));
    expect(autoNames()).toEqual(
      [
        name('2026-10-01-1000', true, '9f8e7d6c'),
        name('2026-11-02-1000'),
        name('2026-11-03-1000'),
        name('2026-11-04-1000'),
        name('2026-11-05-1000'),
        name('2026-11-21-1230'),
      ].sort(),
    );
    expect(folder.files.has('faturometro-2026-11-01.zip')).toBe(true);
    expect(folder.files.has('notas.txt')).toBe(true);
  });

  it('waits for a click when the browser asks again for the folder', async () => {
    folder.permission = 'prompt';
    expect(await run(account, configFor(account))).toEqual({ kind: 'needs_permission' });
    expect(folder.files.size).toBe(0);
  });

  it('asks for the folder after a click, and reports a refusal', async () => {
    folder.permission = 'prompt';
    expect((await run(account, configFor(account), { interactive: true })).kind).toBe('written');

    folder.permission = 'prompt';
    folder.grantOnRequest = false;
    expect(await run(account, configFor(account), { interactive: true, force: true })).toEqual({
      kind: 'error',
      code: 'permission_denied',
    });
  });

  it('leaves no file at all when writing fails', async () => {
    folder.failClose = true;
    const before = new Date('2026-11-01T10:00').toISOString();
    const outcome = await run(account, configFor(account, { lastRunAt: before }));
    expect(outcome).toEqual({ kind: 'error', code: 'write_failed' });
    expect(folder.files.size).toBe(0);
    expect(await profilesDb.autoBackups.get(account.id)).toMatchObject({
      lastRunAt: before,
      lastError: 'write_failed',
    });
  });

  it('never shows an unfinished write under a backup name, and cleans it up later', async () => {
    // The browser closed mid-write on an earlier run: only the temporary file is left.
    folder.files.set(`${name('2026-11-14-1000')}.tmp`, new Uint8Array());
    folder.files.set(`${name('2026-11-14-1000', true, '9f8e7d6c')}.tmp`, new Uint8Array());
    await run(account, configFor(account));
    expect([...folder.files.keys()].sort()).toEqual(
      [`${name('2026-11-14-1000', true, '9f8e7d6c')}.tmp`, name('2026-11-21-1230')].sort(),
    );
  });

  it('keeps a good backup of the same minute when a second write fails', async () => {
    await run(account, configFor(account), { force: true });
    const good = folder.files.get(name('2026-11-21-1230'));
    folder.failClose = true;
    await run(account, configFor(account), { force: true });
    expect(folder.files.get(name('2026-11-21-1230'))).toEqual(good);
  });

  it('still writes in a browser without move(), straight to the final name', async () => {
    folder.supportsMove = false;
    expect((await run(account, configFor(account))).kind).toBe('written');
    expect(autoNames()).toEqual([name('2026-11-21-1230')]);
  });

  it('without move(), a failed write removes its empty file but keeps an older good one', async () => {
    folder.supportsMove = false;
    folder.failClose = true;
    await run(account, configFor(account));
    expect(folder.files.size).toBe(0);

    folder.failClose = false;
    await run(account, configFor(account), { force: true });
    const good = folder.files.get(name('2026-11-21-1230'));
    folder.failClose = true;
    await run(account, configFor(account), { force: true });
    expect(folder.files.get(name('2026-11-21-1230'))).toEqual(good);
  });

  it('reports a folder that no longer exists', async () => {
    folder.missing = true;
    expect(await run(account, configFor(account))).toEqual({
      kind: 'error',
      code: 'folder_missing',
    });
  });

  it('runs before it is due when asked from a click', async () => {
    const config = configFor(account, { lastRunAt: new Date('2026-11-21T09:00').toISOString() });
    expect((await run(account, config, { force: true })).kind).toBe('written');
  });
});

describe('automatic backup to the cloud folder', () => {
  const cloudConfig = (patch: Partial<AutoBackupConfig> = {}): AutoBackupConfig => {
    const { dir: _dir, ...rest } = configFor(account, { target: 'cloud', dirName: '', ...patch });
    void _dir;
    return rest;
  };
  const runCloud = (drive: MemoryDrive, config: AutoBackupConfig, now = NOW) =>
    runAutoBackup({
      session: { profile: account, repos, masterKey: keys.masterKey },
      config,
      now,
      force: true,
      interactive: false,
      target: cloudTarget(drive),
    });
  const copies = (drive: MemoryDrive) =>
    [...drive.files.keys()].filter((path) => path.startsWith(`${CLOUD_BACKUP_FOLDER}/`)).sort();

  it('writes an encrypted copy in the cloud folder', async () => {
    const drive = new MemoryDrive();
    const outcome = await runCloud(drive, cloudConfig());
    expect(outcome).toEqual({ kind: 'written', name: name('2026-11-21-1230') });
    expect(copies(drive)).toEqual([`${CLOUD_BACKUP_FOLDER}/${name('2026-11-21-1230')}`]);
    const bytes = drive.files.get(copies(drive)[0] ?? '')?.bytes ?? new Uint8Array();
    expect(isEncryptedBackup(bytes)).toBe(true);
  });

  it('keeps only the newest copies of this profile', async () => {
    const drive = new MemoryDrive();
    const other = `${CLOUD_BACKUP_FOLDER}/${name('2026-01-01-0000', true, 'ffffffff')}`;
    await drive.write(other, new Uint8Array([1]));
    for (let day = 1; day <= 4; day++) {
      await runCloud(drive, cloudConfig({ keep: 3 }), new Date(`2026-11-0${day}T10:00`));
    }
    expect(copies(drive)).toEqual(
      [
        other,
        `${CLOUD_BACKUP_FOLDER}/${name('2026-11-02-1000')}`,
        `${CLOUD_BACKUP_FOLDER}/${name('2026-11-03-1000')}`,
        `${CLOUD_BACKUP_FOLDER}/${name('2026-11-04-1000')}`,
      ].sort(),
    );
  });

  it('asks to link the cloud again, without writing, when the sign-in expired', async () => {
    const drive = new MemoryDrive();
    drive.failNext('needs_reconnect');
    expect(await runCloud(drive, cloudConfig())).toEqual({ kind: 'needs_permission' });
    expect(copies(drive)).toEqual([]);
  });

  it('says the cloud is full', async () => {
    const drive = new MemoryDrive();
    drive.failNext('quota_full', 'write');
    expect(await runCloud(drive, cloudConfig())).toEqual({ kind: 'error', code: 'cloud_full' });
    expect((await profilesDb.autoBackups.get(account.id))?.lastError).toBe('cloud_full');
  });

  it('treats an old saved configuration as a folder', async () => {
    const { target: _target, ...old } = configFor(account, { target: 'folder' });
    void _target;
    expect(await run(account, old, { force: true })).toMatchObject({ kind: 'written' });
    expect(autoNames()).toHaveLength(1);
  });
});
