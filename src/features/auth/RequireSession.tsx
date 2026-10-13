import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from './session-context';

/** Sends to /entrar when the app is locked, and back to the same page after signing in. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }
  return children;
}
