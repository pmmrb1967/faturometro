import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app';
import { memorySql } from '../../server/test/sqlite';
import { profilesDb, type Profile } from '../db/profiles';
import { createAccount } from '../features/auth/accounts';
import { decryptJson } from '../lib/crypto';
import { adminStats, disableSync, enableSync } from './account';
import { adminContributions, isAdmin, linkAdmin, refreshAdminLink } from './admin-link';
import { SyncApi } from './api';

const ITERATIONS = 1_000;
const SERVER = 'https://sync.test';
const PASSWORD = 'palavra-passe-longa';
let api: SyncApi;
let serverDb: ReturnType<typeof memorySql>['db'];

beforeEach(async () => {
  await profilesDb.profiles.clear();
  const memory = memorySql();
  serverDb = memory.db;
  const handle = createApp({
    sql: memory.sql,
    adminEmails: ['admin@example.pt'],
    preloginSecret: 'secret',
    allowedOrigins: [],
    minIterations: ITERATIONS,
  });
  api = new SyncApi(SERVER, (input, init) => handle(new Request(input, init)));
});

/** A local profile with a server account, not syncing through it. */
async function localWithServerAccount(email: string) {
  const account = await createAccount(email, PASSWORD, ITERATIONS);
  const synced = await enableSync({
    profile: account.profile,
    masterKey: account.masterKey,
    password: PASSWORD,
    serverUrl: SERVER,
    api,
    iterations: ITERATIONS,
  });
  const profile = await disableSync({
    profile: synced,
    masterKey: account.masterKey,
    deleteRemote: false,
    api,
  });
  return { profile, masterKey: account.masterKey };
}

describe('administrator link', () => {
  it('links an administrator who does not sync through the server', async () => {
    const { profile, masterKey } = await localWithServerAccount('admin@example.pt');
    expect(isAdmin(profile)).toBe(false);
    const linked = await linkAdmin({
      profile,
      masterKey,
      password: PASSWORD,
      serverUrl: SERVER,
      api,
    });
    expect(isAdmin(linked)).toBe(true);
    expect(linked.sync).toBeUndefined();
    expect((await profilesDb.profiles.get(profile.id))?.adminLink?.serverUrl).toBe(SERVER);
    // The token is stored encrypted.
    const token = await decryptJson(masterKey, linked.adminLink?.token as never);
    expect(typeof token).toBe('string');
  });

  it('refuses an account that is not an administrator', async () => {
    const { profile, masterKey } = await localWithServerAccount('ana@example.pt');
    await expect(
      linkAdmin({ profile, masterKey, password: PASSWORD, serverUrl: SERVER, api }),
    ).rejects.toMatchObject({ code: 'not_admin' });
    expect((await profilesDb.profiles.get(profile.id))?.adminLink).toBeUndefined();
  });

  it('refuses a wrong password', async () => {
    const { profile, masterKey } = await localWithServerAccount('admin@example.pt');
    await expect(
      linkAdmin({ profile, masterKey, password: 'errada', serverUrl: SERVER, api }),
    ).rejects.toMatchObject({ code: 'wrong_credentials' });
  });

  it('learns how many layout contributions wait', async () => {
    const { profile, masterKey } = await localWithServerAccount('admin@example.pt');
    const linked = await linkAdmin({
      profile,
      masterKey,
      password: PASSWORD,
      serverUrl: SERVER,
      api,
    });
    serverDb.exec(
      "INSERT INTO contributions (id, created_at, size, envelope) VALUES ('c1', '2026-11-21T10:00:00Z', 2, '{}')",
    );
    const refreshed = await refreshAdminLink({ profile: linked, masterKey, api });
    expect(adminContributions(refreshed)).toBe(1);
    expect(refreshed.adminLink?.checkedAt).toBeDefined();
  });

  it('reads the usage totals through the link', async () => {
    const { profile, masterKey } = await localWithServerAccount('admin@example.pt');
    const linked = await linkAdmin({
      profile,
      masterKey,
      password: PASSWORD,
      serverUrl: SERVER,
      api,
    });
    expect((await adminStats({ profile: linked, masterKey, api })).accounts).toBe(1);
  });

  it('reads the administrator from either source', () => {
    const base: Profile = { id: 'p', email: 'a@b.pt', createdAt: '2026-11-21' };
    expect(isAdmin(base)).toBe(false);
    const viaServer = {
      ...base,
      sync: { admin: true, contributions: 2 },
    } as unknown as Profile;
    expect(isAdmin(viaServer)).toBe(true);
    expect(adminContributions(viaServer)).toBe(2);
  });
});
