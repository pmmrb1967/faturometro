import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { memorySql } from '../../server/test/sqlite';
import { profilesDb } from '../db/profiles';
import { createRepositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { createAccount } from '../features/auth/accounts';
import { SyncApi } from './api';
import { connectFromServer, disableSync, enableSync, runSync, SyncError } from './account';

const ITERATIONS = 1_000;
const SERVER = 'https://sync.test';

let api: SyncApi;
let serverDb: ReturnType<typeof memorySql>['db'];

beforeEach(async () => {
  await profilesDb.profiles.clear();
  const memory = memorySql();
  serverDb = memory.db;
  const handle = createApp({
    sql: memory.sql,
    preloginSecret: 'secret',
    allowedOrigins: [],
    minIterations: ITERATIONS,
  });
  api = new SyncApi(SERVER, (input, init) => handle(new Request(input, init)));
});

async function deviceA() {
  const account = await createAccount('ana@example.pt', 'palavra-passe-longa', ITERATIONS);
  const db = new ProfileDb(account.profile.id);
  const repos = createRepositories(db, account.masterKey);
  const profile = await enableSync({
    profile: account.profile,
    masterKey: account.masterKey,
    password: 'palavra-passe-longa',
    serverUrl: SERVER,
    api,
    iterations: ITERATIONS,
  });
  return { profile, masterKey: account.masterKey, repos, db };
}

/** Simulates another device: the local profile of device A does not exist there. */
async function deviceB(password = 'palavra-passe-longa') {
  await profilesDb.profiles.clear();
  const { profile, masterKey } = await connectFromServer({
    serverUrl: SERVER,
    email: 'ana@example.pt',
    password,
    api,
    localIterations: ITERATIONS,
  });
  const db = new ProfileDb(profile.id);
  return { profile, masterKey, repos: createRepositories(db, masterKey), db };
}

/** Each device has its own local profile list: keep only this device's profile while it syncs. */
async function on<T>(profile: { email: string }, run: () => Promise<T>): Promise<T> {
  await profilesDb.profiles.clear();
  await profilesDb.profiles.put(profile as never);
  return run();
}

function contract(id: string, label: string) {
  return {
    id,
    providerId: 'p1',
    sector: 'electricity' as const,
    label,
    customerNumber: 'CLIENTE-SECRETO-42',
    active: true,
    createdAt: '2026-10-13T10:00:00.000Z',
  };
}

describe('sync between two devices', () => {
  it('sends only ciphertext to the server and restores it on another device', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz da casa'));
    const pushed = await runSync({ ...a, api });
    expect(pushed.result.pushed).toBe(1);

    const stored = JSON.stringify(serverDb.prepare('SELECT * FROM records').all());
    expect(stored).not.toContain('Luz da casa');
    expect(stored).not.toContain('CLIENTE-SECRETO-42');
    expect(stored).not.toContain('electricity');
    expect(stored).not.toContain('p1');

    const b = await deviceB();
    const pulled = await runSync({ ...b, api });
    expect(pulled.result.received).toBe(1);
    expect(await b.repos.contracts.get('c1')).toMatchObject({ label: 'Luz da casa' });
    // Indexes rebuilt locally after decrypting.
    expect(await b.repos.contracts.findBy('providerId', 'p1')).toHaveLength(1);
  });

  it('syncs edits and deletions both ways, last write wins', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    await a.repos.contracts.put(contract('c2', 'Gás'));
    let stateA = (await runSync({ ...a, api })).profile;

    const b = await deviceB();
    let stateB = (await runSync({ ...b, api })).profile;
    await b.repos.contracts.put(contract('c1', 'Luz (editado no telemóvel)'));
    await b.repos.contracts.remove('c2');
    stateB = (await runSync({ ...b, profile: stateB, api })).profile;

    stateA = (await on(stateA, () => runSync({ ...a, profile: stateA, api }))).profile;
    expect((await a.repos.contracts.get('c1'))?.label).toBe('Luz (editado no telemóvel)');
    expect(await a.repos.contracts.get('c2')).toBeUndefined();

    // A later edit on A wins over an older one from B.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await a.repos.contracts.put(contract('c1', 'Luz (PC)'));
    await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    await on(stateB, () => runSync({ ...b, profile: stateB, api }));
    expect((await b.repos.contracts.get('c1'))?.label).toBe('Luz (PC)');
  });

  it('does not resend what was already sent', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    const first = await runSync({ ...a, api });
    const second = await runSync({ ...a, profile: first.profile, api });
    expect(second.result.pushed).toBe(0);
  });

  it('refuses a wrong password on the new device', async () => {
    await deviceA();
    await expect(deviceB('errada-errada')).rejects.toMatchObject({ code: 'wrong_credentials' });
  });

  it('checks the local password before enabling sync', async () => {
    const account = await createAccount('rui@example.pt', 'certa-certa-certa', ITERATIONS);
    await expect(
      enableSync({
        ...account,
        password: 'errada',
        serverUrl: SERVER,
        api,
        iterations: ITERATIONS,
      }),
    ).rejects.toBeInstanceOf(SyncError);
  });

  it('turning sync off can delete everything on the server', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    const synced = await runSync({ ...a, api });
    const off = await disableSync({ ...a, profile: synced.profile, deleteRemote: true, api });
    expect(off.sync).toBeUndefined();
    expect(serverDb.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: 0 });
    expect(serverDb.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    // Local data stays.
    expect(await a.repos.contracts.get('c1')).toBeDefined();
  });
});
