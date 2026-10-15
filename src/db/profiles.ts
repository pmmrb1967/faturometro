import Dexie, { type Table } from 'dexie';
import type { EncryptedBlob, WrappedMasterKey } from '../lib/crypto';

/**
 * One local profile: an account (email + wrapped key, the only fields in clear) or the
 * guest (no password: the raw master key is stored, unprotected).
 */
export interface Profile {
  id: string;
  /** Empty for the guest (the unique index then allows only one guest). */
  email: string;
  createdAt: string;
  /** Accounts: the master key wrapped by the password and the recovery key. */
  wrappedKey?: WrappedMasterKey;
  /** Guest only: the raw master key in base64. */
  guestKey?: string;
  /** Present when this profile syncs with a server (device-local state). */
  sync?: ProfileSync;
}

export interface ProfileSync {
  serverUrl: string;
  /** Server account id: after a 401, tells a removed account from an ended session. */
  accountId?: string;
  /** The server says this account is an administrator (shown in the header). */
  admin?: boolean;
  /** Administrators: layout contributions waiting on the server, at the last sync. */
  contributions?: number;
  /** Session token, encrypted with the master key. */
  token: EncryptedBlob;
  /** Last server sequence number received. */
  lastPulledSeq: number;
  /** Latest local `updatedAt` already sent. */
  lastPushedAt: string;
  lastSyncAt?: string;
  /** Also sync original files (PDF, photos) on this device. */
  files?: boolean;
}

export class ProfilesDb extends Dexie {
  profiles!: Table<Profile, string>;

  constructor() {
    super('faturometro-profiles');
    this.version(1).stores({ profiles: 'id, &email' });
  }
}

export const profilesDb = new ProfilesDb();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const GUEST_EMAIL = '';

export function isGuest(profile: Profile): boolean {
  return profile.guestKey !== undefined;
}

/** The password-wrapped key of an account; a guest has none (sync never runs for it). */
export function wrappedKeyOf(profile: Profile): WrappedMasterKey {
  if (!profile.wrappedKey) throw new Error('Profile has no password');
  return profile.wrappedKey;
}
