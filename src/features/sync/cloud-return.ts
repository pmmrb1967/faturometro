/**
 * Coming back from a cloud sign-in page (a full-page redirect): the page that
 * sent the user there continues what it started. Microsoft comes back through
 * MSAL; Dropbox and Google to /nuvem-retorno, whose address is put back to the
 * page that left before the router reads it (src/app/cloud-return-start.ts).
 */
import { useEffect, useState } from 'react';
import { completeCloudSignIn, forgetSignIn, type CloudSignIn } from '../../cloud/cloud-drives';
import { dropAllFreshTokens } from '../../cloud/cloud-tokens';
import { takeOAuthReturn, type OAuthReturn } from '../../cloud/oauth';
import type { CloudProvider } from '../../db/profiles';

export type CloudIntent = 'enable' | 'migrate' | 'connect' | 'reconnect';

/** The page that left; when this tab lost it, the synced sign-in page (where any service can be tried again). */
export function returnAddress(oauth: OAuthReturn): string {
  return oauth.returnTo ?? '/entrar-sincronizado';
}

/** A sign-in came back to a tab that no longer knew about it. */
interface LostSignIn {
  lost: true;
}

let pending: Promise<CloudSignIn | LostSignIn | null> | null = null;
let taken = false;

/** On start, before the router: finishes a sign-in that just came back. */
export function startCloudReturn(): void {
  if (pending) return;
  // Sign-ins left in this tab (cancelled before the password) go before a new one is held.
  dropAllFreshTokens();
  let oauth: OAuthReturn | null = null;
  try {
    oauth = takeOAuthReturn(new URL(window.location.href));
  } catch {
    // No sessionStorage: not a return this tab can finish.
  }
  if (oauth) window.history.replaceState(null, '', returnAddress(oauth));
  pending =
    oauth && 'error' in oauth && !oauth.provider
      ? Promise.resolve({ lost: true })
      : completeCloudSignIn(oauth).catch(() => null);
}

/** The settings page started it (turn on, sign in again, move from the server): it opens its sync block. */
export function backToSettings(signIn: CloudSignIn | LostSignIn | null): boolean {
  return Boolean(signIn && !('lost' in signIn) && signIn.intent !== 'connect');
}

/** True once a sign-in the settings page started has come back (without taking it). */
export function useSignInBackToSettings(): boolean {
  const [back, setBack] = useState(false);
  useEffect(() => {
    let active = true;
    void pending?.then((signIn) => {
      if (active && backToSettings(signIn)) setBack(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return back;
}

export interface CloudReturn {
  provider: CloudProvider | null;
  /** The sign-in to use (MSAL account id, or the key of the tokens held for this tab). */
  accountId: string | null;
  /** The sign-in did not finish (refused, or the tab lost what it was doing: then no provider). */
  failed: boolean;
  /** Done with it (used or cancelled): the tokens held for this tab go too. */
  clear: () => void;
}

/** The sign-in that just came back for `intent`, once; `clear` when done with it. */
export function useCloudReturn(intent: CloudIntent): CloudReturn {
  const [result, setResult] = useState<CloudSignIn | LostSignIn | null>(null);
  useEffect(() => {
    let active = true;
    void pending?.then((signIn) => {
      if (!active || taken || !signIn) return;
      // A lost sign-in is told on the page it lands on (the synced sign-in page).
      if ('lost' in signIn ? intent !== 'connect' : signIn.intent !== intent) return;
      taken = true;
      setResult(signIn);
    });
    return () => {
      active = false;
    };
  }, [intent]);
  const signIn = result && !('lost' in result) ? result : null;
  return {
    provider: signIn?.provider ?? null,
    accountId: signIn && 'accountId' in signIn ? signIn.accountId : null,
    failed: Boolean(result && ('lost' in result || 'error' in result)),
    clear: () => {
      if (signIn && 'accountId' in signIn) forgetSignIn(signIn.provider, signIn.accountId);
      setResult(null);
    },
  };
}
