import { useState } from 'react';
import { useNavigate } from 'react-router';
import { createGuest } from '../features/auth/accounts';
import { useSession } from '../features/auth/session-context';
import { createDemo, removeDemos } from './demo-account';

/** Entering the demonstration, leaving it, or leaving it for the user's own data. */
export function useDemo() {
  const { session, signIn, lock } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /** The open demonstration's data must be closed before it is deleted. */
  function closeOpenDemo() {
    if (session?.profile.demo) session.db.close();
  }

  async function enter() {
    setBusy(true);
    setFailed(false);
    try {
      closeOpenDemo();
      // Leaving this page reloads the document (web-analytics.ts): the session must be kept first.
      await signIn(await createDemo());
      navigate('/app');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    // Leaving first: without a session, a page of the app would send to sign in.
    navigate('/', { replace: true });
    closeOpenDemo();
    lock();
    await removeDemos();
  }

  /** The guest without an account (the existing one, if there is one), for real data. */
  async function startOwn() {
    setBusy(true);
    try {
      closeOpenDemo();
      await removeDemos();
      await signIn(await createGuest());
      navigate('/app');
    } finally {
      setBusy(false);
    }
  }

  return { enter, leave, startOwn, busy, failed };
}
