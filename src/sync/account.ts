/**
 * Turning sync on and off, signing in on a new device, and running a sync.
 * The password is needed only to derive the sync keys; it is never stored.
 */
import { normalizeEmail, profilesDb, type Profile, type ProfileSync } from '../db/profiles';
import type { Repositories } from '../db/repositories';
import {
  PBKDF2_ITERATIONS,
  decryptJson,
  deriveSyncKeys,
  encryptJson,
  newSyncSalt,
  rewrapWithPassword,
  unlockWithPassword,
  unwrapFromSync,
  wrapForSync,
  WrongSecretError,
} from '../lib/crypto';
import { SyncApi, SyncHttpError } from './api';
import { syncNow, type SyncResult } from './engine';
import { download, syncFiles, type FileSyncResult } from './files';

export type SyncErrorCode =
  | 'wrong_password'
  | 'account_exists'
  | 'wrong_credentials'
  | 'locked'
  | 'email_taken_locally'
  | 'offline'
  | 'session_expired'
  | 'different_account'
  | 'capacity'
  | 'records_full'
  | 'account_removed';

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  constructor(code: SyncErrorCode) {
    super(code);
    this.name = 'SyncError';
    this.code = code;
  }
}

function fromHttp(error: unknown, byStatus: Partial<Record<number, SyncErrorCode>>): never {
  if (error instanceof SyncHttpError) {
    const code = byStatus[error.status];
    if (code) throw new SyncError(code);
    throw error;
  }
  if (error instanceof TypeError) throw new SyncError('offline'); // fetch network failure
  throw error;
}

async function saveSync(profile: Profile, sync: Profile['sync']): Promise<Profile> {
  const updated: Profile = { ...profile };
  if (sync) updated.sync = sync;
  else delete updated.sync;
  await profilesDb.profiles.put(updated);
  return updated;
}

/** Creates the server account for this local profile and stores the sync state. */
export async function enableSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  password: string;
  serverUrl: string;
  api?: SyncApi;
  iterations?: number;
}): Promise<Profile> {
  const api = input.api ?? new SyncApi(input.serverUrl);
  try {
    await unlockWithPassword(input.profile.wrappedKey, input.password);
  } catch (error) {
    if (error instanceof WrongSecretError) throw new SyncError('wrong_password');
    throw error;
  }
  const salt = newSyncSalt();
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const keys = await deriveSyncKeys(input.password, salt, iterations);
  let token: string;
  let accountId: string;
  try {
    ({ token, accountId } = await api.register({
      email: input.profile.email,
      salt,
      iterations,
      authKey: keys.authKeyHex,
      wrappedKey: await wrapForSync(input.profile.wrappedKey, input.masterKey, keys),
    }));
  } catch (error) {
    fromHttp(error, { 409: 'account_exists', 503: 'capacity' });
  }
  return saveSync(input.profile, {
    serverUrl: input.serverUrl,
    accountId,
    token: await encryptJson(input.masterKey, token),
    lastPulledSeq: 0,
    lastPushedAt: '',
  });
}

/** New device: signs in to the server and creates the local profile from it. */
export async function connectFromServer(input: {
  serverUrl: string;
  email: string;
  password: string;
  api?: SyncApi;
  localIterations?: number;
}): Promise<{ profile: Profile; masterKey: CryptoKey }> {
  const api = input.api ?? new SyncApi(input.serverUrl);
  const email = normalizeEmail(input.email);
  if (await profilesDb.profiles.where('email').equals(email).count()) {
    throw new SyncError('email_taken_locally');
  }
  let login: Awaited<ReturnType<SyncApi['login']>>;
  try {
    const { salt, iterations } = await api.prelogin(email);
    const keys = await deriveSyncKeys(input.password, salt, iterations);
    login = await api.login(email, keys.authKeyHex);
    const masterKey = await unwrapFromSync(login.wrappedKey.byPassword, keys);
    // Local wrap with its own salt; the recovery key works on every device.
    const wrappedKey = await rewrapWithPassword(
      {
        byPassword: login.wrappedKey.byPassword,
        kdf: { algorithm: 'PBKDF2-SHA256', iterations: 0, salt: '' },
        byRecoveryKey: login.wrappedKey.byRecoveryKey,
        recoverySalt: login.wrappedKey.recoverySalt,
      },
      masterKey,
      input.password,
      input.localIterations ?? PBKDF2_ITERATIONS,
    );
    const profile: Profile = {
      id: crypto.randomUUID(),
      email,
      createdAt: new Date().toISOString(),
      wrappedKey,
      sync: {
        serverUrl: input.serverUrl,
        accountId: login.accountId,
        token: await encryptJson(masterKey, login.token),
        lastPulledSeq: 0,
        lastPushedAt: '',
      },
    };
    await profilesDb.profiles.add(profile);
    return { profile, masterKey };
  } catch (error) {
    if (error instanceof WrongSecretError) throw new SyncError('wrong_credentials');
    fromHttp(error, { 401: 'wrong_credentials', 429: 'locked' });
  }
}

/** After a 401: was the server account removed for inactivity? */
async function wasRemoved(error: unknown, api: SyncApi, sync: ProfileSync): Promise<boolean> {
  if (!(error instanceof SyncHttpError) || error.status !== 401 || !sync.accountId) return false;
  try {
    return (await api.removed(sync.accountId)).removed;
  } catch {
    return false;
  }
}

/** Runs one sync and saves the new state on the profile. */
export async function runSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
  api?: SyncApi;
}): Promise<{ profile: Profile; result: SyncResult; files?: FileSyncResult }> {
  const current = input.profile.sync;
  if (!current) throw new Error('Sync is not enabled');
  let sync: ProfileSync = current;
  const api = input.api ?? new SyncApi(sync.serverUrl);
  const token = (await decryptJson(input.masterKey, sync.token)) as string;
  let result: SyncResult;
  let files: FileSyncResult | undefined;
  try {
    if (!sync.accountId) sync = { ...sync, accountId: (await api.account(token)).id };
    result = await syncNow(input.repos, api, token, sync);
    if (sync.files) files = await syncFiles(input.repos, api, token, input.masterKey);
  } catch (error) {
    if (await wasRemoved(error, api, sync)) {
      // Removed for inactivity: the data stays on this device; sync can be turned on again.
      await saveSync(input.profile, undefined);
      throw new SyncError('account_removed');
    }
    fromHttp(error, { 401: 'session_expired', 507: 'records_full' });
  }
  const profile = await saveSync(input.profile, {
    ...sync,
    lastPulledSeq: result.lastPulledSeq,
    lastPushedAt: result.lastPushedAt,
    lastSyncAt: new Date().toISOString(),
  });
  return { profile, result, ...(files ? { files } : {}) };
}

/** Turns the sync of original files on or off on this device. */
export async function setFileSync(profile: Profile, enabled: boolean): Promise<Profile> {
  if (!profile.sync) return profile;
  return saveSync(profile, { ...profile.sync, files: enabled });
}

/** Space used on the server by original files. */
export async function fileUsage(input: {
  profile: Profile;
  masterKey: CryptoKey;
  api?: SyncApi;
}): Promise<{ used: number; quota: number; keepMonths: number | null }> {
  const sync = input.profile.sync;
  if (!sync) throw new Error('Sync is not enabled');
  const api = input.api ?? new SyncApi(sync.serverUrl);
  const token = (await decryptJson(input.masterKey, sync.token)) as string;
  try {
    return await api.fileUsage(token);
  } catch (error) {
    fromHttp(error, { 401: 'session_expired' });
  }
}

/** Fetches the original of an invoice that is only on the server (opened on demand). */
export async function fetchOriginal(input: {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
  fileHash: string;
  api?: SyncApi;
}): Promise<boolean> {
  const sync = input.profile.sync;
  const meta = await input.repos.documents.remoteMetaByFileHash(input.fileHash);
  if (!sync || !meta) return false;
  const api = input.api ?? new SyncApi(sync.serverUrl);
  const token = (await decryptJson(input.masterKey, sync.token)) as string;
  try {
    return await download(input.repos, api, token, input.masterKey, meta);
  } catch (error) {
    fromHttp(error, { 401: 'session_expired' });
  }
}

/**
 * Sends new server keys derived from `newPassword` (session token only, no
 * old password needed). The server signs out the other devices.
 */
async function updateServerPassword(input: {
  profile: Profile;
  masterKey: CryptoKey;
  newPassword: string;
  localWrappedKey: Profile['wrappedKey'];
  api?: SyncApi;
  iterations?: number;
}): Promise<NonNullable<Profile['sync']>> {
  const sync = input.profile.sync;
  if (!sync) throw new Error('Sync is not enabled');
  const api = input.api ?? new SyncApi(sync.serverUrl);
  const token = (await decryptJson(input.masterKey, sync.token)) as string;
  const salt = newSyncSalt();
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const keys = await deriveSyncKeys(input.newPassword, salt, iterations);
  try {
    const { token: newToken } = await api.updateKeys(token, {
      authKey: keys.authKeyHex,
      salt,
      iterations,
      wrappedKey: await wrapForSync(input.localWrappedKey, input.masterKey, keys),
    });
    return { ...sync, token: await encryptJson(input.masterKey, newToken) };
  } catch (error) {
    fromHttp(error, { 401: 'session_expired' });
  }
}

/**
 * Changes the account password on this device and, with sync on, on the
 * server too (server first, so a failure leaves both unchanged).
 */
export async function changeAccountPassword(input: {
  profile: Profile;
  masterKey: CryptoKey;
  currentPassword: string;
  newPassword: string;
  api?: SyncApi;
  iterations?: number;
}): Promise<Profile> {
  try {
    await unlockWithPassword(input.profile.wrappedKey, input.currentPassword);
  } catch (error) {
    if (error instanceof WrongSecretError) throw new SyncError('wrong_password');
    throw error;
  }
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const wrappedKey = await rewrapWithPassword(
    input.profile.wrappedKey,
    input.masterKey,
    input.newPassword,
    iterations,
  );
  const updated: Profile = { ...input.profile, wrappedKey };
  if (input.profile.sync) {
    updated.sync = await updateServerPassword({
      ...input,
      localWrappedKey: wrappedKey,
      iterations,
    });
  }
  await profilesDb.profiles.put(updated);
  return updated;
}

/**
 * After a recovery-key reset: tries to give the server the new password too.
 * Returns the profile unchanged (and `false`) if the server cannot be reached.
 */
export async function syncPasswordAfterRecovery(input: {
  profile: Profile;
  masterKey: CryptoKey;
  newPassword: string;
  api?: SyncApi;
  iterations?: number;
}): Promise<{ profile: Profile; serverUpdated: boolean }> {
  if (!input.profile.sync) return { profile: input.profile, serverUpdated: true };
  try {
    const sync = await updateServerPassword({
      ...input,
      localWrappedKey: input.profile.wrappedKey,
    });
    return { profile: await saveSync(input.profile, sync), serverUpdated: true };
  } catch {
    return { profile: input.profile, serverUpdated: false };
  }
}

async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const [x, y] = await Promise.all([
    crypto.subtle.exportKey('raw', a),
    crypto.subtle.exportKey('raw', b),
  ]);
  const bx = new Uint8Array(x);
  const by = new Uint8Array(y);
  return bx.length === by.length && bx.every((byte, i) => byte === by[i]);
}

/**
 * Signs in to the server again when the session ended (usually because the
 * password was changed on another device). The local password becomes the
 * one given here, so every device ends up with the same password.
 */
export async function reconnectSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  password: string;
  api?: SyncApi;
  localIterations?: number;
}): Promise<Profile> {
  const sync = input.profile.sync;
  if (!sync) throw new Error('Sync is not enabled');
  const api = input.api ?? new SyncApi(sync.serverUrl);
  try {
    const { salt, iterations } = await api.prelogin(input.profile.email);
    const keys = await deriveSyncKeys(input.password, salt, iterations);
    const login = await api.login(input.profile.email, keys.authKeyHex);
    const serverKey = await unwrapFromSync(login.wrappedKey.byPassword, keys);
    if (!(await sameKey(serverKey, input.masterKey))) throw new SyncError('different_account');
    const wrappedKey = await rewrapWithPassword(
      input.profile.wrappedKey,
      input.masterKey,
      input.password,
      input.localIterations ?? PBKDF2_ITERATIONS,
    );
    const updated: Profile = {
      ...input.profile,
      wrappedKey,
      sync: {
        ...sync,
        accountId: login.accountId,
        token: await encryptJson(input.masterKey, login.token),
      },
    };
    await profilesDb.profiles.put(updated);
    return updated;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    if (error instanceof WrongSecretError) throw new SyncError('wrong_credentials');
    fromHttp(error, { 401: 'wrong_credentials', 429: 'locked' });
  }
}

/** Turns sync off; with `deleteRemote`, deletes the server account and every record there. */
export async function disableSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  deleteRemote: boolean;
  api?: SyncApi;
}): Promise<Profile> {
  const sync = input.profile.sync;
  if (!sync) return input.profile;
  if (input.deleteRemote) {
    const api = input.api ?? new SyncApi(sync.serverUrl);
    const token = (await decryptJson(input.masterKey, sync.token)) as string;
    try {
      await api.deleteAccount(token);
    } catch (error) {
      fromHttp(error, { 401: 'session_expired' });
    }
  }
  return saveSync(input.profile, undefined);
}
