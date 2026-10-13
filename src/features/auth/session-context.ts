import { createContext, useContext } from 'react';
import type { Profile } from '../../db/profiles';
import type { Repositories } from '../../db/repositories';
import type { ProfileDb } from '../../db/schema';
import type { UnlockedAccount } from './accounts';

export interface Session {
  profile: Profile;
  db: ProfileDb;
  repos: Repositories;
  /** In memory only (needed to encrypt the sync token). */
  masterKey: CryptoKey;
}

export interface SessionContextValue {
  session: Session | null;
  signIn: (account: UnlockedAccount) => void;
  lock: () => void;
  /** Keeps the session in step with a saved profile (sync state). */
  updateProfile: (profile: Profile) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
