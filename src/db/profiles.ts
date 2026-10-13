import Dexie, { type Table } from 'dexie';
import type { EncryptedBlob, WrappedMasterKey } from '../lib/crypto';

/** One local account. Only the email (to pick the profile) and the wrapped key are in clear. */
export interface Profile {
  id: string;
  email: string;
  createdAt: string;
  wrappedKey: WrappedMasterKey;
  /** Present when this profile syncs with a server (device-local state). */
  sync?: ProfileSync;
}

export interface ProfileSync {
  serverUrl: string;
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
