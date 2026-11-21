import 'fake-indexeddb/auto';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRepositories, type Repositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import { createAccountKeys, type NewAccountKeys } from '../../lib/crypto';
import { BackupError, exportBackup, importBackup } from './backup';
import { decryptBackup, encryptBackup, isEncryptedBackup } from './encrypted-backup';

const PASSWORD = 'palavra-passe-da-conta-a';

let account: NewAccountKeys;
let source: Repositories;
let zip: Uint8Array;
let encrypted: Uint8Array;

async function reposFor(masterKey: CryptoKey): Promise<Repositories> {
  return createRepositories(new ProfileDb(crypto.randomUUID()), masterKey);
}

beforeAll(async () => {
  account = await createAccountKeys(PASSWORD, 1_000);
  source = await reposFor(account.masterKey);
  await source.providers.put({
    id: 'p1',
    nif: '500000000',
    name: 'Fornecedor Inconfundível',
    sectors: ['telecom'],
  } as never);
  zip = (await exportBackup(source)).zip;
  encrypted = await encryptBackup(zip, account.masterKey, account.wrapped);
});

describe('encrypted backups', () => {
  it('opens with the account password', async () => {
    expect(await decryptBackup(encrypted, { password: PASSWORD })).toEqual(zip);
  });

  it('opens with the recovery key', async () => {
    expect(await decryptBackup(encrypted, { recoveryKey: account.recoveryKey })).toEqual(zip);
  });

  it('refuses a wrong password', async () => {
    const attempt = decryptBackup(encrypted, { password: 'outra-palavra-passe' });
    await expect(attempt).rejects.toBeInstanceOf(BackupError);
    await expect(attempt).rejects.toMatchObject({ code: 'wrong_secret' });
  });

  it('tells encrypted backups from plain ones and from other files', () => {
    expect(isEncryptedBackup(encrypted)).toBe(true);
    expect(isEncryptedBackup(zip)).toBe(false);
    expect(isEncryptedBackup(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('keeps the data unreadable without the password', () => {
    const entries = unzipSync(encrypted);
    const text = Object.values(entries)
      .map((bytes) => strFromU8(bytes, true))
      .join('\n');
    expect(text).not.toContain('Inconfundível');
    expect(text).not.toContain('500000000');
  });

  it('refuses a damaged header as not a backup', async () => {
    const attempt = decryptBackup(zip, { password: PASSWORD });
    await expect(attempt).rejects.toMatchObject({ code: 'not_a_backup' });
  });

  it('restores into another account (a new computer)', async () => {
    const other = await createAccountKeys('palavra-passe-da-conta-b', 1_000);
    const target = await reposFor(other.masterKey);
    const opened = await decryptBackup(encrypted, { password: PASSWORD });
    await importBackup(target, opened);
    expect((await target.providers.list()).map((provider) => provider.name)).toEqual([
      'Fornecedor Inconfundível',
    ]);
  });
});
