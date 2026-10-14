import { beforeEach, describe, expect, it } from 'vitest';
import { memorySql } from '../test/sqlite';
import { createApp, MAX_FAILED_LOGINS } from './app';
import type { Sql } from './db';

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
let queries = 0;

beforeEach(() => {
  const memory = memorySql();
  db = memory.db;
  clock = new Date('2026-10-13T12:00:00Z');
  queries = 0;
  const sql: Sql = {
    first: (query, ...params) => (queries++, memory.sql.first(query, ...params)),
    all: (query, ...params) => (queries++, memory.sql.all(query, ...params)),
    run: (query, ...params) => (queries++, memory.sql.run(query, ...params)),
  };
  handle = createApp({
    sql,
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

  it('returns the account id on register, login and GET /v1/account', async () => {
    const created = await call('POST', '/v1/register', {
      email: 'ana@example.pt',
      salt: 'c2FsdHNhbHQ=',
      iterations: 600_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    });
    const accountId = created.body?.accountId as string;
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);
    const login = await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: AUTH });
    expect(login.body?.accountId).toBe(accountId);
    const me = await call('GET', '/v1/account', undefined, created.body?.token as string);
    expect(me.body).toEqual({ id: accountId });
  });

  it('records the day of the last activity, writing at most once a day', async () => {
    const token = await register();
    const seen = () => db.prepare('SELECT last_seen_at AS day FROM users').get() as { day: string };
    expect(seen().day).toBe('2026-10-13');

    clock = new Date('2026-10-15T08:00:00Z');
    queries = 0;
    await call('GET', '/v1/changes', undefined, token);
    const firstOfTheDay = queries;
    expect(seen().day).toBe('2026-10-15');

    queries = 0;
    await call('GET', '/v1/changes', undefined, token);
    expect(queries).toBe(firstOfTheDay - 1);
  });

  it('refreshes the size of the records once a day', async () => {
    const token = await register();
    await call('POST', '/v1/changes', { records: [record('r1', '2026-10-13T10:00:00Z')] }, token);
    clock = new Date('2026-10-14T08:00:00Z');
    await call('GET', '/v1/changes', undefined, token);
    const row = db.prepare('SELECT records_bytes AS bytes FROM users').get() as { bytes: number };
    const actual = db.prepare('SELECT SUM(LENGTH(enc)) AS bytes FROM records').get() as {
      bytes: number;
    };
    expect(row.bytes).toBe(actual.bytes);
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

  it('pushes 500 records with a handful of queries (D1 free plan: 50 per request)', async () => {
    const token = await register();
    const many = Array.from({ length: 500 }, (_, i) =>
      record(`r${i}`, `2026-10-13T10:00:${String(i % 60).padStart(2, '0')}Z`),
    );
    queries = 0;
    expect((await call('POST', '/v1/changes', { records: many }, token)).body).toEqual({
      latest: 500,
    });
    expect(queries).toBeLessThan(10);
    // Repeating the same batch changes nothing.
    expect((await call('POST', '/v1/changes', { records: many }, token)).body).toEqual({
      latest: 500,
    });
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

describe('files', () => {
  let files: ReturnType<typeof memorySql>['db'];

  beforeEach(() => {
    const memory = memorySql();
    const fileStore = memorySql('migrations-files/0001_files.sql');
    db = memory.db;
    files = fileStore.db;
    handle = createApp({
      sql: memory.sql,
      files: fileStore.sql,
      fileQuotaBytes: 40,
      filesTotalBytes: 60,
      preloginSecret: 'secret',
      allowedOrigins: [ORIGIN],
      now: () => clock,
    });
  });

  async function raw(method: string, path: string, token: string, text?: string) {
    return handle(
      new Request(`https://sync.example${path}`, {
        method,
        headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
        ...(text !== undefined ? { body: text } : {}),
      }),
    );
  }

  it('stores, returns and deletes the chunks of a file', async () => {
    const token = await register();
    expect((await raw('PUT', '/v1/files/f1/0?total=2', token, 'QUJD')).status).toBe(204);
    expect((await raw('PUT', '/v1/files/f1/1?total=2', token, 'REVG')).status).toBe(204);

    const second = await raw('GET', '/v1/files/f1/1', token);
    expect(await second.text()).toBe('REVG');
    expect(second.headers.get('X-Chunks')).toBe('2');
    expect(second.headers.get('Access-Control-Expose-Headers')).toBe('X-Chunks');
    expect((await call('GET', '/v1/files/usage', undefined, token)).body).toEqual({
      used: 8,
      quota: 40,
      keepMonths: 12,
    });

    expect((await raw('DELETE', '/v1/files/f1', token)).status).toBe(204);
    expect((await raw('GET', '/v1/files/f1/0', token)).status).toBe(404);
  });

  it('gives administrators their own quota and no originals window', async () => {
    handle = createApp({
      sql: memorySql().sql,
      files: memorySql('migrations-files').sql,
      fileQuotaBytes: 4,
      adminFileQuotaBytes: 40,
      adminEmails: ['admin@example.pt'],
      preloginSecret: 'secret',
      allowedOrigins: [ORIGIN],
      now: () => clock,
    });
    const admin = await register('admin@example.pt');
    const ana = await register('ana@example.pt');
    expect((await raw('PUT', '/v1/files/a/0?total=1', admin, 'QUJDREVG')).status).toBe(204);
    expect((await raw('PUT', '/v1/files/a/0?total=1', ana, 'QUJDREVG')).status).toBe(507);
    expect((await call('GET', '/v1/files/usage', undefined, admin)).body).toEqual({
      used: 8,
      quota: 40,
      keepMonths: null,
    });
  });

  it('refuses what is not base64 and malformed chunk numbers', async () => {
    const token = await register();
    expect((await raw('PUT', '/v1/files/f1/0?total=1', token, 'não é base64')).status).toBe(400);
    expect((await raw('PUT', '/v1/files/f1/1?total=1', token, 'QUJD')).status).toBe(400);
    expect((await raw('PUT', '/v1/files/f1/0', token, 'QUJD')).status).toBe(400);
  });

  it('enforces the per-account quota and the total cap', async () => {
    const ana = await register('ana@example.pt');
    const rui = await register('rui@example.pt');
    const chunk = 'A'.repeat(36);
    expect((await raw('PUT', '/v1/files/a/0?total=1', ana, chunk)).status).toBe(204);
    // Replacing the same chunk does not count twice.
    expect((await raw('PUT', '/v1/files/a/0?total=1', ana, chunk)).status).toBe(204);
    expect((await raw('PUT', '/v1/files/b/0?total=1', ana, 'QUJDREVG')).status).toBe(507);
    // 36 used by ana; rui has quota left but the total cap (60) is reached.
    expect((await raw('PUT', '/v1/files/c/0?total=1', rui, chunk)).status).toBe(507);
    expect((await raw('PUT', '/v1/files/c/0?total=1', rui, 'QUJD')).status).toBe(204);
  });

  it('keeps accounts apart and deletes files with the account', async () => {
    const ana = await register('ana@example.pt');
    const rui = await register('rui@example.pt');
    await raw('PUT', '/v1/files/f1/0?total=1', ana, 'QUJD');
    expect((await raw('GET', '/v1/files/f1/0', rui)).status).toBe(404);
    expect((await call('DELETE', '/v1/account', undefined, ana)).status).toBe(204);
    expect(files.prepare('SELECT COUNT(*) AS n FROM chunks').get()).toEqual({ n: 0 });
  });

  it('answers 404 when the server has no file database', async () => {
    handle = createApp({
      sql: memorySql().sql,
      preloginSecret: 'secret',
      allowedOrigins: [ORIGIN],
      now: () => clock,
    });
    const token = await register();
    expect((await raw('GET', '/v1/files/usage', token)).status).toBe(404);
  });
});

describe('records quota', () => {
  it('refuses records beyond the account quota with 507', async () => {
    handle = createApp({
      sql: memorySql().sql,
      recordQuotaBytes: 300,
      preloginSecret: 'secret',
      allowedOrigins: [ORIGIN],
      now: () => clock,
    });
    const token = await register();
    const first = await call(
      'POST',
      '/v1/changes',
      { records: [record('r1', '2026-10-13T10:00:00Z')] },
      token,
    );
    expect(first.status).toBe(200);
    const big = record('r2', '2026-10-13T10:01:00Z', 'QUJD'.repeat(100));
    const second = await call('POST', '/v1/changes', { records: [big] }, token);
    expect(second.status).toBe(507);
    expect(second.body).toEqual({ error: 'Record storage full' });
  });
});

describe('admission', () => {
  function server(options: Partial<Parameters<typeof createApp>[0]> = {}) {
    const memory = memorySql();
    db = memory.db;
    handle = createApp({
      sql: memory.sql,
      preloginSecret: 'secret',
      allowedOrigins: [ORIGIN],
      now: () => clock,
      ...options,
    });
  }

  const signUp = (email: string) =>
    call('POST', '/v1/register', {
      email,
      salt: 'c2FsdHNhbHQ=',
      iterations: 600_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    });

  it('closes new accounts at the maximum, but not for administrators', async () => {
    server({ maxAccounts: 1, adminEmails: ['admin@example.pt'] });
    expect((await signUp('ana@example.pt')).status).toBe(201);
    const refused = await signUp('rui@example.pt');
    expect(refused.status).toBe(503);
    expect(refused.body).toEqual({ error: 'capacity' });
    expect((await signUp('admin@example.pt')).status).toBe(201);
    // Existing accounts keep working.
    const login = await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: AUTH });
    expect(login.status).toBe(200);
  });

  it('closes new accounts when the stored usage passes the threshold', async () => {
    server({ filesTotalBytes: 1000, recordsTotalBytes: 1000, admissionPercent: 80 });
    db.prepare(
      'INSERT INTO stats (id, accounts, records_bytes, files_bytes, computed_at) VALUES (1, 0, 0, 800, ?)',
    ).run('2026-10-13T03:17:00Z');
    expect((await signUp('ana@example.pt')).status).toBe(503);

    db.prepare('UPDATE stats SET files_bytes = 799, records_bytes = 800').run();
    expect((await signUp('ana@example.pt')).status).toBe(503);

    db.prepare('UPDATE stats SET records_bytes = 0').run();
    expect((await signUp('ana@example.pt')).status).toBe(201);
  });
});
