import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { profilesDb, type Profile } from '../db/profiles';
import { createRepositories, type Repositories } from '../db/repositories';
import { ProfileDb } from '../db/schema';
import { createAccountKeys, sha256Hex, type NewAccountKeys } from '../lib/crypto';
import { changeAccountPassword } from '../sync/account';
import { connectFromCloud, enableCloudSync } from './cloud-account';
import { disableCloudSync, runCloudSync, setCloudFileSync } from './cloud-run';
import { MemoryDrive } from './memory-drive';

const PASSWORD = 'palavra-passe-longa';
const ITERATIONS = 1_000;

let drive: MemoryDrive;
let keys: NewAccountKeys;
let profile: Profile;
let repos: Repositories;

beforeEach(async () => {
  await profilesDb.profiles.clear();
  drive = new MemoryDrive();
  keys = await createAccountKeys(PASSWORD, ITERATIONS);
  const created: Profile = {
    id: crypto.randomUUID(),
    email: 'eu@exemplo.pt',
    createdAt: '2026-11-21',
    wrappedKey: keys.wrapped,
  };
  await profilesDb.profiles.put(created);
  profile = await enableCloudSync({
    profile: created,
    masterKey: keys.masterKey,
    password: PASSWORD,
    drive,
    provider: 'onedrive',
  });
  repos = createRepositories(new ProfileDb(crypto.randomUUID()), keys.masterKey);
});

/** A second device of the same account. */
async function secondDevice() {
  const own = await profilesDb.profiles.get(profile.id);
  await profilesDb.profiles.delete(profile.id);
  const connected = await connectFromCloud({
    drive,
    password: PASSWORD,
    provider: 'onedrive',
    localIterations: ITERATIONS,
  });
  // Both "devices" share one profiles database here, whose email index is unique.
  const second: Profile = { ...connected.profile, email: 'segundo@exemplo.pt' };
  await profilesDb.profiles.put(second);
  if (own) await profilesDb.profiles.put(own);
  return {
    profile: second,
    masterKey: connected.masterKey,
    repos: createRepositories(new ProfileDb(crypto.randomUUID()), connected.masterKey),
  };
}

const provider = { id: 'p1', nif: '5', name: 'NOS', sectors: [] } as never;

describe('runCloudSync', () => {
  it('saves the new sync state of the profile', async () => {
    await repos.providers.put(provider);
    const { profile: synced, result } = await runCloudSync({
      profile,
      masterKey: keys.masterKey,
      repos,
      drive,
    });
    expect(result.pushed).toBe(1);
    const saved = await profilesDb.profiles.get(profile.id);
    expect(saved?.cloud?.nextSeq).toBe(2);
    expect(saved?.cloud?.lastSyncAt).toBeDefined();
    expect(synced.cloud).toEqual(saved?.cloud);
  });

  it('starts from the profile as saved, not from an older copy of it', async () => {
    await repos.providers.put(provider);
    await runCloudSync({ profile, masterKey: keys.masterKey, repos, drive });
    const relinked = await setCloudFileSync(
      (await profilesDb.profiles.get(profile.id)) ?? profile,
      true,
    );
    expect(relinked.cloud?.nextSeq).toBe(2);
    // `profile` is the copy from before both: nextSeq 1, files off.
    await runCloudSync({ profile, masterKey: keys.masterKey, repos, drive });
    const saved = await profilesDb.profiles.get(profile.id);
    expect(saved?.cloud?.files).toBe(true);
    expect(saved?.cloud?.nextSeq).toBe(2);
  });

  it('keeps the state of what was sent when the rest of the sync fails', async () => {
    const other = await secondDevice();
    await other.repos.providers.put({ id: 'p2', nif: '5', name: 'Repsol', sectors: [] } as never);
    await runCloudSync({ ...other, drive });
    await repos.providers.put(provider);
    drive.failNext('throttled', 'read');
    await expect(
      runCloudSync({ profile, masterKey: keys.masterKey, repos, drive }),
    ).rejects.toMatchObject({ code: 'throttled' });
    const saved = await profilesDb.profiles.get(profile.id);
    expect(saved?.cloud?.nextSeq).toBe(2);
    expect(saved?.cloud?.lastPushedAt).not.toBe('');
  });

  it('runs one sync at a time for a profile (two tabs share its numbers)', async () => {
    let running = 0;
    let most = 0;
    const list = drive.list.bind(drive);
    drive.list = async (folder) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await list(folder);
      } finally {
        running--;
      }
    };
    await repos.providers.put(provider);
    await Promise.all([
      runCloudSync({ profile, masterKey: keys.masterKey, repos, drive }),
      runCloudSync({ profile, masterKey: keys.masterKey, repos, drive }),
    ]);
    expect(most).toBe(1);
  });

  it('stops when the Microsoft link expired, keeping the changes to send later', async () => {
    await repos.providers.put(provider);
    drive.failNext('needs_reconnect');
    await expect(
      runCloudSync({ profile, masterKey: keys.masterKey, repos, drive }),
    ).rejects.toMatchObject({ code: 'needs_reconnect' });
    expect((await profilesDb.profiles.get(profile.id))?.cloud).toEqual(profile.cloud);

    await runCloudSync({ profile, masterKey: keys.masterKey, repos, drive });
    const other = await secondDevice();
    const { result } = await runCloudSync({ ...other, drive });
    expect(result.received).toBe(1);
    expect((await other.repos.providers.list()).map((row) => row.name)).toEqual(['NOS']);
  });

  it('reads the others’ files again from the start after an update adds tables', async () => {
    await repos.providers.put(provider);
    await runCloudSync({ profile, masterKey: keys.masterKey, repos, drive });
    const other = await secondDevice();
    const first = await runCloudSync({ ...other, drive });
    expect(first.result.received).toBe(1);
    // As saved by an older version that did not know every table.
    const older: Profile = {
      ...first.profile,
      cloud: { ...(first.profile.cloud as NonNullable<Profile['cloud']>), pulledTables: [] },
    };
    await profilesDb.profiles.put(older);
    // That older version skipped the table it did not know: nothing of it is here.
    const fresh = createRepositories(new ProfileDb(crypto.randomUUID()), other.masterKey);
    const again = await runCloudSync({ ...other, repos: fresh, profile: older, drive });
    expect(again.result.received).toBe(1);
    expect((await fresh.providers.list()).map((row) => row.name)).toEqual(['NOS']);
    expect(again.profile.cloud?.pulledTables?.length).toBeGreaterThan(0);
  });

  it('sends to the cloud the originals that were only sent to the server before', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 servidor');
    const fileHash = await sha256Hex(new Uint8Array(pdf));
    const id = await repos.documents.put({ fileHash, mime: 'application/pdf', bytes: pdf });
    await repos.documents.markUploaded(id);
    const withFiles = await setCloudFileSync(profile, true);
    const { files } = await runCloudSync({
      profile: withFiles,
      masterKey: keys.masterKey,
      repos,
      drive,
    });
    expect(files?.uploaded).toBe(1);
  });

  it('turning the cloud off makes the originals sent there count as only here', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 nuvem');
    const fileHash = await sha256Hex(new Uint8Array(pdf));
    await repos.documents.put({ fileHash, mime: 'application/pdf', bytes: pdf });
    const withFiles = await setCloudFileSync(profile, true);
    await runCloudSync({ profile: withFiles, masterKey: keys.masterKey, repos, drive });
    expect(await repos.documents.stateOf(fileHash)).toBe('uploaded');
    await disableCloudSync(withFiles, repos);
    expect(await repos.documents.stateOf(fileHash)).toBe('local');
  });

  it('sends originals when this device syncs them', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 teste');
    const fileHash = await sha256Hex(new Uint8Array(pdf));
    await repos.documents.put({ fileHash, mime: 'application/pdf', bytes: new Uint8Array(pdf) });
    const withFiles = await setCloudFileSync(profile, true);
    const { files } = await runCloudSync({
      profile: withFiles,
      masterKey: keys.masterKey,
      repos,
      drive,
    });
    expect(files).toMatchObject({ uploaded: 1, storageFull: false });

    const other = await secondDevice();
    const otherWithFiles = await setCloudFileSync(other.profile, true);
    const received = await runCloudSync({ ...other, profile: otherWithFiles, drive });
    expect(received.files?.downloaded).toBe(1);
    expect((await other.repos.documents.getByFileHash(fileHash))?.bytes).toEqual(pdf);
  });
});

describe('changeAccountPassword with the cloud', () => {
  it('rewrites the account file, so a new device signs in with the new password', async () => {
    await changeAccountPassword({
      profile,
      masterKey: keys.masterKey,
      currentPassword: PASSWORD,
      newPassword: 'nova-palavra-passe',
      iterations: ITERATIONS,
      drive,
    });
    await profilesDb.profiles.delete(profile.id);
    const connect = (password: string) =>
      connectFromCloud({ drive, password, provider: 'onedrive', localIterations: ITERATIONS });
    await expect(connect(PASSWORD)).rejects.toMatchObject({ code: 'wrong_password' });
    expect((await connect('nova-palavra-passe')).profile.email).toBe('eu@exemplo.pt');
  });

  it('keeps the old password everywhere when the cloud cannot be written', async () => {
    drive.failNext('offline', 'write');
    await expect(
      changeAccountPassword({
        profile,
        masterKey: keys.masterKey,
        currentPassword: PASSWORD,
        newPassword: 'nova-palavra-passe',
        iterations: ITERATIONS,
        drive,
      }),
    ).rejects.toMatchObject({ code: 'offline' });
    expect((await profilesDb.profiles.get(profile.id))?.wrappedKey).toEqual(profile.wrappedKey);
  });
});

describe('syncPasswordAfterRecovery with the cloud', () => {
  it('rewrites the account file with the password set by the recovery key', async () => {
    const { rewrapWithPassword } = await import('../lib/crypto');
    const { syncPasswordAfterRecovery } = await import('../sync/account');
    const wrappedKey = await rewrapWithPassword(
      keys.wrapped,
      keys.masterKey,
      'depois-da-recuperacao',
      ITERATIONS,
    );
    const recovered: Profile = { ...profile, wrappedKey };
    const { serverUpdated } = await syncPasswordAfterRecovery({
      profile: recovered,
      masterKey: keys.masterKey,
      newPassword: 'depois-da-recuperacao',
      drive,
    });
    expect(serverUpdated).toBe(true);
    await profilesDb.profiles.delete(profile.id);
    const connected = await connectFromCloud({
      drive,
      password: 'depois-da-recuperacao',
      provider: 'onedrive',
      localIterations: ITERATIONS,
    });
    expect(connected.profile.email).toBe('eu@exemplo.pt');
  });
});

describe('cloud settings of the profile', () => {
  it('turns originals on and off, and the cloud sync off, keeping the rest', async () => {
    const withFiles = await setCloudFileSync(profile, true);
    expect((await profilesDb.profiles.get(profile.id))?.cloud?.files).toBe(true);
    expect(withFiles.cloud?.deviceId).toBe(profile.cloud?.deviceId);
    const off = await disableCloudSync(withFiles);
    expect(off.cloud).toBeUndefined();
    expect((await profilesDb.profiles.get(profile.id))?.cloud).toBeUndefined();
    expect((await profilesDb.profiles.get(profile.id))?.wrappedKey).toEqual(profile.wrappedKey);
  });
});
