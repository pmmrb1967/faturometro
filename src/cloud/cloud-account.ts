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

function newCloudState(provider: CloudProvider, accountLabel?: string): ProfileCloud {
  return {
    provider,
    ...bootstrapState(crypto.randomUUID()),
    ...(accountLabel ? { accountLabel } : {}),
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

/** Turns on the sync through the cloud for this profile (not yet syncing through the server). */
export async function enableCloudSync(input: {
  profile: Profile;
  masterKey: CryptoKey;
  password: string;
  drive: CloudDrive;
  provider: CloudProvider;
}): Promise<Profile> {
  const { profile, drive } = input;
  await unlock(wrappedKeyOf(profile), input.password);
  const existing = await readJson(drive, CLOUD_ACCOUNT_FILE, accountSchema);
  if (existing && normalizeEmail(existing.email) !== normalizeEmail(profile.email)) {
    throw new CloudAccountError('other_account');
  }
  if (!existing) {
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
      if (!created || normalizeEmail(created.email) !== normalizeEmail(profile.email)) {
        throw new CloudAccountError('other_account');
      }
    }
  }
  const updated: Profile = {
    ...profile,
    cloud: profile.cloud ?? newCloudState(input.provider, await label(drive)),
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
    cloud: newCloudState(input.provider, await label(input.drive)),
  };
  await profilesDb.profiles.add(profile);
  return { profile, masterKey };
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
