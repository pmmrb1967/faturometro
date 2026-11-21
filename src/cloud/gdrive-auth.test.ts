import { describe, expect, it } from 'vitest';
import type { CloudError } from './drive';
import { fakeFetch, json } from './fake-fetch';
import { exchangeGoogleCode, googleAuthorizeUrl, refreshGoogle } from './gdrive-auth';

const SERVER = 'https://sync.test';
const REDIRECT = 'https://app.test/nuvem-retorno';

describe('Google sign-in', () => {
  it('asks only for the app’s own files, with PKCE and a lasting link', () => {
    const url = new URL(googleAuthorizeUrl('id', 'desafio', 'estado', REDIRECT));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'id',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: 'desafio',
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT,
      state: 'estado',
    });
  });

  it('exchanges the code and renews through the sync server', async () => {
    const fetch = fakeFetch([
      json({ accessToken: 'a1', expiresIn: 3599, refreshToken: 'r1' }),
      json({ accessToken: 'a2', expiresIn: 3599 }),
      json({ error: 'Sign in again' }, 401),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    const now = Date.parse('2026-11-21T10:00:00Z');
    expect(
      await exchangeGoogleCode({
        serverUrl: SERVER,
        code: 'c',
        verifier: 'v',
        redirectUri: REDIRECT,
        fetch: fetch.impl,
        now,
      }),
    ).toEqual({ accessToken: 'a1', refreshToken: 'r1', expiresAt: now + 3_599_000 });
    expect(fetch.calls[0]?.url).toBe(`${SERVER}/v1/google/token`);
    expect(JSON.parse(String(fetch.calls[0]?.body))).toEqual({
      grant: 'code',
      code: 'c',
      codeVerifier: 'v',
      redirectUri: REDIRECT,
    });
    expect(
      await refreshGoogle({ serverUrl: SERVER, refreshToken: 'r1', fetch: fetch.impl, now }),
    ).toEqual({ accessToken: 'a2', expiresAt: now + 3_599_000 });
    const expired = await refreshGoogle({
      serverUrl: SERVER,
      refreshToken: 'r1',
      fetch: fetch.impl,
    }).catch((e: unknown) => e);
    expect((expired as CloudError).code).toBe('needs_reconnect');
    const offline = await refreshGoogle({
      serverUrl: SERVER,
      refreshToken: 'r1',
      fetch: fetch.impl,
    }).catch((e: unknown) => e);
    expect((offline as CloudError).code).toBe('offline');
  });
});
