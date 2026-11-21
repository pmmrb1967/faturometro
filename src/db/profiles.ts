import Dexie, { type Table } from 'dexie';
import type { CloudSyncState } from '../cloud/sync-protocol';
import type { AutoBackupEvery, AutoBackupKeep } from '../domain/auto-backup';
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
  /** Present when this profile syncs with a server (device-local state). Never with `cloud`. */
  sync?: ProfileSync;
  /** Present when this profile syncs through the user's own cloud. Never with `sync`. */
  cloud?: ProfileCloud;
  /** Administrators who do not sync through the server: their link to it (badge, contributions). */
  adminLink?: AdminLink;
}

export type CloudProvider = 'onedrive';

/** Device-local state of the sync through the user's cloud. */
export interface ProfileCloud extends CloudSyncState {
  provider: CloudProvider;
  /** The cloud account's name, only to show which one is linked. */
  accountLabel?: string;
  lastSyncAt?: string;
  /** Also sync original files (PDF, photos) on this device. */
  files?: boolean;
}

export interface AdminLink {
  serverUrl: string;
  /** Session token on the server, encrypted with the master key. */
  token: EncryptedBlob;
  contributions?: number;
  checkedAt?: string;
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
  /**
   * Tables this device knew at its last pull. An older version skips tables it does not
   * know yet but still moves `lastPulledSeq` on; missing ones here mean pulling from the start.
   */
  pulledTables?: string[];
  /** The server has this account's owner proof (older accounts send it on their next sync). */
  ownerProofSent?: boolean;
  /** Latest local `updatedAt` already sent. */
  lastPushedAt: string;
  lastSyncAt?: string;
  /** Also sync original files (PDF, photos) on this device. */
  files?: boolean;
}

export type AutoBackupErrorCode = 'permission_denied' | 'write_failed' | 'folder_missing';

/**
 * Automatic backup of one profile on this device: each device has its own folder, so
 * this never syncs. Kept here, in clear, because the folder handle cannot be encrypted.
 */
export interface AutoBackupConfig {
  profileId: string;
  dir: FileSystemDirectoryHandle;
  /** The browser gives only the folder's name, not its path. */
  dirName: string;
  every: AutoBackupEvery;
  keep: AutoBackupKeep;
  /** Always false for the guest, who has no password. */
  encrypted: boolean;
  lastRunAt?: string;
  lastError?: AutoBackupErrorCode;
}

export const DEFAULT_AUTO_BACKUP = { every: 'week', keep: 5, encrypted: true } as const;

export class ProfilesDb extends Dexie {
  profiles!: Table<Profile, string>;
  autoBackups!: Table<AutoBackupConfig, string>;

  constructor(name = 'faturometro-profiles') {
    super(name);
    this.version(1).stores({ profiles: 'id, &email' });
    // v2: automatic backups to a folder (one row per profile). New table only.
    this.version(2).stores({ profiles: 'id, &email', autoBackups: 'profileId' });
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
