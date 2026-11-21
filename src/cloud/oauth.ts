/**
 * Sign-in to Dropbox and Google by full-page redirect with PKCE (the app's
 * Cross-Origin-Opener-Policy cuts the link to a popup). Before leaving, what to
 * continue is kept in sessionStorage; the service sends the user back to
 * CLOUD_RETURN_PATH, where the app reads it once and returns to the page that started.
 */
import type { CloudProvider } from '../db/profiles';

export const CLOUD_RETURN_PATH = '/nuvem-retorno';
const PENDING_KEY = 'faturometro.cloud.oauth';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface Pending {
  provider: CloudProvider;
  intent: string;
  verifier: string;
  state: string;
  returnTo: string;
  redirectUri: string;
}

export type OAuthReturn =
  | (Omit<Pending, 'state'> & { code: string })
  | { error: string; provider?: CloudProvider; intent?: string; returnTo?: string };

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomText = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  // 64 random bytes: an 86-character verifier.
  const verifier = randomText(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function cloudRedirectUri(origin: string = window.location.origin): string {
  return `${origin}${CLOUD_RETURN_PATH}`;
}

export async function startOAuth(input: {
  provider: CloudProvider;
  intent: string;
  authorizeUrl: (challenge: string, state: string, redirectUri: string) => string;
  returnTo?: string;
  origin?: string;
  storage?: KeyValueStorage;
  go?: (url: string) => void;
}): Promise<void> {
  const { verifier, challenge } = await pkcePair();
  const state = randomText(24);
  const redirectUri = cloudRedirectUri(input.origin);
  const pending: Pending = {
    provider: input.provider,
    intent: input.intent,
    verifier,
    state,
    redirectUri,
    returnTo: input.returnTo ?? `${window.location.pathname}${window.location.search}`,
  };
  (input.storage ?? window.sessionStorage).setItem(PENDING_KEY, JSON.stringify(pending));
  const url = input.authorizeUrl(challenge, state, redirectUri);
  (input.go ?? ((target: string) => window.location.assign(target)))(url);
}

function readPending(storage: KeyValueStorage): Pending | null {
  try {
    const text = storage.getItem(PENDING_KEY);
    storage.removeItem(PENDING_KEY);
    const value: unknown = text ? JSON.parse(text) : null;
    if (!value || typeof value !== 'object') return null;
    const pending = value as Partial<Pending>;
    if (
      typeof pending.provider !== 'string' ||
      typeof pending.intent !== 'string' ||
      typeof pending.verifier !== 'string' ||
      typeof pending.state !== 'string' ||
      typeof pending.returnTo !== 'string' ||
      typeof pending.redirectUri !== 'string'
    ) {
      return null;
    }
    return pending as Pending;
  } catch {
    return null;
  }
}

/** On the return page: the code (once), the service's refusal, or null on any other page. */
export function takeOAuthReturn(
  url: URL,
  storage: KeyValueStorage = window.sessionStorage,
): OAuthReturn | null {
  if (url.pathname !== CLOUD_RETURN_PATH) return null;
  const pending = readPending(storage);
  if (!pending) return { error: 'no_pending' };
  const context = {
    provider: pending.provider,
    intent: pending.intent,
    returnTo: pending.returnTo,
  };
  if (url.searchParams.get('state') !== pending.state) return { error: 'state', ...context };
  const refused = url.searchParams.get('error');
  if (refused) return { error: refused, ...context };
  const code = url.searchParams.get('code');
  if (!code) return { error: 'no_code', ...context };
  return {
    provider: pending.provider,
    intent: pending.intent,
    verifier: pending.verifier,
    returnTo: pending.returnTo,
    redirectUri: pending.redirectUri,
    code,
  };
}
