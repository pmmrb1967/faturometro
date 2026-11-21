/**
 * Access to Dropbox and Google Drive: a lasting link (refresh token) and short
 * access tokens. The lasting link is kept encrypted with the master key in the
 * profile (ProfileCloud.refreshToken); right after a sign-in, before the
 * password is typed, it waits in this tab's sessionStorage only. Access tokens
 * live in memory.
 */
import type { CloudProvider } from '../db/profiles';
import { CloudError } from './drive';
import type { AccessToken, FreshTokens } from './dropbox-auth';
import type { TokenGetter } from './dropbox';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const FRESH_PREFIX = 'faturometro.cloud.fresh.';
/** Renew this long before the access token expires. */
const MARGIN_MS = 60_000;

export interface HeldTokens extends FreshTokens {
  provider: CloudProvider;
}

function session(storage?: KeyValueStorage): KeyValueStorage | null {
  if (storage) return storage;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the tokens of a sign-in until the account takes them; the key to find them. */
export function holdFreshTokens(tokens: HeldTokens, storage?: KeyValueStorage): string {
  const key = crypto.randomUUID();
  session(storage)?.setItem(`${FRESH_PREFIX}${key}`, JSON.stringify(tokens));
  return key;
}

export function freshTokens(key: string, storage?: KeyValueStorage): HeldTokens | null {
  try {
    const text = session(storage)?.getItem(`${FRESH_PREFIX}${key}`);
    const value: unknown = text ? JSON.parse(text) : null;
    if (!value || typeof value !== 'object') return null;
    const held = value as Partial<HeldTokens>;
    if (
      typeof held.provider !== 'string' ||
      typeof held.accessToken !== 'string' ||
      typeof held.refreshToken !== 'string' ||
      typeof held.expiresAt !== 'number'
    ) {
      return null;
    }
    return held as HeldTokens;
  } catch {
    return null;
  }
}

/** Once the account has the link (encrypted), the copy in this tab goes. */
export function dropFreshTokens(key: string, storage?: KeyValueStorage): void {
  try {
    session(storage)?.removeItem(`${FRESH_PREFIX}${key}`);
  } catch {
    // Gone with the tab anyway.
  }
}

/** On start: sign-ins left in this tab (cancelled, abandoned) are forgotten. */
export function dropAllFreshTokens(
  storage?: KeyValueStorage & Pick<Storage, 'key' | 'length'>,
): void {
  try {
    const store = storage ?? window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(FRESH_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // No sessionStorage: nothing was held.
  }
}

/** Access tokens already obtained, by lasting link: shared by every drive of this tab. */
const cache = new Map<string, AccessToken>();

/**
 * Access tokens for one lasting link: kept until a minute before they expire, renewed
 * when asked (`renew`, after the service refused one). `needs_reconnect` without a link.
 */
export function tokenSource(input: {
  refreshToken: () => Promise<string | undefined>;
  refresh: (refreshToken: string) => Promise<AccessToken>;
  initial?: AccessToken;
  now?: () => number;
}): TokenGetter {
  const now = input.now ?? (() => Date.now());
  let own = input.initial;
  return async (renew = false) => {
    const refreshToken = await input.refreshToken();
    if (!refreshToken) throw new CloudError('needs_reconnect');
    const current = own ?? cache.get(refreshToken);
    if (!renew && current && current.expiresAt - MARGIN_MS > now()) return current.accessToken;
    const fresh = await input.refresh(refreshToken);
    own = fresh;
    cache.set(refreshToken, fresh);
    return fresh.accessToken;
  };
}
