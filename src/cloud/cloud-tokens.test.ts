import { describe, expect, it } from 'vitest';
import { dropAllFreshTokens, freshTokens, holdFreshTokens, tokenSource } from './cloud-tokens';
import type { CloudError } from './drive';

class MemoryStorage {
  readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
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

const NOW = Date.parse('2026-11-21T10:00:00Z');

describe('fresh tokens after a sign-in', () => {
  it('are held for this tab only until the account takes them', () => {
    const storage = new MemoryStorage();
    const key = holdFreshTokens(
      { provider: 'dropbox', accessToken: 'a', refreshToken: 'r', expiresAt: NOW },
      storage,
    );
    expect(freshTokens(key, storage)).toEqual({
      provider: 'dropbox',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: NOW,
    });
    expect(freshTokens('outra', storage)).toBeNull();
  });
});

describe('tokenSource', () => {
  it('keeps the access token until a minute before it expires', async () => {
    let now = NOW;
    const refreshed: string[] = [];
    const getToken = tokenSource({
      refreshToken: async () => 'r1',
      refresh: async (refreshToken) => {
        refreshed.push(refreshToken);
        return { accessToken: `a${refreshed.length}`, expiresAt: now + 3_600_000 };
      },
      now: () => now,
    });
    expect(await getToken()).toBe('a1');
    now += 3_000_000;
    expect(await getToken()).toBe('a1');
    now += 560_000;
    expect(await getToken()).toBe('a2');
    expect(refreshed).toEqual(['r1', 'r1']);
  });

  it('renews when the service refused the token, and starts from a token in hand', async () => {
    let calls = 0;
    const getToken = tokenSource({
      refreshToken: async () => 'r1',
      initial: { accessToken: 'inicial', expiresAt: NOW + 3_600_000 },
      refresh: async () => ({ accessToken: `novo${++calls}`, expiresAt: NOW + 3_600_000 }),
      now: () => NOW,
    });
    expect(await getToken()).toBe('inicial');
    expect(await getToken(true)).toBe('novo1');
    expect(await getToken()).toBe('novo1');
  });

  it('asks to link again when there is no lasting link', async () => {
    const getToken = tokenSource({
      refreshToken: async () => undefined,
      refresh: async () => ({ accessToken: 'x', expiresAt: NOW }),
      now: () => NOW,
    });
    const error = await getToken().catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('needs_reconnect');
  });
});

describe('dropAllFreshTokens', () => {
  it('forgets every sign-in left in this tab, and nothing else', () => {
    const storage = new MemoryStorage();
    holdFreshTokens(
      { provider: 'gdrive', accessToken: 'a', refreshToken: 'r', expiresAt: NOW },
      storage,
    );
    holdFreshTokens(
      { provider: 'dropbox', accessToken: 'b', refreshToken: 's', expiresAt: NOW },
      storage,
    );
    storage.setItem('faturometro.cloud.oauth', 'pendente');
    dropAllFreshTokens(storage);
    expect([...storage.items.keys()]).toEqual(['faturometro.cloud.oauth']);
  });
});
