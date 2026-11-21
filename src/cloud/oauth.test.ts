import { describe, expect, it } from 'vitest';
import { CLOUD_RETURN_PATH, pkcePair, startOAuth, takeOAuthReturn } from './oauth';

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const ORIGIN = 'https://app.test';

async function started(storage: MemoryStorage) {
  let went = '';
  await startOAuth({
    provider: 'dropbox',
    intent: 'enable',
    returnTo: '/app/definicoes',
    origin: ORIGIN,
    storage,
    go: (url) => {
      went = url;
    },
    authorizeUrl: (challenge, state, redirectUri) =>
      `https://auth.test/?c=${challenge}&s=${state}&r=${encodeURIComponent(redirectUri)}`,
  });
  return new URL(went);
}

describe('PKCE', () => {
  it('makes a verifier of 43 to 128 characters and its S256 challenge', async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = Buffer.from(digest).toString('base64url');
    expect(challenge).toBe(expected);
  });
});

describe('sign-in by redirect', () => {
  it('goes to the sign-in page and comes back with the code, once', async () => {
    const storage = new MemoryStorage();
    const away = await started(storage);
    expect(away.searchParams.get('r')).toBe(`${ORIGIN}${CLOUD_RETURN_PATH}`);
    const state = away.searchParams.get('s') ?? '';
    const back = new URL(`${ORIGIN}${CLOUD_RETURN_PATH}?code=abc&state=${state}`);
    const result = takeOAuthReturn(back, storage);
    expect(result).toMatchObject({
      provider: 'dropbox',
      intent: 'enable',
      code: 'abc',
      returnTo: '/app/definicoes',
      redirectUri: `${ORIGIN}${CLOUD_RETURN_PATH}`,
    });
    expect(result && 'verifier' in result && result.verifier.length).toBeGreaterThan(42);
    expect(takeOAuthReturn(back, storage)).toEqual({ error: 'no_pending' });
  });

  it('refuses a return with another state', async () => {
    const storage = new MemoryStorage();
    await started(storage);
    const back = new URL(`${ORIGIN}${CLOUD_RETURN_PATH}?code=abc&state=outro`);
    expect(takeOAuthReturn(back, storage)).toMatchObject({ error: 'state' });
  });

  it('passes on a refusal or cancellation from the service', async () => {
    const storage = new MemoryStorage();
    const away = await started(storage);
    const state = away.searchParams.get('s') ?? '';
    const back = new URL(`${ORIGIN}${CLOUD_RETURN_PATH}?error=access_denied&state=${state}`);
    expect(takeOAuthReturn(back, storage)).toMatchObject({
      error: 'access_denied',
      returnTo: '/app/definicoes',
    });
  });

  it('ignores other pages', () => {
    expect(takeOAuthReturn(new URL(`${ORIGIN}/app`), new MemoryStorage())).toBeNull();
  });
});
