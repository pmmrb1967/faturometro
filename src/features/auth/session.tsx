import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setSignedIn } from '../../app/pwa';
import { isGuest, type Profile } from '../../db/profiles';
import { createRepositories } from '../../db/repositories';
import { ProfileDb } from '../../db/schema';
import type { UnlockedAccount } from './accounts';
import { SessionContext, type Session } from './session-context';
import {
  forgetSession,
  rememberSession,
  restoreSession,
  SESSION_IDLE_MINUTES,
  touchSession,
} from './session-store';

const AUTO_LOCK_MINUTES = SESSION_IDLE_MINUTES;
/** How often activity is written down for a reload to find (not on every key press). */
const TOUCH_EVERY_MS = 60_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Holds the unlocked master key in memory; a reload of the same tab reopens
 * the session within the idle period (session-store.ts).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  const lock = useCallback(() => {
    void forgetSession();
    setSession((current) => {
      current?.db.close();
      return null;
    });
  }, []);

  const open = useCallback((account: UnlockedAccount) => {
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

  const signIn = useCallback(
    (account: UnlockedAccount) => {
      open(account);
      // The guest has no password: it opens by itself, nothing to remember.
      if (!isGuest(account.profile)) void rememberSession(account);
    },
    [open],
  );

  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((account) => {
        if (active && account) open(account);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const updateProfile = useCallback((profile: Profile) => {
    setSession((current) =>
      current && current.profile.id === profile.id ? { ...current, profile } : current,
    );
  }, []);

  // The guest has no password, so there is nothing to unlock.
  useAutoLock(session !== null && !isGuest(session.profile), lock);
  // Signed out, a new version of the app can be applied at once.
  useEffect(() => setSignedIn(session !== null), [session]);

  const value = useMemo(
    () => ({ session, restoring, signIn, lock, updateProfile }),
    [session, restoring, signIn, lock, updateProfile],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useAutoLock(active: boolean, lock: () => void, minutes = AUTO_LOCK_MINUTES) {
  useEffect(() => {
    if (!active) return;
    let timer = window.setTimeout(lock, minutes * 60_000);
    let touched = Date.now();
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, minutes * 60_000);
      if (Date.now() - touched >= TOUCH_EVERY_MS) {
        touched = Date.now();
        void touchSession();
      }
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [active, lock, minutes]);
}
