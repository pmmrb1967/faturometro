import Dexie, { type Table } from 'dexie';
import type { WrappedMasterKey } from '../lib/crypto';

/** One local account. Only the email (to pick the profile) and the wrapped key are in clear. */
export interface Profile {
  id: string;
  email: string;
  createdAt: string;
  wrappedKey: WrappedMasterKey;
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
