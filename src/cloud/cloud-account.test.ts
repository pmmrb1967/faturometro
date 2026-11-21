import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb, type Profile } from '../db/profiles';
import { createRepositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { createAccountKeys, rewrapWithPassword, type NewAccountKeys } from '../lib/crypto';
import {
  CloudAccountError,
  CLOUD_ACCOUNT_FILE,
  connectFromCloud,
  enableCloudSync,
  rewrapCloudAccount,
} from './cloud-account';
import { MemoryDrive } from './memory-drive';
import { cloudSync } from './sync-protocol';

const PASSWORD = 'palavra-passe-longa';
const ITERATIONS = 1_000;

let drive: MemoryDrive;
let keys: NewAccountKeys;
let profile: Profile;

function accountProfile(email: string, account: NewAccountKeys): Profile {
  return { id: crypto.randomUUID(), email, createdAt: '2026-11-21', wrappedKey: account.wrapped };
}

beforeEach(async () => {
  await profilesDb.profiles.clear();
  drive = new MemoryDrive();
  keys = await createAccountKeys(PASSWORD, ITERATIONS);
  profile = accountProfile('eu@exemplo.pt', keys);
  await profilesDb.profiles.put(profile);
});

const enable = (target: Profile, masterKey: CryptoKey, password = PASSWORD) =>
  enableCloudSync({ profile: target, masterKey, password, drive, provider: 'onedrive' });

describe('enableCloudSync', () => {
  it('writes the account file with only the email in clear', async () => {
    const enabled = await enable(profile, keys.masterKey);
    expect(enabled.cloud).toMatchObject({ provider: 'onedrive', nextSeq: 1, cursors: {} });
    expect((await profilesDb.profiles.get(profile.id))?.cloud).toBeDefined();
    const text = new TextDecoder().decode(drive.files.get(CLOUD_ACCOUNT_FILE)?.bytes);
    expect(text).toContain('eu@exemplo.pt');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(keys.recoveryKey);
  });

  it('joins a folder that already belongs to this account', async () => {
    await enable(profile, keys.masterKey);
    const again = await enable(profile, keys.masterKey);
    expect(again.cloud).toBeDefined();
  });

  it('refuses a folder of another account', async () => {
    const other = await createAccountKeys('outra-palavra-passe', ITERATIONS);
    await enable(accountProfile('outra@exemplo.pt', other), other.masterKey, 'outra-palavra-passe');
    await expect(enable(profile, keys.masterKey)).rejects.toMatchObject({ code: 'other_account' });
  });

  it('refuses a wrong password', async () => {
    await expect(enable(profile, keys.masterKey, 'errada')).rejects.toBeInstanceOf(
      CloudAccountError,
    );
    await expect(enable(profile, keys.masterKey, 'errada')).rejects.toMatchObject({
      code: 'wrong_password',
    });
  });
});

describe('connectFromCloud', () => {
  it('creates the profile on a new device, which reads what the first device sent', async () => {
    const first = await enable(profile, keys.masterKey);
    const repos = createRepositories(new ProfileDb(crypto.randomUUID()), keys.masterKey);
    await repos.providers.put({ id: 'p1', nif: '5', name: 'NOS', sectors: [] } as never);
    if (!first.cloud) throw new Error('no cloud');
    await cloudSync(repos, drive, first.cloud);
    await profilesDb.profiles.delete(profile.id);

    const connected = await connectFromCloud({
      drive,
      password: PASSWORD,
      provider: 'onedrive',
      localIterations: ITERATIONS,
    });
    expect(connected.profile.email).toBe('eu@exemplo.pt');
    expect(connected.profile.cloud?.deviceId).not.toBe(first.cloud.deviceId);
    const here = createRepositories(new ProfileDb(crypto.randomUUID()), connected.masterKey);
    if (!connected.profile.cloud) throw new Error('no cloud');
    await cloudSync(here, drive, connected.profile.cloud);
    expect((await here.providers.list()).map((row) => row.name)).toEqual(['NOS']);
  });

  it('says when the folder has no account, the email is already here, or the password is wrong', async () => {
    const connect = (password = PASSWORD) =>
      connectFromCloud({ drive, password, provider: 'onedrive', localIterations: ITERATIONS });
    await expect(connect()).rejects.toMatchObject({ code: 'no_account' });
    await enable(profile, keys.masterKey);
    await expect(connect()).rejects.toMatchObject({ code: 'email_taken_locally' });
    await profilesDb.profiles.delete(profile.id);
    await expect(connect('errada')).rejects.toMatchObject({ code: 'wrong_password' });
  });
});

describe('rewrapCloudAccount', () => {
  it('opens with the new password after a change, not with the old one', async () => {
    await enable(profile, keys.masterKey);
    const wrappedKey = await rewrapWithPassword(
      keys.wrapped,
      keys.masterKey,
      'nova-palavra-passe',
      ITERATIONS,
    );
    await rewrapCloudAccount({ drive, email: profile.email, wrappedKey });
    await profilesDb.profiles.delete(profile.id);
    const connect = (password: string) =>
      connectFromCloud({ drive, password, provider: 'onedrive', localIterations: ITERATIONS });
    await expect(connect(PASSWORD)).rejects.toMatchObject({ code: 'wrong_password' });
    expect((await connect('nova-palavra-passe')).profile.email).toBe('eu@exemplo.pt');
  });

  it('retries once when another device changed the file meanwhile', async () => {
    await enable(profile, keys.masterKey);
    const wrappedKey = await rewrapWithPassword(
      keys.wrapped,
      keys.masterKey,
      'nova-palavra-passe',
      ITERATIONS,
    );
    drive.failNext('conflict', 'write');
    await rewrapCloudAccount({ drive, email: profile.email, wrappedKey });
    await profilesDb.profiles.delete(profile.id);
    const connected = await connectFromCloud({
      drive,
      password: 'nova-palavra-passe',
      provider: 'onedrive',
      localIterations: ITERATIONS,
    });
    expect(connected.profile.email).toBe('eu@exemplo.pt');
  });
});
