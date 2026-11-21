import { describe, expect, it } from 'vitest';
import { CloudError } from './drive';
import { Dropbox } from './dropbox';
import { dropboxAuthorizeUrl, exchangeDropboxCode, refreshDropbox } from './dropbox-auth';
import { fakeFetch, json, type Reply } from './fake-fetch';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

const failure = (summary: string, code = 409, headers: Record<string, string> = {}) =>
  json({ error_summary: summary, error: {} }, code, headers);

function drive(replies: Reply[], renewals: boolean[] = []) {
  const fetch = fakeFetch(replies);
  const slept: number[] = [];
  let token = 0;
  const dropbox = new Dropbox(
    async (renew) => {
      renewals.push(Boolean(renew));
      if (renew) token++;
      return `token-${token}`;
    },
    {
      fetch: fetch.impl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    },
  );
  return { dropbox, calls: fetch.calls, slept };
}

const arg = (headers: Record<string, string> | undefined) =>
  JSON.parse(headers?.['dropbox-api-arg'] ?? '{}') as Record<string, unknown>;

describe('Dropbox', () => {
  it('reads a file with its revision as the etag', async () => {
    const { dropbox, calls } = drive([
      () =>
        new Response('olá', {
          headers: { 'Dropbox-API-Result': JSON.stringify({ rev: '015a', name: 'conta.json' }) },
        }),
    ]);
    const file = await dropbox.read('conta.json');
    expect(new TextDecoder().decode(file?.bytes)).toBe('olá');
    expect(file?.etag).toBe('015a');
    expect(calls[0]?.url).toBe(`${CONTENT}/files/download`);
    expect(calls[0]?.headers.authorization).toBe('Bearer token-0');
    expect(arg(calls[0]?.headers)).toEqual({ path: '/conta.json' });
  });

  it('has no file that is not there', async () => {
    const { dropbox } = drive([failure('path/not_found/..')]);
    expect(await dropbox.read('alteracoes/x.json')).toBeNull();
  });

  it('writes, overwrites only a revision, or creates only when absent', async () => {
    const { dropbox, calls } = drive([
      json({ rev: 'r1' }),
      json({ rev: 'r2' }),
      json({ rev: 'r3' }),
    ]);
    expect(await dropbox.write('a/b.json', new Uint8Array([1]))).toEqual({ etag: 'r1' });
    await dropbox.write('a/b.json', new Uint8Array([2]), { ifMatch: 'r1' });
    await dropbox.write('conta.json', new Uint8Array([3]), { ifNoneMatch: '*' });
    expect(calls[0]?.url).toBe(`${CONTENT}/files/upload`);
    expect(calls[0]?.headers['content-type']).toBe('application/octet-stream');
    expect(arg(calls[0]?.headers)).toMatchObject({
      path: '/a/b.json',
      mode: 'overwrite',
      autorename: false,
      mute: true,
    });
    expect(arg(calls[1]?.headers)).toMatchObject({
      mode: { '.tag': 'update', update: 'r1' },
      strict_conflict: true,
    });
    expect(arg(calls[2]?.headers)).toMatchObject({ mode: 'add' });
  });

  it('turns a conflict, a full Dropbox and a long slow-down into the drive errors', async () => {
    const cases: [Reply, string][] = [
      [failure('path/conflict/file/..'), 'conflict'],
      [failure('path/insufficient_space/..'), 'quota_full'],
      [failure('too_many_requests/', 429, { 'Retry-After': '300' }), 'throttled'],
    ];
    for (const [reply, code] of cases) {
      const { dropbox } = drive([reply]);
      const error = await dropbox.write('a.json', new Uint8Array([1])).catch((e: unknown) => e);
      expect((error as CloudError).code).toBe(code);
    }
  });

  it('waits once when asked to slow down briefly', async () => {
    const { dropbox, slept } = drive([
      failure('too_many_write_operations/', 429, { 'Retry-After': '2' }),
      json({ rev: 'r1' }),
    ]);
    expect(await dropbox.write('a.json', new Uint8Array([1]))).toEqual({ etag: 'r1' });
    expect(slept).toEqual([2000]);
  });

  it('renews an expired token once, then asks to link again', async () => {
    const renewals: boolean[] = [];
    const { dropbox, calls } = drive(
      [failure('expired_access_token/', 401), json({ rev: 'r1' })],
      renewals,
    );
    await dropbox.write('a.json', new Uint8Array([1]));
    expect(calls[1]?.headers.authorization).toBe('Bearer token-1');
    expect(renewals).toEqual([false, true]);

    const again = drive([
      failure('invalid_access_token/', 401),
      failure('invalid_access_token/', 401),
    ]);
    const error = await again.dropbox.read('a.json').catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('needs_reconnect');
  });

  it('is offline when the request does not get through', async () => {
    const { dropbox } = drive([
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    const error = await dropbox.read('a.json').catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('offline');
  });

  it('lists the files of a folder across pages, and none for a missing folder', async () => {
    const { dropbox, calls } = drive([
      json({
        entries: [
          { '.tag': 'file', name: 'a.json', size: 3, rev: 'ra' },
          { '.tag': 'folder', name: 'sub' },
        ],
        cursor: 'c1',
        has_more: true,
      }),
      json({
        entries: [{ '.tag': 'file', name: 'b.json', size: 4, rev: 'rb' }],
        cursor: 'c2',
        has_more: false,
      }),
      failure('path/not_found/'),
    ]);
    expect(await dropbox.list('alteracoes')).toEqual([
      { name: 'a.json', size: 3, etag: 'ra' },
      { name: 'b.json', size: 4, etag: 'rb' },
    ]);
    expect(calls[0]?.url).toBe(`${API}/files/list_folder`);
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ path: '/alteracoes' });
    expect(calls[1]?.url).toBe(`${API}/files/list_folder/continue`);
    expect(JSON.parse(String(calls[1]?.body))).toEqual({ cursor: 'c1' });
    expect(await dropbox.list('copias')).toEqual([]);
  });

  it('removes a file, also when it is already gone', async () => {
    const { dropbox, calls } = drive([json({ metadata: {} }), failure('path_lookup/not_found/')]);
    await dropbox.remove('copias/a.zip');
    await dropbox.remove('copias/a.zip');
    expect(calls[0]?.url).toBe(`${API}/files/delete_v2`);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ path: '/copias/a.zip' });
  });

  it('names the account by its email', async () => {
    const { dropbox, calls } = drive([json({ email: 'ana@exemplo.pt', name: {} })]);
    expect(await dropbox.account()).toEqual({ label: 'ana@exemplo.pt' });
    expect(calls[0]?.url).toBe(`${API}/users/get_current_account`);
  });
});

describe('Dropbox sign-in', () => {
  it('asks for a code with PKCE and a lasting link', () => {
    const url = new URL(
      dropboxAuthorizeUrl('chave', 'desafio', 'estado', 'https://app.test/nuvem-retorno'),
    );
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'chave',
      response_type: 'code',
      code_challenge: 'desafio',
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      redirect_uri: 'https://app.test/nuvem-retorno',
      state: 'estado',
    });
  });

  it('exchanges the code without a secret, and renews', async () => {
    const fetch = fakeFetch([
      json({ access_token: 'a1', expires_in: 14400, refresh_token: 'r1', token_type: 'bearer' }),
      json({ access_token: 'a2', expires_in: 14400, token_type: 'bearer' }),
      json({ error: 'invalid_grant' }, 400),
    ]);
    const now = Date.parse('2026-11-21T10:00:00Z');
    const tokens = await exchangeDropboxCode({
      appKey: 'chave',
      code: 'c',
      verifier: 'v',
      redirectUri: 'https://app.test/nuvem-retorno',
      fetch: fetch.impl,
      now,
    });
    expect(tokens).toEqual({ accessToken: 'a1', refreshToken: 'r1', expiresAt: now + 14_400_000 });
    expect(fetch.calls[0]?.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(Object.fromEntries(new URLSearchParams(String(fetch.calls[0]?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'c',
      code_verifier: 'v',
      client_id: 'chave',
      redirect_uri: 'https://app.test/nuvem-retorno',
    });
    expect(
      await refreshDropbox({ appKey: 'chave', refreshToken: 'r1', fetch: fetch.impl, now }),
    ).toEqual({ accessToken: 'a2', expiresAt: now + 14_400_000 });
    const error = await refreshDropbox({
      appKey: 'chave',
      refreshToken: 'r1',
      fetch: fetch.impl,
    }).catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('needs_reconnect');
  });
});
