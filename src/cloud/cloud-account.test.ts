import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb, type Profile } from '../db/profiles';
import { createRepositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import {
  createAccountKeys,
  decryptJson,
  rewrapWithPassword,
  type NewAccountKeys,
} from '../lib/crypto';
import {
  CloudAccountError,
  CLOUD_ACCOUNT_FILE,
  connectFromCloud,
  enableCloudSync,
  relinkCloud,
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

  it('refuses a folder of an account with the same email but other keys', async () => {
    // A new local account made with the same email, instead of "Entrar com o OneDrive".
    const fresh = await createAccountKeys(PASSWORD, ITERATIONS);
    await enable(profile, keys.masterKey);
    const twin = accountProfile('EU@exemplo.pt', fresh);
    await expect(enable(twin, fresh.masterKey)).rejects.toMatchObject({ code: 'other_account' });
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

describe('relinkCloud', () => {
  it('takes the new Microsoft sign-in when it opens the same account folder', async () => {
    const enabled = await enable(profile, keys.masterKey);
    const relinked = await relinkCloud({ profile: enabled, drive, accountId: 'conta-2' });
    expect(relinked.cloud?.accountId).toBe('conta-2');
    expect((await profilesDb.profiles.get(profile.id))?.cloud?.accountId).toBe('conta-2');
  });

  it('refuses a Microsoft account whose folder belongs to someone else or is empty', async () => {
    const enabled = await enable(profile, keys.masterKey);
    const empty = new MemoryDrive();
    await expect(
      relinkCloud({ profile: enabled, drive: empty, accountId: 'outra' }),
    ).rejects.toMatchObject({ code: 'other_account' });
    expect((await profilesDb.profiles.get(profile.id))?.cloud?.accountId).toBeUndefined();
  });
});

describe('the Microsoft account in use', () => {
  it('is kept when enabling and when signing in on a new device', async () => {
    const enabled = await enableCloudSync({
      profile,
      masterKey: keys.masterKey,
      password: PASSWORD,
      drive,
      provider: 'onedrive',
      accountId: 'conta-1',
    });
    expect(enabled.cloud?.accountId).toBe('conta-1');
    await profilesDb.profiles.delete(profile.id);
    const connected = await connectFromCloud({
      drive,
      password: PASSWORD,
      provider: 'onedrive',
      localIterations: ITERATIONS,
      accountId: 'conta-9',
    });
    expect(connected.profile.cloud?.accountId).toBe('conta-9');
  });
});

describe('the lasting link to Dropbox or Google Drive', () => {
  const LINK = 'ligacao-duradoura-secreta';
  const stored = async (id: string) => JSON.stringify(await profilesDb.profiles.get(id));

  it('is kept encrypted with the account key when the sync is turned on', async () => {
    const enabled = await enableCloudSync({
      profile,
      masterKey: keys.masterKey,
      password: PASSWORD,
      drive,
      provider: 'dropbox',
      refreshToken: LINK,
    });
    expect(enabled.cloud?.provider).toBe('dropbox');
    expect(await stored(profile.id)).not.toContain(LINK);
    const blob = enabled.cloud?.refreshToken;
    if (!blob) throw new Error('no link');
    expect(await decryptJson(keys.masterKey, blob)).toBe(LINK);
  });

  it('is kept encrypted on a new device, never in clear', async () => {
    await enable(profile, keys.masterKey);
    await profilesDb.profiles.clear();
    const { profile: joined, masterKey } = await connectFromCloud({
      drive,
      password: PASSWORD,
      provider: 'gdrive',
      localIterations: ITERATIONS,
      refreshToken: LINK,
    });
    expect(await stored(joined.id)).not.toContain(LINK);
    const blob = joined.cloud?.refreshToken;
    if (!blob) throw new Error('no link');
    expect(await decryptJson(masterKey, blob)).toBe(LINK);
  });

  it('is replaced, encrypted, when linking again', async () => {
    const enabled = await enable(profile, keys.masterKey);
    const relinked = await relinkCloud({
      profile: enabled,
      drive,
      accountId: 'chave',
      masterKey: keys.masterKey,
      refreshToken: LINK,
    });
    expect(await stored(profile.id)).not.toContain(LINK);
    const blob = relinked.cloud?.refreshToken;
    if (!blob) throw new Error('no link');
    expect(await decryptJson(keys.masterKey, blob)).toBe(LINK);
  });
});
