/**
 * Coming back from a cloud sign-in page (a full-page redirect): the page that
 * sent the user there continues what it started. Microsoft comes back through
 * MSAL; Dropbox and Google to /nuvem-retorno, whose address is put back to the
 * page that left before the router reads it (src/app/cloud-return-start.ts).
 */
import { useEffect, useState } from 'react';
import { completeCloudSignIn, type CloudSignIn } from '../../cloud/cloud-drives';
import { takeOAuthReturn, type OAuthReturn } from '../../cloud/oauth';
import type { CloudProvider } from '../../db/profiles';

export type CloudIntent = 'enable' | 'migrate' | 'connect' | 'reconnect';

let pending: Promise<CloudSignIn | null> | null = null;
let taken = false;

/** On start, before the router: finishes a sign-in that just came back. */
export function startCloudReturn(): void {
  if (pending) return;
  let oauth: OAuthReturn | null = null;
  try {
    oauth = takeOAuthReturn(new URL(window.location.href));
  } catch {
    // No sessionStorage: not a return this tab can finish.
  }
  if (oauth) window.history.replaceState(null, '', oauth.returnTo ?? '/app/definicoes');
  pending = completeCloudSignIn(oauth).catch(() => null);
}

export interface CloudReturn {
  provider: CloudProvider | null;
  /** The sign-in to use (MSAL account id, or the key of the tokens held for this tab). */
  accountId: string | null;
  /** The sign-in did not finish (refused, or the tab lost what it was doing). */
  failed: boolean;
  clear: () => void;
}

/** The sign-in that just came back for `intent`, once; `clear` when done with it. */
export function useCloudReturn(intent: CloudIntent): CloudReturn {
  const [result, setResult] = useState<CloudSignIn | null>(null);
  useEffect(() => {
    let active = true;
    void pending?.then((signIn) => {
      if (!active || taken || signIn?.intent !== intent) return;
      taken = true;
      setResult(signIn);
    });
    return () => {
      active = false;
    };
  }, [intent]);
  return {
    provider: result?.provider ?? null,
    accountId: result && 'accountId' in result ? result.accountId : null,
    failed: Boolean(result && 'error' in result),
    clear: () => setResult(null),
  };
}
