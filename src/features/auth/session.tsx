import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Profile } from '../../db/profiles';
import { createRepositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import type { UnlockedAccount } from './accounts';
import { SessionContext, type Session } from './session-context';

const AUTO_LOCK_MINUTES = 15;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/** Holds the unlocked master key in memory only; reloading the page locks the app. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const lock = useCallback(() => {
    setSession((current) => {
      current?.db.close();
      return null;
    });
  }, []);

  const signIn = useCallback((account: UnlockedAccount) => {
    const db = new ProfileDb(account.profile.id);
    setSession((current) => {
      if (current && current.db !== db) current.db.close();
      return {
        profile: account.profile,
        db,
        repos: createRepositories(db, account.masterKey),
        masterKey: account.masterKey,
      };
    });
  }, []);

  const updateProfile = useCallback((profile: Profile) => {
    setSession((current) =>
      current && current.profile.id === profile.id ? { ...current, profile } : current,
    );
  }, []);

  useAutoLock(session !== null, lock);

  const value = useMemo(
    () => ({ session, signIn, lock, updateProfile }),
    [session, signIn, lock, updateProfile],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useAutoLock(active: boolean, lock: () => void, minutes = AUTO_LOCK_MINUTES) {
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(lock, minutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, minutes * 60_000);
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [active, lock, minutes]);
}
