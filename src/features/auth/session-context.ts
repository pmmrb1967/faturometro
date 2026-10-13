import { createContext, useContext } from 'react';
import type { Profile } from '../../db/profiles';
import type { Repositories } from '../../db/repositories';
import type { ProfileDb } from '../../db/schema';
import type { UnlockedAccount } from './accounts';

export interface Session {
  profile: Profile;
  db: ProfileDb;
  repos: Repositories;
}

export interface SessionContextValue {
  session: Session | null;
  signIn: (account: UnlockedAccount) => void;
  lock: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
