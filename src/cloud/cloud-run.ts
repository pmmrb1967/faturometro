/** Runs the sync through the user's cloud for a profile, and keeps its state. */
import { profilesDb, type Profile, type ProfileCloud } from '../db/profiles';
import type { Repositories } from '../db/repositories';
import { SYNCED_TABLES } from '../sync/engine';
import type { FileSyncResult } from '../sync/files';
import { downloadOriginals, uploadOriginals } from './cloud-files';
import type { CloudDrive } from './drive';
import { driveFor } from './cloud-drives';
import { cloudSync, type CloudSyncState } from './sync-protocol';

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
export async function disableCloudSync(profile: Profile, repos?: Repositories): Promise<Profile> {
  // A server sync turned on later sends them again.
  await repos?.documents.forgetUploads();
  return saveCloud(profile, undefined);
}

type CloudRunInput = {
  profile: Profile;
  masterKey: CryptoKey;
  repos: Repositories;
  drive?: CloudDrive;
};
type CloudRunOutput = { profile: Profile; result: CloudRunResult; files?: FileSyncResult };

/** Runs in this tab while no other run holds the lock (between tabs: the Web Locks API). */
const queues = new Map<string, Promise<unknown>>();
function exclusive<T>(name: string, run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks) return locks.request(name, run);
  const previous = queues.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(name, next);
  return next;
}

/**
 * One sync at a time per profile: two tabs (the installed app and the browser) share the
 * profile's numbers, and two writers would write the same change file.
 */
export function runCloudSync(input: CloudRunInput): Promise<CloudRunOutput> {
  return exclusive(`faturometro-cloud-sync:${input.profile.id}`, () => cloudSyncOnce(input));
}

async function cloudSyncOnce(input: CloudRunInput): Promise<CloudRunOutput> {
  // The saved profile, not the caller's copy: an older copy would send numbers already
  // used and undo changes made since (files toggle, a new sign-in).
  const stored = (await profilesDb.profiles.get(input.profile.id)) ?? input.profile;
  const cloud = stored.cloud;
  if (!cloud) throw new Error('Cloud sync is not enabled');
  const drive = input.drive ?? driveFor(stored, input.masterKey);
  const { repos } = input;

  // Tables added since the last sync were skipped by the older version: read again from
  // the start (the bases have everything; last write wins, so nothing is applied twice).
  const missesTables = SYNCED_TABLES.some((table) => !cloud.pulledTables?.includes(table));
  const start = stateOf(cloud);
  if (missesTables) start.cursors = {};

  // First sync through the cloud on this device: originals sent only to the server go too.
  if (!cloud.lastSyncAt) await repos.documents.forgetUploads();
  const upload = cloud.files ? await uploadOriginals(repos, drive) : undefined;
  const synced = await cloudSync(repos, drive, start, {
    ...(upload ? { extraOutgoing: upload.records } : {}),
    baseExtras: () => repos.documents.cloudRecords(),
    onPushed: async (state) => {
      // Sent: the originals' records are out, and their numbers are taken.
      await upload?.confirm();
      await saveCloud(stored, {
        ...((await profilesDb.profiles.get(stored.id))?.cloud ?? cloud),
        ...state,
      });
    },
  });
  let files: FileSyncResult | undefined;
  if (upload) {
    if (synced.pushed === 0) await upload.confirm();
    const { downloaded } = await downloadOriginals(repos, drive, input.masterKey);
    files = {
      uploaded: upload.records.length,
      downloaded,
      pruned: 0,
      storageFull: upload.quotaFull,
    };
  }

  const latest = (await profilesDb.profiles.get(stored.id))?.cloud ?? cloud;
  const profile = await saveCloud(stored, {
    ...latest,
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
