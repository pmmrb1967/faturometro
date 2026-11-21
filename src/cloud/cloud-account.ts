/**
 * The account in the user's cloud folder: `conta.json` holds the email and the
 * master key wrapped by the password and by the recovery key, as the profile
 * keeps it here. A new device signs in with the cloud and the password only.
 */
import { z } from 'zod';
import {
  normalizeEmail,
  profilesDb,
  wrappedKeyOf,
  type CloudProvider,
  type Profile,
  type ProfileCloud,
} from '../db/profiles';
import {
  deriveOwnerProof,
  PBKDF2_ITERATIONS,
  rewrapWithPassword,
  unlockWithPassword,
  type WrappedMasterKey,
} from '../lib/crypto';
import { CloudError, readJson, readJsonWithEtag, writeJson, type CloudDrive } from './drive';
import { bootstrapState } from './sync-protocol';

export const CLOUD_ACCOUNT_FILE = 'conta.json';
const FORMAT = 'faturometro-cloud-account';

export type CloudAccountErrorCode =
  'other_account' | 'wrong_password' | 'no_account' | 'email_taken_locally';

export class CloudAccountError extends Error {
  readonly code: CloudAccountErrorCode;
  constructor(code: CloudAccountErrorCode) {
    super(code);
    this.name = 'CloudAccountError';
    this.code = code;
  }
}

const blobSchema = z.object({ iv: z.string().max(100), data: z.string().max(1_000) });
const accountSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  email: z.string().min(1).max(320),
  wrappedKey: z.object({
    byPassword: blobSchema,
    kdf: z.object({
      algorithm: z.literal('PBKDF2-SHA256'),
      iterations: z.number().int().positive().max(10_000_000),
      salt: z.string().max(100),
    }),
    byRecoveryKey: blobSchema,
    recoverySalt: z.string().max(100),
  }),
});
type CloudAccount = z.infer<typeof accountSchema>;

const accountFile = (email: string, wrappedKey: WrappedMasterKey): CloudAccount => ({
  format: FORMAT,
  version: 1,
  email,
  wrappedKey,
});

function newCloudState(
  provider: CloudProvider,
  accountLabel?: string,
  accountId?: string,
): ProfileCloud {
  return {
    provider,
    ...bootstrapState(crypto.randomUUID()),
    ...(accountLabel ? { accountLabel } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

async function label(drive: CloudDrive): Promise<string | undefined> {
  try {
    return (await drive.account()).label;
  } catch {
    return undefined;
  }
}

async function unlock(wrapped: WrappedMasterKey, password: string): Promise<CryptoKey> {
  try {
    return await unlockWithPassword(wrapped, password);
  } catch {
    throw new CloudAccountError('wrong_password');
  }
}

/**
 * The account file is this profile's: same email and the same master key. A new local
 * account made with the same email has other keys; joining would mix records nobody reads.
 */
async function assertSameAccount(
  file: z.infer<typeof accountSchema>,
  profile: Profile,
  masterKey: CryptoKey,
  password: string,
): Promise<void> {
  if (normalizeEmail(file.email) !== normalizeEmail(profile.email)) {
    throw new CloudAccountError('other_account');
  }
  const theirs = await unlock(file.wrappedKey, password);
  if ((await deriveOwnerProof(theirs)) !== (await deriveOwnerProof(masterKey))) {
    throw new CloudAccountError('other_account');
  }
}

/** Turns on the sync through the cloud for this profile (not yet syncing through the server). */
export async function enableCloudSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  password: string;
  drive: CloudDrive;
  provider: CloudProvider;
  /** The signed-in cloud account (MSAL `homeAccountId`). */
  accountId?: string;
}): Promise<Profile> {
  const { profile, drive } = input;
  await unlock(wrappedKeyOf(profile), input.password);
  const existing = await readJson(drive, CLOUD_ACCOUNT_FILE, accountSchema);
  if (existing) await assertSameAccount(existing, profile, input.masterKey, input.password);
  else {
    try {
      await writeJson(
        drive,
        CLOUD_ACCOUNT_FILE,
        accountFile(profile.email, wrappedKeyOf(profile)),
        {
          ifNoneMatch: '*',
        },
      );
    } catch (error) {
      // Another device created it a moment ago: it must be this account's.
      if (!(error instanceof CloudError && error.code === 'conflict')) throw error;
      const created = await readJson(drive, CLOUD_ACCOUNT_FILE, accountSchema);
      if (!created) throw new CloudAccountError('other_account');
      await assertSameAccount(created, profile, input.masterKey, input.password);
    }
  }
  const updated: Profile = {
    ...profile,
    cloud: profile.cloud ?? newCloudState(input.provider, await label(drive), input.accountId),
  };
  await profilesDb.profiles.put(updated);
  return updated;
}

/** New device: creates the local profile from the account in the cloud folder. */
export async function connectFromCloud(input: {
  drive: CloudDrive;
  password: string;
  provider: CloudProvider;
  localIterations?: number;
  accountId?: string;
}): Promise<{ profile: Profile; masterKey: CryptoKey }> {
  const account = await readJson(input.drive, CLOUD_ACCOUNT_FILE, accountSchema);
  if (!account) throw new CloudAccountError('no_account');
  const email = normalizeEmail(account.email);
  if (await profilesDb.profiles.where('email').equals(email).count()) {
    throw new CloudAccountError('email_taken_locally');
  }
  const masterKey = await unlock(account.wrappedKey, input.password);
  // Local wrap with its own salt; the recovery key works on every device.
  const wrappedKey = await rewrapWithPassword(
    account.wrappedKey,
    masterKey,
    input.password,
    input.localIterations ?? PBKDF2_ITERATIONS,
  );
  const profile: Profile = {
    id: crypto.randomUUID(),
    email,
    createdAt: new Date().toISOString(),
    wrappedKey,
    cloud: newCloudState(input.provider, await label(input.drive), input.accountId),
  };
  await profilesDb.profiles.add(profile);
  return { profile, masterKey };
}

/**
 * Signed in to the cloud again (the link expired): keeps the new sign-in only if its
 * folder holds this account, so the sync never writes into someone else's folder.
 */
export async function relinkCloud(input: {
  profile: Profile;
  drive: CloudDrive;
  accountId: string;
}): Promise<Profile> {
  const cloud = input.profile.cloud;
  if (!cloud) throw new Error('Cloud sync is not enabled');
  const account = await readJson(input.drive, CLOUD_ACCOUNT_FILE, accountSchema);
  if (!account || normalizeEmail(account.email) !== normalizeEmail(input.profile.email)) {
    throw new CloudAccountError('other_account');
  }
  const stored = (await profilesDb.profiles.get(input.profile.id)) ?? input.profile;
  const updated: Profile = {
    ...stored,
    cloud: { ...cloud, accountId: input.accountId, ...(await labelled(input.drive)) },
  };
  await profilesDb.profiles.put(updated);
  return updated;
}

async function labelled(drive: CloudDrive): Promise<{ accountLabel?: string }> {
  const accountLabel = await label(drive);
  return accountLabel ? { accountLabel } : {};
}

/** After a password change: the account file opens with the new password only. */
export async function rewrapCloudAccount(input: {
  drive: CloudDrive;
  email: string;
  wrappedKey: WrappedMasterKey;
}): Promise<void> {
  const value = accountFile(input.email, input.wrappedKey);
  for (let attempt = 0; ; attempt++) {
    const current = await readJsonWithEtag(input.drive, CLOUD_ACCOUNT_FILE, accountSchema);
    try {
      await writeJson(
        input.drive,
        CLOUD_ACCOUNT_FILE,
        value,
        current ? { ifMatch: current.etag } : { ifNoneMatch: '*' },
      );
      return;
    } catch (error) {
      if (attempt > 0 || !(error instanceof CloudError && error.code === 'conflict')) throw error;
    }
  }
}
