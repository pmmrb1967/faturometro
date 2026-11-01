import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';
import { memorySql } from '../../server/test/sqlite';
import { profilesDb } from '../db/profiles';
import { createRepositories, type Repositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { createAccount } from '../features/auth/accounts';
import { exportBackup, importBackup } from '../features/backup/backup';
import { createAccountKeys } from '../lib/crypto';
import { connectFromServer, enableSync, runSync } from './account';
import { SyncApi } from './api';

const ITERATIONS = 1_000;
const SERVER = 'https://sync.test';
const EMAIL = 'ana@example.pt';
const PASSWORD = 'palavra-passe-longa';

let api: SyncApi;

beforeEach(async () => {
  await profilesDb.profiles.clear();
  const handle = createApp({
    sql: memorySql().sql,
    files: memorySql('migrations-files').sql,
    preloginSecret: 'secret',
    allowedOrigins: [],
    minIterations: ITERATIONS,
  });
  api = new SyncApi(SERVER, (input, init) => handle(new Request(input, init)));
});

function contract(id: string, label: string) {
  return {
    id,
    providerId: 'p1',
    sector: 'electricity' as const,
    label,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A backup whose records are older than anything the account does afterwards. */
async function oldBackup(): Promise<Uint8Array> {
  const { masterKey } = await createAccountKeys('outra-palavra-passe', ITERATIONS);
  const repos = createRepositories(new ProfileDb(crypto.randomUUID()), masterKey);
  await repos.contracts.put(contract('restored', 'Da cópia de segurança'));
  const { zip } = await exportBackup(repos);
  await new Promise((resolve) => setTimeout(resolve, 5));
  return zip;
}

async function localAccount() {
  const account = await createAccount(EMAIL, PASSWORD, ITERATIONS);
  const repos = createRepositories(new ProfileDb(account.profile.id), account.masterKey);
  return { ...account, repos };
}

async function turnOnSync(account: Awaited<ReturnType<typeof localAccount>>) {
  const profile = await enableSync({
    profile: account.profile,
    masterKey: account.masterKey,
    password: PASSWORD,
    serverUrl: SERVER,
    api,
    iterations: ITERATIONS,
  });
  return { ...account, profile };
}

/** What a second device of the same account receives. */
async function seenOnAnotherDevice(): Promise<Repositories> {
  await profilesDb.profiles.clear();
  const { profile, masterKey } = await connectFromServer({
    serverUrl: SERVER,
    email: EMAIL,
    password: PASSWORD,
    api,
    localIterations: ITERATIONS,
  });
  const repos = createRepositories(new ProfileDb(profile.id), masterKey);
  await runSync({ profile, masterKey, repos, api });
  return repos;
}

describe('importing a backup with sync', () => {
  it('sends the records to the other devices when the account had already synced', async () => {
    const zip = await oldBackup();
    const device = await turnOnSync(await localAccount());
    await device.repos.contracts.put(contract('newer', 'Depois da cópia'));
    const { profile } = await runSync({ ...device, api });

    await importBackup(device.repos, zip);
    const { result } = await runSync({ ...device, profile, api });

    expect(result.pushed).toBe(1);
    const other = await seenOnAnotherDevice();
    expect(await other.contracts.get('restored')).toMatchObject({
      label: 'Da cópia de segurança',
    });
  });

  it('sends them once, also if sync is turned on only after importing', async () => {
    const zip = await oldBackup();
    const local = await localAccount();
    await importBackup(local.repos, zip);
    const device = await turnOnSync(local);

    const first = await runSync({ ...device, api });
    const second = await runSync({ ...device, profile: first.profile, api });

    expect(first.result.pushed).toBe(1);
    expect(second.result.pushed).toBe(0);
    expect(await (await seenOnAnotherDevice()).contracts.get('restored')).toBeDefined();
  });

  it('keeps them waiting when the push fails', async () => {
    const zip = await oldBackup();
    const device = await turnOnSync(await localAccount());
    await device.repos.contracts.put(contract('newer', 'Depois da cópia'));
    const { profile } = await runSync({ ...device, api });
    await importBackup(device.repos, zip);

    const push = vi.spyOn(api, 'push').mockRejectedValueOnce(new Error('offline'));
    await expect(runSync({ ...device, profile, api })).rejects.toThrow();
    push.mockRestore();

    const { result } = await runSync({ ...device, profile, api });
    expect(result.pushed).toBe(1);
  });

  it('does not bring back what the server has since deleted or changed', async () => {
    const zip = await oldBackup();
    const device = await turnOnSync(await localAccount());
    await importBackup(device.repos, zip);
    const { profile } = await runSync({ ...device, api });
    await device.repos.contracts.put(contract('restored', 'Editado depois'));
    await runSync({ ...device, profile, api });

    await importBackup(device.repos, zip);
    await runSync({ ...device, profile, api });

    const other = await seenOnAnotherDevice();
    expect(await other.contracts.get('restored')).toMatchObject({ label: 'Editado depois' });
  });
});
