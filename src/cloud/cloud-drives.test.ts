import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../db/profiles';
import { encryptJson, generateMasterKey } from '../lib/crypto';
import { driveFor, signedInDrive } from './cloud-drives';
import { holdFreshTokens } from './cloud-tokens';
import type { CloudError } from './drive';
import { Dropbox } from './dropbox';
import { GoogleDrive } from './gdrive';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function profileWith(provider: 'dropbox' | 'gdrive', key: CryptoKey): Promise<Profile> {
  return {
    id: 'p1',
    email: 'a@b.pt',
    createdAt: '2026-11-21',
    cloud: {
      provider,
      deviceId: crypto.randomUUID(),
      nextSeq: 1,
      lastPushedAt: '',
      cursors: {},
      refreshToken: await encryptJson(key, `ligacao-${provider}-${crypto.randomUUID()}`),
    },
  };
}

const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('driveFor', () => {
  it('opens Dropbox with an access token renewed from the encrypted link', async () => {
    const key = await generateMasterKey();
    const profile = await profileWith('dropbox', key);
    const seen: { url: string; auth: string | null; body: string }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      seen.push({
        url,
        auth: new Headers(init.headers).get('Authorization'),
        body: String(init.body ?? ''),
      });
      if (url.endsWith('/oauth2/token'))
        return reply({ access_token: 'acesso', expires_in: 14400 });
      return reply({ entries: [], cursor: 'c', has_more: false });
    });
    const drive = driveFor(profile, key);
    expect(drive).toBeInstanceOf(Dropbox);
    expect(await drive.list('alteracoes')).toEqual([]);
    expect(seen[0]?.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(seen[0]?.body).toContain('grant_type=refresh_token');
    expect(seen[1]?.auth).toBe('Bearer acesso');
  });

  it('asks to link Google Drive again when the link was refused', async () => {
    const key = await generateMasterKey();
    const profile = await profileWith('gdrive', key);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/google/token')
        ? reply({ error: 'Sign in again' }, 401)
        : reply({ files: [] }),
    );
    const drive = driveFor(profile, key);
    expect(drive).toBeInstanceOf(GoogleDrive);
    const error = await drive.list('alteracoes').catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('needs_reconnect');
  });

  it('asks to link again a profile with no link', async () => {
    const key = await generateMasterKey();
    const profile = await profileWith('dropbox', key);
    if (profile.cloud) delete profile.cloud.refreshToken;
    const error = await driveFor(profile, key)
      .list('alteracoes')
      .catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('needs_reconnect');
  });
});

describe('signedInDrive', () => {
  it('uses the tokens of the sign-in that just came back', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
    vi.stubGlobal('window', { sessionStorage: globalThis.sessionStorage });
    const key = holdFreshTokens({
      provider: 'dropbox',
      accessToken: 'acabado-de-chegar',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
    });
    const auth: (string | null)[] = [];
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      auth.push(new Headers(init.headers).get('Authorization'));
      return reply({ entries: [], cursor: 'c', has_more: false });
    });
    await signedInDrive('dropbox', key).list('alteracoes');
    expect(auth).toEqual(['Bearer acabado-de-chegar']);
  });
});
