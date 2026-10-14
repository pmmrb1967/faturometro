import { beforeEach, describe, expect, it } from 'vitest';
import { memorySql } from '../test/sqlite';
import { createApp } from './app';
import { monthsBefore, runMaintenance } from './maintenance';

const ORIGIN = 'https://app.example';
const AUTH = 'a'.repeat(64);
const WRAPPED = {
  byPassword: { iv: 'aXY=', data: 'ZGF0YQ==' },
  byRecoveryKey: { iv: 'aXY=', data: 'cmVj' },
  recoverySalt: 'c2FsdA==',
};

let main: ReturnType<typeof memorySql>;
let files: ReturnType<typeof memorySql>;
let handle: ReturnType<typeof createApp>;
let clock: Date;

beforeEach(() => {
  main = memorySql();
  files = memorySql('migrations-files');
  clock = new Date('2026-10-13T12:00:00Z');
  handle = createApp({
    sql: main.sql,
    files: files.sql,
    preloginSecret: 'secret',
    allowedOrigins: [ORIGIN],
    now: () => clock,
  });
});

async function register(email: string): Promise<{ token: string; accountId: string }> {
  const response = await handle(
    new Request('https://sync.example/v1/register', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        salt: 'c2FsdHNhbHQ=',
        iterations: 600_000,
        authKey: AUTH,
        wrappedKey: WRAPPED,
      }),
    }),
  );
  return (await response.json()) as { token: string; accountId: string };
}

async function put(token: string, text: string) {
  await handle(
    new Request('https://sync.example/v1/files/f1/0?total=1', {
      method: 'PUT',
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
      body: text,
    }),
  );
}

const count = (db: ReturnType<typeof memorySql>['db'], table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('monthsBefore', () => {
  it('counts calendar months in UTC', () => {
    expect(monthsBefore(new Date('2026-10-13T12:00:00Z'), 12)).toBe('2025-10-13');
    expect(monthsBefore(new Date('2026-03-31T00:00:00Z'), 1)).toBe('2026-03-03');
  });
});

describe('runMaintenance', () => {
  it('removes accounts inactive for more than 12 months, except administrators', async () => {
    const ana = await register('ana@example.pt');
    await register('admin@example.pt');
    await put(ana.token, 'QUJD');
    const run = () =>
      runMaintenance({
        sql: main.sql,
        files: files.sql,
        adminEmails: ['admin@example.pt'],
        now: () => clock,
      });

    clock = new Date('2027-10-13T12:00:00Z'); // exactly 12 months: kept
    expect((await run()).removed).toBe(0);

    clock = new Date('2027-10-14T12:00:00Z'); // one day more: removed
    expect((await run()).removed).toBe(1);
    expect(count(main.db, 'users')).toBe(1);
    expect(count(main.db, 'sessions')).toBe(1);
    expect(count(files.db, 'chunks')).toBe(0);
    expect(main.db.prepare('SELECT id, removed_at FROM removed_accounts').all()).toEqual([
      { id: ana.accountId, removed_at: '2027-10-14' },
    ]);
  });

  it('forgets removal marks after 24 months', async () => {
    main.db
      .prepare(
        "INSERT INTO removed_accounts (id, removed_at) VALUES ('old', '2024-10-12'), ('new', '2024-10-13')",
      )
      .run();
    await runMaintenance({ sql: main.sql, now: () => clock });
    expect(main.db.prepare('SELECT id FROM removed_accounts').all()).toEqual([{ id: 'new' }]);
  });

  it('stores usage totals without personal data', async () => {
    const ana = await register('ana@example.pt');
    await put(ana.token, 'QUJDREVG');
    const { stats } = await runMaintenance({ sql: main.sql, files: files.sql, now: () => clock });
    expect(stats).toEqual({
      accounts: 1,
      records_bytes: 0,
      files_bytes: 8,
      computed_at: '2026-10-13T12:00:00.000Z',
    });
    expect(main.db.prepare('SELECT * FROM stats').all()).toEqual([{ id: 1, ...stats }]);
  });
});
