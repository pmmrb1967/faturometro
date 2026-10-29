import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { listAccountEmails, openGuest } from './accounts';
import { entryFor, signInRoute } from './entry';
import { useSession } from './session-context';

/**
 * Without a session, opens the guest when it is the only profile here; otherwise sends to
 * sign in (signInRoute), and back to the same page afterwards.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, restoring, signIn } = useSession();
  const location = useLocation();
  const [entry, setEntry] = useState<'checking' | 'guest' | 'login'>('checking');

  useEffect(() => {
    if (session || restoring) return;
    let active = true;
    void (async () => {
      const [guest, emails] = await Promise.all([openGuest(), listAccountEmails()]);
      if (!active) return;
      const next = entryFor({ hasGuest: guest !== null, accounts: emails.length });
      if (next === 'guest' && guest) signIn(guest);
      setEntry(next);
    })();
    return () => {
      active = false;
    };
  }, [session, restoring, signIn]);

  if (session) return children;
  if (entry === 'login') {
    return (
      <Navigate to={signInRoute(location.pathname)} replace state={{ from: location.pathname }} />
    );
  }
  return null;
}
