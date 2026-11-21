/**
 * Microsoft sign-in for OneDrive, in the browser only (MSAL): the tokens stay
 * in this browser's storage and go only to Microsoft. Sign-in by full-page
 * redirect, not a popup: the app's Cross-Origin-Opener-Policy cuts the link
 * to a popup. The library loads only when OneDrive is used.
 */
import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { CloudError } from './drive';
import { PROJECT_ONEDRIVE_CLIENT_ID } from './onedrive-config';

const AUTHORITY = 'https://login.microsoftonline.com/common';
/** Only the app's own folder; `offline_access` keeps the link without signing in each time. */
const SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access'];
/** Same path as AUTH_REDIRECT_PATH in security-headers.ts. */
const REDIRECT_PATH = '/auth-redirect.html';
/** Set before leaving for the sign-in page: what to continue when back. */
const PENDING_KEY = 'faturometro.onedrive.intent';

function clientId(): string {
  const fromBuild: unknown = import.meta.env.VITE_ONEDRIVE_CLIENT_ID;
  return typeof fromBuild === 'string' && fromBuild ? fromBuild : PROJECT_ONEDRIVE_CLIENT_ID;
}

/** OneDrive is offered only when the app has an id with Microsoft. */
export function oneDriveAvailable(): boolean {
  return clientId() !== '';
}

let app: Promise<IPublicClientApplication> | null = null;

function msal(): Promise<IPublicClientApplication> {
  app ??= import('@azure/msal-browser').then(({ createStandardPublicClientApplication }) =>
    createStandardPublicClientApplication({
      auth: {
        clientId: clientId(),
        authority: AUTHORITY,
        redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
      },
      cache: { cacheLocation: 'localStorage' },
    }),
  );
  return app;
}

function readPending(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

/** Leaves for the Microsoft sign-in page; comes back to this page to continue `intent`. */
export async function signInToOneDrive(intent: string): Promise<void> {
  try {
    window.sessionStorage.setItem(PENDING_KEY, intent);
  } catch {
    // Without sessionStorage the app still comes back, only without continuing.
  }
  const client = await msal();
  await client.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

/**
 * On start: finishes a sign-in that just came back. Null when there was none,
 * or it was cancelled or failed.
 */
export async function completeOneDriveSignIn(): Promise<{
  intent: string;
  accountId: string;
} | null> {
  const intent = readPending();
  if (intent === null) return null;
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Read once only.
  }
  try {
    const client = await msal();
    const result = await client.handleRedirectPromise();
    if (!result?.account) return null;
    client.setActiveAccount(result.account);
    return { intent, accountId: result.account.homeAccountId };
  } catch {
    return null;
  }
}

function accountFor(client: IPublicClientApplication, accountId?: string): AccountInfo | null {
  if (accountId) return client.getAccount({ homeAccountId: accountId });
  return client.getActiveAccount() ?? client.getAllAccounts()[0] ?? null;
}

/** A token for Graph, renewed in the background; `needs_reconnect` when the user must sign in again. */
export async function oneDriveToken(accountId?: string): Promise<string> {
  const client = await msal();
  const account = accountFor(client, accountId);
  if (!account) throw new CloudError('needs_reconnect');
  try {
    return (await client.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    if (code === 'no_network_connectivity') throw new CloudError('offline');
    throw new CloudError('needs_reconnect');
  }
}

/** Forgets the Microsoft sign-in in this browser (the files in OneDrive stay). */
export async function signOutOfOneDrive(accountId?: string): Promise<void> {
  const client = await msal();
  const account = accountFor(client, accountId);
  await client.clearCache(account ? { account } : undefined);
}
