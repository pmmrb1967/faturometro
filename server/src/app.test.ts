import { beforeEach, describe, expect, it } from 'vitest';
import { memorySql } from '../test/sqlite';
import { createApp, MAX_FAILED_LOGINS } from './app';

const ORIGIN = 'https://app.example';
const AUTH = 'a'.repeat(64);
const WRAPPED = {
  byPassword: { iv: 'aXY=', data: 'ZGF0YQ==' },
  byRecoveryKey: { iv: 'aXY=', data: 'cmVj' },
  recoverySalt: 'c2FsdA==',
};

let handle: ReturnType<typeof createApp>;
let db: ReturnType<typeof memorySql>['db'];
let clock = new Date('2026-10-13T12:00:00Z');

beforeEach(() => {
  const memory = memorySql();
  db = memory.db;
  clock = new Date('2026-10-13T12:00:00Z');
  handle = createApp({
    sql: memory.sql,
    preloginSecret: 'secret',
    allowedOrigins: [ORIGIN],
    now: () => clock,
  });
});

async function call(method: string, path: string, body?: unknown, token?: string, origin = ORIGIN) {
  const headers: Record<string, string> = { Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await handle(
    new Request(`https://sync.example${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    response,
  };
}

async function register(email = 'ana@example.pt') {
  const result = await call('POST', '/v1/register', {
    email,
    salt: 'c2FsdHNhbHQ=',
    iterations: 600_000,
    authKey: AUTH,
    wrappedKey: WRAPPED,
  });
  return result.body?.token as string;
}

function record(id: string, updatedAt: string, data = 'Y2lwaGVy') {
  return { id, table: 'invoices', updatedAt, enc: { iv: 'aXY=', data } };
}

describe('accounts', () => {
  it('registers, then logs in with the same auth key and gets the wrapped key back', async () => {
    expect(await register()).toMatch(/^[\w-]{40,}$/);
    const login = await call('POST', '/v1/login', { email: 'ANA@example.pt', authKey: AUTH });
    expect(login.status).toBe(200);
    expect(login.body?.wrappedKey).toEqual(WRAPPED);
  });

  it('refuses a second account with the same email', async () => {
    await register();
    const again = await call('POST', '/v1/register', {
      email: 'ana@example.pt',
      salt: 'c2FsdA==',
      iterations: 600_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    });
    expect(again.status).toBe(409);
  });

  it('prelogin returns the real salt, and a stable fake one for unknown emails', async () => {
    await register();
    expect((await call('POST', '/v1/prelogin', { email: 'ana@example.pt' })).body).toEqual({
      salt: 'c2FsdHNhbHQ=',
      iterations: 600_000,
    });
    const unknown1 = await call('POST', '/v1/prelogin', { email: 'rui@example.pt' });
    const unknown2 = await call('POST', '/v1/prelogin', { email: 'rui@example.pt' });
    expect(unknown1.body?.salt).toBe(unknown2.body?.salt);
    expect(unknown1.body?.iterations).toBe(600_000);
  });

  it('gives the same answer for unknown emails and wrong keys', async () => {
    await register();
    const wrong = await call('POST', '/v1/login', {
      email: 'ana@example.pt',
      authKey: 'b'.repeat(64),
    });
    const unknown = await call('POST', '/v1/login', { email: 'rui@example.pt', authKey: AUTH });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('locks an account after repeated failures, for a while', async () => {
    await register();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: 'b'.repeat(64) });
    }
    expect(
      (await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: AUTH })).status,
    ).toBe(429);
    clock = new Date('2026-10-13T12:30:00Z');
    expect(
      (await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: AUTH })).status,
    ).toBe(200);
  });

  it('stores only a hash of the auth key', async () => {
    await register();
    const row = db.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(AUTH);
  });
});

describe('sync', () => {
  it('requires a valid token', async () => {
    expect((await call('GET', '/v1/changes?since=0')).status).toBe(401);
    expect((await call('GET', '/v1/changes?since=0', undefined, 'nope')).status).toBe(401);
  });

  it('pushes and pulls incrementally', async () => {
    const token = await register();
    const push = await call(
      'POST',
      '/v1/changes',
      { records: [record('r1', '2026-10-13T10:00:00Z'), record('r2', '2026-10-13T10:00:01Z')] },
      token,
    );
    expect(push.body).toEqual({ latest: 2 });

    const all = await call('GET', '/v1/changes?since=0', undefined, token);
    expect((all.body?.records as unknown[]).length).toBe(2);
    expect(all.body?.latest).toBe(2);

    await call(
      'POST',
      '/v1/changes',
      { records: [record('r1', '2026-10-13T11:00:00Z', 'bmV3')] },
      token,
    );
    const since = await call('GET', '/v1/changes?since=2', undefined, token);
    expect(since.body?.records).toEqual([
      { ...record('r1', '2026-10-13T11:00:00Z', 'bmV3'), seq: 3 },
    ]);
  });

  it('keeps the latest write and ignores older or repeated ones', async () => {
    const token = await register();
    await call(
      'POST',
      '/v1/changes',
      { records: [record('r1', '2026-10-13T11:00:00Z', 'bmV3')] },
      token,
    );
    const stale = await call(
      'POST',
      '/v1/changes',
      { records: [record('r1', '2026-10-13T10:00:00Z', 'b2xk')] },
      token,
    );
    const repeat = await call(
      'POST',
      '/v1/changes',
      { records: [record('r1', '2026-10-13T11:00:00Z', 'bmV3')] },
      token,
    );
    expect(stale.body).toEqual({ latest: 1 });
    expect(repeat.body).toEqual({ latest: 1 });
  });

  it('syncs deletions (tombstones)', async () => {
    const token = await register();
    await call(
      'POST',
      '/v1/changes',
      { records: [{ ...record('r1', '2026-10-13T11:00:00Z'), deletedAt: '2026-10-13T11:00:00Z' }] },
      token,
    );
    const pulled = await call('GET', '/v1/changes?since=0', undefined, token);
    expect((pulled.body?.records as { deletedAt?: string }[])[0]?.deletedAt).toBe(
      '2026-10-13T11:00:00Z',
    );
  });

  it('keeps accounts apart', async () => {
    const ana = await register('ana@example.pt');
    const rui = await register('rui@example.pt');
    await call('POST', '/v1/changes', { records: [record('r1', '2026-10-13T11:00:00Z')] }, ana);
    expect((await call('GET', '/v1/changes?since=0', undefined, rui)).body?.records).toEqual([]);
  });

  it('rejects malformed records', async () => {
    const token = await register();
    const bad = await call(
      'POST',
      '/v1/changes',
      { records: [{ id: 'r1', table: 'x;drop', updatedAt: 'x', enc: { iv: '!', data: '!' } }] },
      token,
    );
    expect(bad.status).toBe(400);
  });
});

describe('keys and account', () => {
  it('changing the password signs out the other devices', async () => {
    const first = await register();
    const second = (await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: AUTH }))
      .body?.token as string;
    const changed = await call(
      'PUT',
      '/v1/keys',
      { authKey: 'c'.repeat(64), salt: 'bmV3c2FsdA==', iterations: 600_000, wrappedKey: WRAPPED },
      first,
    );
    expect(changed.status).toBe(200);
    expect((await call('GET', '/v1/changes?since=0', undefined, second)).status).toBe(401);
    expect(
      (await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: 'c'.repeat(64) }))
        .status,
    ).toBe(200);
  });

  it('deletes the account and every record', async () => {
    const token = await register();
    await call('POST', '/v1/changes', { records: [record('r1', '2026-10-13T11:00:00Z')] }, token);
    expect((await call('DELETE', '/v1/account', undefined, token)).status).toBe(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM records').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
});

describe('CORS', () => {
  it('answers the app origin and refuses others', async () => {
    const preflight = await call('OPTIONS', '/v1/changes');
    expect(preflight.status).toBe(204);
    expect(preflight.response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(
      (await call('POST', '/v1/prelogin', { email: 'a@b.pt' }, undefined, 'https://evil.example'))
        .status,
    ).toBe(403);
  });
});

describe('KDF strength', () => {
  it('refuses accounts with too few client iterations', async () => {
    const weak = await call('POST', '/v1/register', {
      email: 'fraco@example.pt',
      salt: 'c2FsdA==',
      iterations: 1_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    });
    expect(weak.status).toBe(400);
  });
});
