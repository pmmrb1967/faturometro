import {
  GUEST_EMAIL,
  isGuest,
  normalizeEmail,
  profilesDb,
  wrappedKeyOf,
  type Profile,
} from '../../db/profiles';
import {
  PBKDF2_ITERATIONS,
  WrongSecretError,
  createAccountKeys,
  exportMasterKey,
  generateMasterKey,
  importMasterKey,
  rewrapWithPassword,
  unlockWithPassword,
  unlockWithRecoveryKey,
  wrapMasterKey,
} from '../../lib/crypto';

export type AccountErrorCode = 'email_taken' | 'not_found' | 'wrong_secret';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.name = 'AccountError';
    this.code = code;
  }
}

export interface UnlockedAccount {
  profile: Profile;
  masterKey: CryptoKey;
}

export async function createAccount(
  email: string,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<UnlockedAccount & { recoveryKey: string }> {
  const normalized = normalizeEmail(email);
  if (await profilesDb.profiles.where('email').equals(normalized).count()) {
    throw new AccountError('email_taken');
  }
  const { masterKey, wrapped, recoveryKey } = await createAccountKeys(password, iterations);
  const profile: Profile = {
    id: crypto.randomUUID(),
    email: normalized,
    createdAt: new Date().toISOString(),
    wrappedKey: wrapped,
  };
  await profilesDb.profiles.add(profile);
  return { profile, masterKey, recoveryKey };
}

async function findProfile(email: string): Promise<Profile> {
  const profile = await profilesDb.profiles.where('email').equals(normalizeEmail(email)).first();
  if (!profile || isGuest(profile)) throw new AccountError('not_found');
  return profile;
}

async function guard<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof WrongSecretError) throw new AccountError('wrong_secret');
    throw error;
  }
}

export async function unlockAccount(email: string, password: string): Promise<UnlockedAccount> {
  const profile = await findProfile(email);
  const masterKey = await guard(unlockWithPassword(wrappedKeyOf(profile), password));
  return { profile, masterKey };
}

/** Opens the account with the recovery key and sets a new password. */
export async function recoverAccount(
  email: string,
  recoveryKey: string,
  newPassword: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<UnlockedAccount> {
  const profile = await findProfile(email);
  const masterKey = await guard(unlockWithRecoveryKey(wrappedKeyOf(profile), recoveryKey));
  return { profile: await savePassword(profile, masterKey, newPassword, iterations), masterKey };
}

export async function changePassword(
  account: UnlockedAccount,
  currentPassword: string,
  newPassword: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<Profile> {
  await guard(unlockWithPassword(wrappedKeyOf(account.profile), currentPassword));
  return savePassword(account.profile, account.masterKey, newPassword, iterations);
}

async function savePassword(
  profile: Profile,
  masterKey: CryptoKey,
  newPassword: string,
  iterations: number,
): Promise<Profile> {
  const wrappedKey = await rewrapWithPassword(
    wrappedKeyOf(profile),
    masterKey,
    newPassword,
    iterations,
  );
  const updated = { ...profile, wrappedKey };
  await profilesDb.profiles.put(updated);
  return updated;
}

export async function listAccountEmails(): Promise<string[]> {
  return (await profilesDb.profiles.toArray())
    .filter((profile) => !isGuest(profile))
    .map((profile) => profile.email)
    .sort();
}

async function findGuest(): Promise<Profile | undefined> {
  return profilesDb.profiles.where('email').equals(GUEST_EMAIL).first();
}

export async function openGuest(): Promise<UnlockedAccount | null> {
  const profile = await findGuest();
  if (!profile?.guestKey) return null;
  return { profile, masterKey: await importMasterKey(profile.guestKey) };
}

/** The profile without an account; returns the existing one if there is one. */
export async function createGuest(): Promise<UnlockedAccount> {
  const existing = await openGuest();
  if (existing) return existing;
  const masterKey = await generateMasterKey();
  const profile: Profile = {
    id: crypto.randomUUID(),
    email: GUEST_EMAIL,
    createdAt: new Date().toISOString(),
    guestKey: await exportMasterKey(masterKey),
  };
  await profilesDb.profiles.add(profile);
  return { profile, masterKey };
}

/** Turns the guest into an account: same master key and data, now wrapped by a password. */
export async function convertGuest(
  account: UnlockedAccount,
  email: string,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ profile: Profile; recoveryKey: string }> {
  const normalized = normalizeEmail(email);
  if (await profilesDb.profiles.where('email').equals(normalized).count()) {
    throw new AccountError('email_taken');
  }
  const { wrapped, recoveryKey } = await wrapMasterKey(account.masterKey, password, iterations);
  const { id, createdAt, sync } = account.profile;
  const profile: Profile = { id, email: normalized, createdAt, wrappedKey: wrapped };
  if (sync) profile.sync = sync;
  // One write: the profile is either still the guest or fully an account.
  await profilesDb.profiles.put(profile);
  return { profile, recoveryKey };
}
