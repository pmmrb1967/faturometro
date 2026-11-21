/**
 * Coming back from the Microsoft sign-in page (a full-page redirect): the
 * page that sent the user there continues what it started.
 */
import { useEffect, useState } from 'react';
import { completeOneDriveSignIn } from '../../cloud/onedrive-auth';

export type OneDriveIntent = 'enable' | 'migrate' | 'connect' | 'reconnect';

let pending: Promise<{ intent: string; accountId: string } | null> | null = null;
let taken = false;

/** On start, before the first page: finishes a sign-in that just came back. */
export function startOneDriveReturn(): void {
  pending ??= completeOneDriveSignIn();
}

/** The Microsoft account just signed in for `intent`, once; `clear` when done with it. */
export function useOneDriveReturn(intent: OneDriveIntent): {
  accountId: string | null;
  clear: () => void;
} {
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void pending?.then((result) => {
      if (!active || taken || result?.intent !== intent) return;
      taken = true;
      setAccountId(result.accountId);
    });
    return () => {
      active = false;
    };
  }, [intent]);
  return { accountId, clear: () => setAccountId(null) };
}
