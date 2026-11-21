/**
 * From the sync server to the user's own cloud. The profile keeps syncing
 * through the server until the cloud holds everything; then the server is
 * told (other devices learn of the move) and, if the user wants, its data goes.
 */
import { profilesDb, type CloudProvider, type Profile, type ProfileSync } from '../db/profiles';
import type { Repositories } from '../db/repositories';
import { decryptJson, deriveOwnerProof } from '../lib/crypto';
import { fromHttp, runSync, SyncError } from '../sync/account';
import { SyncApi } from '../sync/api';
import { download } from '../sync/files';
import { enableCloudSync } from './cloud-account';
import { runCloudSync, saveCloud } from './cloud-run';
import type { CloudDrive } from './drive';

/** Brings here the originals whose contents are only on the server; how many could not come. */
async function downloadServerOnly(
  repos: Repositories,
  api: SyncApi,
  token: string,
  key: CryptoKey,
): Promise<number> {
  let missing = 0;
  for (const meta of await repos.documents.remoteOnly()) {
    try {
      if (!(await download(repos, api, token, key, meta))) missing++;
    } catch {
      missing++;
    }
  }
  return missing;
}

export async function migrateToCloud(input: {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
  drive: CloudDrive;
  password: string;
  api?: SyncApi;
  /** The cloud moved to (OneDrive when not given). */
  provider?: CloudProvider;
  accountId?: string;
  /** Dropbox and Google Drive: the lasting link of the sign-in. */
  refreshToken?: string;
}): Promise<{ profile: Profile; previous: ProfileSync; originalsMissing: number }> {
  const { masterKey, repos, drive } = input;
  if (!input.profile.sync) throw new Error('Sync is not enabled');
  const api = input.api ?? new SyncApi(input.profile.sync.serverUrl);

  // 1. Everything the server has, so the cloud gets it all.
  let profile = input.profile;
  let alreadyMoved = false;
  try {
    profile = (await runSync({ profile, masterKey, repos, api })).profile;
  } catch (error) {
    // Another device of the account moved first: what the server had is here already.
    if (!(error instanceof SyncError && error.code === 'moved_to_cloud')) throw error;
    alreadyMoved = true;
    profile = (await profilesDb.profiles.get(profile.id)) ?? profile;
  }
  const previous = profile.sync;
  if (!previous) throw new Error('Sync is not enabled');
  const token = (await decryptJson(masterKey, previous.token)) as string;
  const originalsMissing = await downloadServerOnly(repos, api, token, masterKey);

  // 2. The cloud, with every record and every original here.
  profile = await enableCloudSync({
    profile,
    masterKey,
    password: input.password,
    drive,
    provider: input.provider ?? 'onedrive',
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
  });
  const cloud = profile.cloud;
  if (!cloud) throw new Error('Cloud sync is not enabled');
  profile = await saveCloud(profile, { ...cloud, files: previous.files ?? false });
  // Originals sent to the server count as only here again, so they go to the cloud. Those
  // only on the server are lost with it, unless another device moved first: then they are
  // in the cloud already and come from there.
  if (alreadyMoved) await repos.documents.forgetUploads();
  else await repos.documents.forgetServer();
  try {
    profile = (await runCloudSync({ profile, masterKey, repos, drive })).profile;
  } catch (error) {
    // Still syncing through the server; the next server sync sends the originals again.
    await saveCloud(profile, undefined);
    throw error;
  }

  // 3. No longer through the server; administrators keep their link to it.
  const updated: Profile = { ...profile };
  delete updated.sync;
  if (previous.admin) {
    updated.adminLink = {
      serverUrl: previous.serverUrl,
      token: previous.token,
      ...(previous.contributions !== undefined ? { contributions: previous.contributions } : {}),
      checkedAt: new Date().toISOString(),
    };
  }
  await profilesDb.profiles.put(updated);
  return { profile: updated, previous, originalsMissing };
}

/** Tells the server about the move (its other devices learn it) and deletes its data if asked. */
export async function finishServerData(input: {
  previous: ProfileSync;
  masterKey: CryptoKey;
  deleteData: boolean;
  api?: SyncApi;
}): Promise<void> {
  const api = input.api ?? new SyncApi(input.previous.serverUrl);
  const token = (await decryptJson(input.masterKey, input.previous.token)) as string;
  try {
    await api.moved(token, await deriveOwnerProof(input.masterKey), input.deleteData);
  } catch (error) {
    fromHttp(error, { 401: 'session_expired' });
  }
}
