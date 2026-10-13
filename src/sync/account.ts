/**
 * Turning sync on and off, signing in on a new device, and running a sync.
 * The password is needed only to derive the sync keys; it is never stored.
 */
import { normalizeEmail, profilesDb, type Profile } from '../db/profiles';
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

export type SyncErrorCode =
  | 'wrong_password'
  | 'account_exists'
  | 'wrong_credentials'
  | 'locked'
  | 'email_taken_locally'
  | 'offline'
  | 'session_expired';

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
  try {
    ({ token } = await api.register({
      email: input.profile.email,
      salt,
      iterations,
      authKey: keys.authKeyHex,
      wrappedKey: await wrapForSync(input.profile.wrappedKey, input.masterKey, keys),
    }));
  } catch (error) {
    fromHttp(error, { 409: 'account_exists' });
  }
  return saveSync(input.profile, {
    serverUrl: input.serverUrl,
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

/** Runs one sync and saves the new state on the profile. */
export async function runSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
  api?: SyncApi;
}): Promise<{ profile: Profile; result: SyncResult }> {
  const sync = input.profile.sync;
  if (!sync) throw new Error('Sync is not enabled');
  const api = input.api ?? new SyncApi(sync.serverUrl);
  const token = (await decryptJson(input.masterKey, sync.token)) as string;
  let result: SyncResult;
  try {
    result = await syncNow(input.repos, api, token, sync);
  } catch (error) {
    fromHttp(error, { 401: 'session_expired' });
  }
  const profile = await saveSync(input.profile, {
    ...sync,
    lastPulledSeq: result.lastPulledSeq,
    lastPushedAt: result.lastPushedAt,
    lastSyncAt: new Date().toISOString(),
  });
  return { profile, result };
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
