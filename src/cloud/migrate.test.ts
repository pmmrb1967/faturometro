import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { memorySql } from '../../server/test/sqlite';
import { profilesDb, type Profile } from '../db/profiles';
import { createRepositories, type Repositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { createAccount } from '../features/auth/accounts';
import { sha256Hex } from '../lib/crypto';
import { connectFromServer, enableSync, runSync, setFileSync } from '../sync/account';
import { isAdmin } from '../sync/admin-link';
import { SyncApi } from '../sync/api';
import { connectFromCloud } from './cloud-account';
import { runCloudSync } from './cloud-run';
import { MemoryDrive } from './memory-drive';
import { finishServerData, migrateToCloud } from './migrate';

const ITERATIONS = 1_000;
const SERVER = 'https://sync.test';
const PASSWORD = 'palavra-passe-longa';
let api: SyncApi;
let serverDb: ReturnType<typeof memorySql>['db'];
let drive: MemoryDrive;

beforeEach(async () => {
  await profilesDb.profiles.clear();
  const memory = memorySql();
  serverDb = memory.db;
  const handle = createApp({
    sql: memory.sql,
    files: memorySql('migrations-files').sql,
    adminEmails: ['admin@example.pt'],
    preloginSecret: 'secret',
    allowedOrigins: [],
    minIterations: ITERATIONS,
  });
  api = new SyncApi(SERVER, (input, init) => handle(new Request(input, init)));
  drive = new MemoryDrive();
});

interface Device {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
}

async function syncingDevice(email = 'ana@example.pt'): Promise<Device> {
  const account = await createAccount(email, PASSWORD, ITERATIONS);
  const profile = await enableSync({
    profile: account.profile,
    masterKey: account.masterKey,
    password: PASSWORD,
    serverUrl: SERVER,
    api,
    iterations: ITERATIONS,
  });
  const repos = createRepositories(new ProfileDb(crypto.randomUUID()), account.masterKey);
  return { profile, masterKey: account.masterKey, repos };
}

const provider = { id: 'p1', nif: '5', name: 'NOS', sectors: [] } as never;
const migrate = (device: Device) => migrateToCloud({ ...device, drive, password: PASSWORD, api });

/** Another device of the account signs in through the cloud (own profiles list). */
async function cloudDevice(email = 'ana@example.pt') {
  await profilesDb.profiles.where('email').equals(email).delete();
  const connected = await connectFromCloud({
    drive,
    password: PASSWORD,
    provider: 'onedrive',
    localIterations: ITERATIONS,
  });
  const repos = createRepositories(new ProfileDb(crypto.randomUUID()), connected.masterKey);
  await runCloudSync({ ...connected, repos, drive });
  return repos;
}

describe('migrateToCloud', () => {
  it('moves the sync to the cloud with everything, and leaves the server', async () => {
    const a = await syncingDevice();
    await a.repos.providers.put(provider);
    const { profile, previous } = await migrate(a);
    expect(profile.cloud).toBeDefined();
    expect(profile.sync).toBeUndefined();
    expect(previous.serverUrl).toBe(SERVER);
    expect((await profilesDb.profiles.get(a.profile.id))?.sync).toBeUndefined();
    const other = await cloudDevice();
    expect((await other.providers.list()).map((row) => row.name)).toEqual(['NOS']);
  });

  it('first brings what only the server had: changes and originals of other devices', async () => {
    const a = await syncingDevice();
    const withFiles = await setFileSync(a.profile, true);
    const pdf = new TextEncoder().encode('%PDF-1.7 de outro dispositivo');
    const fileHash = await sha256Hex(new Uint8Array(pdf));
    await a.repos.documents.put({ fileHash, mime: 'application/pdf', bytes: new Uint8Array(pdf) });
    await a.repos.providers.put(provider);
    await runSync({ ...a, profile: withFiles, api });

    // Device B has only ever synced through the server, without the original yet.
    await profilesDb.profiles.clear();
    const connected = await connectFromServer({
      serverUrl: SERVER,
      email: 'ana@example.pt',
      password: PASSWORD,
      api,
      localIterations: ITERATIONS,
    });
    const b: Device = {
      ...connected,
      profile: await setFileSync(connected.profile, true),
      repos: createRepositories(new ProfileDb(crypto.randomUUID()), connected.masterKey),
    };
    await migrate(b);
    expect((await b.repos.providers.list()).map((row) => row.name)).toEqual(['NOS']);
    expect((await b.repos.documents.getByFileHash(fileHash))?.bytes).toEqual(pdf);
    expect([...drive.files.keys()].some((path) => path.startsWith('originais/'))).toBe(true);
  });

  it('after another device moved and deleted the server data, takes the originals from the cloud', async () => {
    const a = await syncingDevice();
    const aFiles = await setFileSync(a.profile, true);
    const pdf = new TextEncoder().encode('%PDF-1.7 já na nuvem');
    const fileHash = await sha256Hex(new Uint8Array(pdf));
    await a.repos.documents.put({ fileHash, mime: 'application/pdf', bytes: new Uint8Array(pdf) });
    await runSync({ ...a, profile: aFiles, api });

    // B knows of the original (only on the server so far).
    const own = await profilesDb.profiles.get(a.profile.id);
    await profilesDb.profiles.clear();
    const connected = await connectFromServer({
      serverUrl: SERVER,
      email: 'ana@example.pt',
      password: PASSWORD,
      api,
      localIterations: ITERATIONS,
    });
    const bRepos = createRepositories(new ProfileDb(crypto.randomUUID()), connected.masterKey);
    const bProfile = await setFileSync(connected.profile, true);
    await runSync({
      ...connected,
      profile: { ...bProfile, sync: { ...bProfile.sync!, files: false } },
      repos: bRepos,
      api,
    });
    const bStored = await profilesDb.profiles.get(connected.profile.id);
    expect(await bRepos.documents.stateOf(fileHash)).toBe('remote');

    // A moves first and deletes the server data.
    await profilesDb.profiles.clear();
    if (own) await profilesDb.profiles.put(own);
    const moved = await migrate({
      ...a,
      profile: (await profilesDb.profiles.get(a.profile.id)) ?? aFiles,
    });
    await finishServerData({
      previous: moved.previous,
      masterKey: a.masterKey,
      deleteData: true,
      api,
    });

    // Then B.
    await profilesDb.profiles.clear();
    if (bStored)
      await profilesDb.profiles.put({ ...bStored, sync: { ...bStored.sync!, files: true } });
    const b: Device = {
      masterKey: connected.masterKey,
      repos: bRepos,
      profile: (await profilesDb.profiles.get(connected.profile.id)) as Profile,
    };
    await migrate(b);
    expect((await bRepos.documents.getByFileHash(fileHash))?.bytes).toEqual(pdf);
  });

  it('keeps syncing through the server when the cloud fails', async () => {
    const a = await syncingDevice();
    await a.repos.providers.put(provider);
    drive.failNext('quota_full', 'list');
    await expect(migrate(a)).rejects.toMatchObject({ code: 'quota_full' });
    const stored = await profilesDb.profiles.get(a.profile.id);
    expect(stored?.sync).toBeDefined();
    expect(stored?.cloud).toBeUndefined();
  });

  it('keeps an administrator linked to the server', async () => {
    const admin = await syncingDevice('admin@example.pt');
    const pulled = await runSync({ ...admin, api });
    const { profile } = await migrate({ ...admin, profile: pulled.profile });
    expect(profile.sync).toBeUndefined();
    expect(profile.adminLink?.serverUrl).toBe(SERVER);
    expect(isAdmin(profile)).toBe(true);
  });
});

describe('finishServerData', () => {
  it('deletes the server data, and the other devices learn of the move', async () => {
    const a = await syncingDevice();
    await a.repos.providers.put(provider);
    await runSync({ ...a, api });
    const { previous } = await migrate(a);
    await finishServerData({ previous, masterKey: a.masterKey, deleteData: true, api });
    expect(serverDb.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: 0 });
    expect(serverDb.prepare('SELECT moved_to FROM users').get()).toEqual({ moved_to: 'cloud' });
  });

  it('keeps the server data when asked to', async () => {
    const a = await syncingDevice();
    await a.repos.providers.put(provider);
    await runSync({ ...a, api });
    const { previous } = await migrate(a);
    await finishServerData({ previous, masterKey: a.masterKey, deleteData: false, api });
    expect(serverDb.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: 1 });
  });
});
