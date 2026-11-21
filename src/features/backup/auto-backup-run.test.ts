import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb, type AutoBackupConfig, type Profile } from '../../db/profiles';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys, type NewAccountKeys } from '../../lib/crypto';
import { getSettings } from '../settings/settings';
import { importBackup } from './backup';
import { runAutoBackup } from './auto-backup-run';
import { isEncryptedBackup } from './encrypted-backup';
import type { BackupFolder, FolderPermission } from './fs-access';

/** In-memory folder: a file exists (empty) as soon as its handle is created, like Chrome. */
class FakeFolder implements BackupFolder {
  readonly name = 'Faturometro';
  files = new Map<string, Uint8Array>();
  permission: FolderPermission = 'granted';
  grantOnRequest = true;
  failClose = false;
  missing = false;

  queryPermission() {
    return Promise.resolve(this.permission);
  }
  requestPermission() {
    if (this.grantOnRequest) this.permission = 'granted';
    return Promise.resolve(this.permission);
  }
  getFileHandle(name: string) {
    if (this.missing) return Promise.reject(new DOMException('gone', 'NotFoundError'));
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());
    const chunks: Uint8Array[] = [];
    const handle = {
      createWritable: () =>
        Promise.resolve({
          write: (data: Uint8Array) => {
            chunks.push(data);
            return Promise.resolve();
          },
          close: () => {
            if (this.failClose) return Promise.reject(new DOMException('full', 'QuotaExceededError'));
            this.files.set(name, chunks[0] ?? new Uint8Array());
            return Promise.resolve();
          },
          abort: () => Promise.resolve(),
        }),
    };
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

function run(profile: Profile, config: AutoBackupConfig, options: { force?: boolean; interactive?: boolean } = {}) {
  return runAutoBackup({
    session: { profile, repos, masterKey: keys.masterKey },
    config,
    now: NOW,
    force: options.force ?? false,
    interactive: options.interactive ?? false,
  });
}

const autoNames = () => [...folder.files.keys()].filter((name) => name.startsWith('faturometro-auto-'));

beforeEach(async () => {
  keys = await createAccountKeys('palavra-passe', 1_000);
  repos = createRepositories(new ProfileDb(crypto.randomUUID()), keys.masterKey);
  await repos.providers.put({ id: 'p1', nif: '500000000', name: 'NOS', sectors: ['telecom'] } as never);
  folder = new FakeFolder();
  account = { id: crypto.randomUUID(), email: 'a@b.pt', createdAt: '2026-11-01', wrappedKey: keys.wrapped };
  guest = { id: crypto.randomUUID(), email: '', createdAt: '2026-11-01', guestKey: 'AAAA' };
});

describe('runAutoBackup', () => {
  it('does nothing before it is due', async () => {
    const config = configFor(account, { lastRunAt: new Date('2026-11-20T10:00').toISOString() });
    expect(await run(account, config)).toEqual({ kind: 'not_due' });
    expect(folder.files.size).toBe(0);
  });

  it('writes an encrypted backup and records it', async () => {
    const outcome = await run(account, configFor(account));
    expect(outcome).toEqual({ kind: 'written', name: 'faturometro-auto-2026-11-21-1230-cifrado.zip' });
    const bytes = folder.files.get('faturometro-auto-2026-11-21-1230-cifrado.zip');
    expect(bytes && isEncryptedBackup(bytes)).toBe(true);
    expect(await profilesDb.autoBackups.get(account.id)).toMatchObject({ lastRunAt: NOW.toISOString() });
    expect((await getSettings(repos)).lastBackupAt).toBe(NOW.toISOString().slice(0, 10));
  });

  it('writes a plain backup when encryption is off', async () => {
    await run(account, configFor(account, { encrypted: false }));
    const bytes = folder.files.get('faturometro-auto-2026-11-21-1230.zip');
    expect(bytes).toBeDefined();
    const target = createRepositories(new ProfileDb(crypto.randomUUID()), keys.masterKey);
    await importBackup(target, bytes ?? new Uint8Array());
    expect((await target.providers.list()).map((provider) => provider.name)).toEqual(['NOS']);
  });

  it('writes in clear for the guest, who has no password', async () => {
    const outcome = await run(guest, configFor(guest, { encrypted: true }));
    expect(outcome).toEqual({ kind: 'written', name: 'faturometro-auto-2026-11-21-1230.zip' });
  });

  it('removes only the oldest automatic backups beyond the kept number', async () => {
    for (const day of ['01', '02', '03', '04', '05']) {
      folder.files.set(`faturometro-auto-2026-11-${day}-1000-cifrado.zip`, new Uint8Array([1]));
    }
    folder.files.set('faturometro-2026-11-01.zip', new Uint8Array([1]));
    folder.files.set('notas.txt', new Uint8Array([1]));
    await run(account, configFor(account));
    expect(autoNames().sort()).toEqual([
      'faturometro-auto-2026-11-02-1000-cifrado.zip',
      'faturometro-auto-2026-11-03-1000-cifrado.zip',
      'faturometro-auto-2026-11-04-1000-cifrado.zip',
      'faturometro-auto-2026-11-05-1000-cifrado.zip',
      'faturometro-auto-2026-11-21-1230-cifrado.zip',
    ]);
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

  it('leaves no half-written backup when writing fails', async () => {
    folder.failClose = true;
    const before = new Date('2026-11-01T10:00').toISOString();
    const outcome = await run(account, configFor(account, { lastRunAt: before }));
    expect(outcome).toEqual({ kind: 'error', code: 'write_failed' });
    expect(autoNames()).toEqual([]);
    expect(await profilesDb.autoBackups.get(account.id)).toMatchObject({
      lastRunAt: before,
      lastError: 'write_failed',
    });
  });

  it('reports a folder that no longer exists', async () => {
    folder.missing = true;
    expect(await run(account, configFor(account))).toEqual({ kind: 'error', code: 'folder_missing' });
  });

  it('runs before it is due when asked from a click', async () => {
    const config = configFor(account, { lastRunAt: new Date('2026-11-21T09:00').toISOString() });
    expect((await run(account, config, { force: true })).kind).toBe('written');
  });
});
