/** Runs the sync through the user's cloud for a profile, and keeps its state. */
import { profilesDb, type Profile, type ProfileCloud } from '../db/profiles';
import type { Repositories } from '../db/repositories';
import { SYNCED_TABLES } from '../sync/engine';
import type { FileSyncResult } from '../sync/files';
import { downloadOriginals, uploadOriginals } from './cloud-files';
import type { CloudDrive } from './drive';
import { OneDrive } from './onedrive';
import { oneDriveToken } from './onedrive-auth';
import { cloudSync, type CloudSyncState } from './sync-protocol';

/** The OneDrive of a signed-in Microsoft account (the last one when not given). */
export function oneDriveFor(accountId?: string): CloudDrive {
  return new OneDrive(() => oneDriveToken(accountId));
}

/** The drive of the profile's cloud account. */
export function driveFor(profile: Profile): CloudDrive {
  return oneDriveFor(profile.cloud?.accountId);
}

export interface CloudRunResult {
  pushed: number;
  received: number;
  conflicts: number;
}

function stateOf(cloud: ProfileCloud): CloudSyncState {
  return {
    deviceId: cloud.deviceId,
    nextSeq: cloud.nextSeq,
    lastPushedAt: cloud.lastPushedAt,
    cursors: cloud.cursors,
  };
}

/** Saves the cloud state on the profile as stored now (other fields may have changed). */
export async function saveCloud(
  profile: Profile,
  cloud: ProfileCloud | undefined,
): Promise<Profile> {
  const stored = (await profilesDb.profiles.get(profile.id)) ?? profile;
  const updated: Profile = { ...stored };
  if (cloud) updated.cloud = cloud;
  else delete updated.cloud;
  await profilesDb.profiles.put(updated);
  return updated;
}

/** Turns the sync of original files through the cloud on or off on this device. */
export async function setCloudFileSync(profile: Profile, enabled: boolean): Promise<Profile> {
  if (!profile.cloud) return profile;
  return saveCloud(profile, { ...profile.cloud, files: enabled });
}

/** Stops syncing through the cloud on this device; the files in the cloud stay. */
export async function disableCloudSync(profile: Profile): Promise<Profile> {
  return saveCloud(profile, undefined);
}

export async function runCloudSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
  drive?: CloudDrive;
}): Promise<{ profile: Profile; result: CloudRunResult; files?: FileSyncResult }> {
  const cloud = input.profile.cloud;
  if (!cloud) throw new Error('Cloud sync is not enabled');
  const drive = input.drive ?? driveFor(input.profile);
  const { repos } = input;

  // Tables added since the last sync were skipped by the older version: read again from
  // the start (the bases have everything; last write wins, so nothing is applied twice).
  const missesTables = SYNCED_TABLES.some((table) => !cloud.pulledTables?.includes(table));
  const start = stateOf(cloud);
  if (missesTables) start.cursors = {};

  const upload = cloud.files ? await uploadOriginals(repos, drive) : undefined;
  const synced = await cloudSync(repos, drive, start, {
    ...(upload ? { extraOutgoing: upload.records } : {}),
    baseExtras: () => repos.documents.cloudRecords(),
  });
  let files: FileSyncResult | undefined;
  if (upload) {
    await upload.confirm();
    const { downloaded } = await downloadOriginals(repos, drive, input.masterKey);
    files = {
      uploaded: upload.records.length,
      downloaded,
      pruned: 0,
      storageFull: upload.quotaFull,
    };
  }

  const profile = await saveCloud(input.profile, {
    ...cloud,
    ...synced.state,
    pulledTables: [...SYNCED_TABLES],
    lastSyncAt: new Date().toISOString(),
  });
  return {
    profile,
    result: { pushed: synced.pushed, received: synced.received, conflicts: synced.conflicts },
    ...(files ? { files } : {}),
  };
}
