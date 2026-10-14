# Sync Capacity (Cloudflare Free Plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the optional sync server within the Cloudflare free plan forever: per-account policy (admin vs. others), a 12-month window for originals, a records quota, an admission brake, removal of inactive accounts, and a weekly usage alert.

**Architecture:** The sync server (`server/`, Worker + two D1 databases) owns every limit and tells the app its policy through `GET /v1/files/usage`. A daily Cron Trigger runs `runMaintenance` (inactive accounts, tombstones, usage stats). The app applies the originals window itself (only it knows invoice dates) and handles the new server answers (503 capacity, 507 records full, removed account). A weekly GitHub workflow reads the stats row and opens an issue above 70%.

**Tech Stack:** TypeScript strict, Cloudflare Workers + D1 (SQLite), node:sqlite in tests, Dexie, React 18, zod, Vitest, GitHub Actions, wrangler.

**Spec:** `docs/superpowers/specs/2026-10-14-sync-capacity-design.md`

## Global Constraints

- Code, names and comments in English; user-visible text in European Portuguese (post-AO90, "tu"), only in `src/i18n/pt-PT.ts`.
- No `any`. Dates as ISO `YYYY-MM-DD`. Ids with `crypto.randomUUID()`.
- Server never receives clear invoice data; new tables/columns hold only ids, dates, sizes and counts.
- The app may contact the sync server only after the user turned sync on (CLAUDE.md rule 1): no capacity check before that.
- D1 free plan: 50 queries per request, rows read/written count against daily limits — no per-request scans of all rows.
- Defaults: file quota 30 MB; admin file quota 100 MB; originals kept 12 months (admin: no limit); records quota 5 MB; max accounts 200; admission brake 80%; inactivity 12 months; tombstones kept 24 months; alert at 70%, weekly.
- `ADMIN_EMAILS` is a Worker secret, never in the repository.
- Dexie: no index changes in this plan (new `syncState` values reuse the existing index) — so no new schema version.
- Before a task is done: `pnpm typecheck && pnpm lint && pnpm test` pass.
- Conventional Commits; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Account whose last sync was exactly 12 months ago (boundary) — must NOT be removed; one day older — removed. Test in Task 4.
2. A device with file sync on whose download of an original failed (still `remote`) — that original must never be deleted from the server. Test in Task 7.
3. A pruned-original record arriving on a device that never knew the document (new device) — must create a `gone` row, not crash or download. Test in Task 7.
4. Registration of the admin email when the server is full — must succeed. Test in Task 3.
5. A sync that gets 401 for a reason other than removal (password changed elsewhere) — must still show "session expired", not "removed". Test in Task 6.

---

## File Structure

Server:
- `server/migrations/0002_capacity.sql` (create) — new columns and tables.
- `server/test/sqlite.ts` (modify) — apply every migration in a folder.
- `server/src/app.ts` (modify) — policy, quotas, admission, account id, removed check, last activity.
- `server/src/maintenance.ts` (create) + `maintenance.test.ts` — daily job.
- `server/src/env.ts` (create) + `env.test.ts` — Worker env → config.
- `server/src/worker.ts`, `server/wrangler.toml` (modify) — config and Cron Trigger.

App:
- `src/sync/api.ts`, `src/sync/account.ts`, `src/db/profiles.ts` — new answers and `accountId`.
- `src/db/schema.ts`, `src/db/documents.ts`, `src/sync/files.ts` — originals window.
- `src/features/sync/sync-store.ts`, `src/features/settings/SettingsPage.tsx`, `src/features/invoices/OriginalButton.tsx`, `src/i18n/pt-PT.ts` — UI.
- `src/sync/sync.test.ts` — client tests.

Monitoring and docs:
- `scripts/sync-capacity.ts` + `scripts/sync-capacity.test.ts`, `.github/workflows/sync-capacity.yml`.
- `planning/PLAN.md` (§15b, §16).

---

### Task 1: Migration, last activity and account id

**Files:**
- Create: `server/migrations/0002_capacity.sql`
- Modify: `server/test/sqlite.ts`
- Modify: `server/src/app.ts` (header comment, `UserRow`, `userFromToken`, register, login, new `GET /v1/account`)
- Test: `server/src/app.test.ts`

**Interfaces:**
- Produces: tables `removed_accounts(id, removed_at)`, `stats(id=1, accounts, records_bytes, files_bytes, computed_at)`; columns `users.last_seen_at TEXT` (`YYYY-MM-DD`), `users.records_bytes INTEGER`.
- Produces: `POST /v1/register` → `{ token, accountId }` (201); `POST /v1/login` → `{ token, wrappedKey, accountId }`; `GET /v1/account` (auth) → `{ id }`.
- Produces: `memorySql(source = 'migrations')` — a folder applies every `*.sql` in name order; a path ending in `.sql` applies that file only.

- [ ] **Step 1: Migration**

`server/migrations/0002_capacity.sql`:

```sql
-- Staying within the Cloudflare free plan
-- (docs/superpowers/specs/2026-10-14-sync-capacity-design.md).
-- Day of the last authenticated request (YYYY-MM-DD) and size of the
-- account's encrypted records, refreshed at most once a day.
ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN records_bytes INTEGER NOT NULL DEFAULT 0;
UPDATE users SET last_seen_at = date('now');
UPDATE users SET records_bytes =
  (SELECT COALESCE(SUM(LENGTH(enc)), 0) FROM records WHERE records.user_id = users.id);
CREATE INDEX users_by_last_seen ON users (last_seen_at);

-- Accounts removed for inactivity: only the random id, so their devices can
-- tell "removed" from "wrong password" without revealing any email.
CREATE TABLE removed_accounts (
  id TEXT PRIMARY KEY,
  removed_at TEXT NOT NULL
);

-- Totals computed by the daily job (no personal data).
CREATE TABLE stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accounts INTEGER NOT NULL,
  records_bytes INTEGER NOT NULL,
  files_bytes INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);
```

- [ ] **Step 2: Test helper applies every migration**

Replace `memorySql` in `server/test/sqlite.ts`:

```ts
/** Test-only: the server's Sql interface over node:sqlite, with the real migrations. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Sql, SqlValue } from '../src/db';

/** `source`: a migrations folder (every *.sql, in order) or one .sql file. */
export function memorySql(source = 'migrations'): { sql: Sql; db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const path = join(__dirname, '..', source);
  const files = source.endsWith('.sql')
    ? [path]
    : readdirSync(path)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => join(path, name));
  for (const file of files) db.exec(readFileSync(file, 'utf8'));
  const sql: Sql = {
    first: async <T>(query: string, ...params: SqlValue[]) =>
      (db.prepare(query).get(...params) as T | undefined) ?? null,
    all: async <T>(query: string, ...params: SqlValue[]) => db.prepare(query).all(...params) as T[],
    run: async (query: string, ...params: SqlValue[]) => {
      db.prepare(query).run(...params);
    },
  };
  return { sql, db };
}
```

Run: `pnpm vitest run server src/sync` — Expected: PASS (existing tests unchanged).

- [ ] **Step 3: Write the failing tests**

Add to `server/src/app.test.ts`, inside `describe('accounts', …)`:

```ts
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
    const seen = () =>
      db.prepare('SELECT last_seen_at AS day FROM users').get() as { day: string };
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
```

- [ ] **Step 4: Run to see them fail**

Run: `pnpm vitest run server/src/app.test.ts`
Expected: the three new tests FAIL (`accountId` undefined; `last_seen_at` is `''`).

- [ ] **Step 5: Implement**

In `server/src/app.ts`:

Header comment — change and add lines:

```
 *   POST   /v1/register   {email, salt, iterations, authKey, wrappedKey} → {token, accountId}
 *   POST   /v1/login      {email, authKey}                → {token, wrappedKey, accountId}
 *   GET    /v1/account                                    → {id}
```

`UserRow` — add:

```ts
  /** Day of the last authenticated request (YYYY-MM-DD). */
  last_seen_at: string;
  /** Size of the encrypted records, refreshed daily and grown by each push. */
  records_bytes: number;
```

Inside `createApp`, after `const now = …`:

```ts
  const today = () => now().toISOString().slice(0, 10);
```

Replace the end of `userFromToken` (`if (!user) …; return user;`) with:

```ts
    if (!user) throw new HttpError(401, 'Invalid or expired token');
    if (user.last_seen_at < today()) {
      // At most one write per account and day (D1 free plan counts writes).
      const fresh = await sql.first<{ records_bytes: number }>(
        `UPDATE users SET last_seen_at = ?1,
           records_bytes = (SELECT COALESCE(SUM(LENGTH(enc)), 0) FROM records WHERE user_id = ?2)
         WHERE id = ?2 RETURNING records_bytes`,
        today(),
        user.id,
      );
      return { ...user, last_seen_at: today(), records_bytes: fresh?.records_bytes ?? 0 };
    }
    return user;
```

Register — insert `last_seen_at` and return the id:

```ts
      await sql.run(
        'INSERT INTO users (id, email, kdf_salt, kdf_iterations, auth_hash, wrapped_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        input.email,
        input.salt,
        input.iterations,
        await sha256Hex(input.authKey),
        JSON.stringify(input.wrappedKey),
        now().toISOString(),
        today(),
      );
      return json({ token: await newSession(id), accountId: id }, 201);
```

Login — the final `return json({...})` gets `accountId: user.id,`.

After `const user = await userFromToken(request);` add:

```ts
    if (method === 'GET' && path === '/v1/account') return json({ id: user.id });
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run server src/sync`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/0002_capacity.sql server/test/sqlite.ts server/src/app.ts server/src/app.test.ts
git commit -m "feat(server): last activity, record sizes and account id"
```

---

### Task 2: Per-account policy and records quota

**Files:**
- Modify: `server/src/app.ts` (`AppConfig`, constants, `/v1/files/usage`, PUT chunk quota, `POST /v1/changes`)
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: `UserRow.records_bytes`, `UserRow.email` (Task 1).
- Produces: `AppConfig.adminEmails?: string[]`, `adminFileQuotaBytes?: number`, `keepMonths?: number`, `recordQuotaBytes?: number`; exported constants `FILE_QUOTA_BYTES = 30_000_000`, `ADMIN_FILE_QUOTA_BYTES = 100_000_000`, `KEEP_MONTHS = 12`, `RECORD_QUOTA_BYTES = 5_000_000`.
- Produces: `GET /v1/files/usage` → `{ used: number, quota: number, keepMonths: number | null }` (`null` for admins); `POST /v1/changes` → 507 `Record storage full`.

- [ ] **Step 1: Write the failing tests**

In `describe('files', …)` update the existing expectation in "stores, returns and deletes the chunks of a file":

```ts
    expect((await call('GET', '/v1/files/usage', undefined, token)).body).toEqual({
      used: 8,
      quota: 40,
      keepMonths: 12,
    });
```

Add to `describe('files', …)`:

```ts
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
```

Add a new `describe` at the end of the file:

```ts
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
    const first = await call('POST', '/v1/changes', { records: [record('r1', '2026-10-13T10:00:00Z')] }, token);
    expect(first.status).toBe(200);
    const big = record('r2', '2026-10-13T10:01:00Z', 'QUJD'.repeat(100));
    const second = await call('POST', '/v1/changes', { records: [big] }, token);
    expect(second.status).toBe(507);
    expect(second.body).toEqual({ error: 'Record storage full' });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run server/src/app.test.ts`
Expected: FAIL (`keepMonths` missing; admin chunk 507; records accepted).

- [ ] **Step 3: Implement**

`AppConfig` — add after `filesTotalBytes`:

```ts
  /** Emails (normalized) of administrator accounts: own quota, no originals window, never removed. */
  adminEmails?: string[];
  /** Per-account file storage of administrators, in base64 characters. */
  adminFileQuotaBytes?: number;
  /** Months of originals kept on the server, applied by the app (administrators: no limit). */
  keepMonths?: number;
  /** Per-account size of the encrypted records, in characters. */
  recordQuotaBytes?: number;
```

Constants — replace `FILE_QUOTA_BYTES` and add:

```ts
export const FILE_QUOTA_BYTES = 30_000_000;
export const ADMIN_FILE_QUOTA_BYTES = 100_000_000;
export const KEEP_MONTHS = 12;
export const RECORD_QUOTA_BYTES = 5_000_000;
```

Inside `createApp`, after `today`:

```ts
  const isAdmin = (address: string) => (config.adminEmails ?? []).includes(address);
  const fileQuota = (user: UserRow) =>
    isAdmin(user.email)
      ? (config.adminFileQuotaBytes ?? ADMIN_FILE_QUOTA_BYTES)
      : (config.fileQuotaBytes ?? FILE_QUOTA_BYTES);
```

`GET /v1/files/usage` answer:

```ts
        return json({
          used: row?.used ?? 0,
          quota: fileQuota(user),
          keepMonths: isAdmin(user.email) ? null : (config.keepMonths ?? KEEP_MONTHS),
        });
```

PUT chunk quota check — replace `(config.fileQuotaBytes ?? FILE_QUOTA_BYTES)` with `fileQuota(user)`.

`POST /v1/changes` — after the `MAX_BATCH_LENGTH` check:

```ts
      // Grows by each push (an overestimate when records are replaced); recomputed daily.
      if (user.records_bytes + batch.length > (config.recordQuotaBytes ?? RECORD_QUOTA_BYTES)) {
        throw new HttpError(507, 'Record storage full');
      }
```

and replace the `UPDATE users SET seq = ?` statement with:

```ts
      await sql.run(
        'UPDATE users SET seq = ?, records_bytes = records_bytes + ? WHERE id = ?',
        Math.max(latest, user.seq),
        batch.length,
        user.id,
      );
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run server src/sync`
Expected: PASS (the 500-record test still uses fewer than 10 queries).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.test.ts
git commit -m "feat(server): per-account policy, admin quota and records quota"
```

---

### Task 3: Admission brake

**Files:**
- Modify: `server/src/app.ts` (`AppConfig`, constants, register)
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: `stats` table (Task 1), `isAdmin` (Task 2).
- Produces: `AppConfig.maxAccounts?: number`, `admissionPercent?: number`, `recordsTotalBytes?: number`; constants `MAX_ACCOUNTS = 200`, `ADMISSION_PERCENT = 80`, `RECORDS_TOTAL_BYTES = 500_000_000`; `POST /v1/register` → 503 `{ error: 'capacity' }`.

- [ ] **Step 1: Write the failing tests**

Add at the end of `server/src/app.test.ts`:

```ts
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

  it('closes new accounts at the maximum, but not for administrators', async () => {
    server({ maxAccounts: 1, adminEmails: ['admin@example.pt'] });
    expect(await register('ana@example.pt')).toBeTruthy();
    const refused = await call('POST', '/v1/register', {
      email: 'rui@example.pt',
      salt: 'c2FsdHNhbHQ=',
      iterations: 600_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    });
    expect(refused.status).toBe(503);
    expect(refused.body).toEqual({ error: 'capacity' });
    expect(await register('admin@example.pt')).toBeTruthy();
    // Existing accounts keep working.
    expect((await call('POST', '/v1/login', { email: 'ana@example.pt', authKey: AUTH })).status).toBe(200);
  });

  it('closes new accounts when the stored usage passes the threshold', async () => {
    server({ filesTotalBytes: 1000, recordsTotalBytes: 1000, admissionPercent: 80 });
    db.prepare(
      'INSERT INTO stats (id, accounts, records_bytes, files_bytes, computed_at) VALUES (1, 0, 0, 800, ?)',
    ).run('2026-10-13T03:17:00Z');
    const refused = await call('POST', '/v1/register', {
      email: 'ana@example.pt',
      salt: 'c2FsdHNhbHQ=',
      iterations: 600_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    });
    expect(refused.status).toBe(503);

    db.prepare('UPDATE stats SET files_bytes = 799, records_bytes = 800').run();
    expect((await call('POST', '/v1/register', {
      email: 'ana@example.pt',
      salt: 'c2FsdHNhbHQ=',
      iterations: 600_000,
      authKey: AUTH,
      wrappedKey: WRAPPED,
    })).status).toBe(503);

    db.prepare('UPDATE stats SET records_bytes = 0').run();
    expect(await register('ana@example.pt')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run server/src/app.test.ts -t admission`
Expected: FAIL (201 instead of 503).

- [ ] **Step 3: Implement**

`AppConfig` — add:

```ts
  /** New accounts are refused at this many accounts. */
  maxAccounts?: number;
  /** New accounts are refused when stored usage reaches this share (%) of a database. */
  admissionPercent?: number;
  /** Space for records (the free D1 database holds 500 MB). */
  recordsTotalBytes?: number;
```

Constants:

```ts
export const MAX_ACCOUNTS = 200;
export const ADMISSION_PERCENT = 80;
export const RECORDS_TOTAL_BYTES = 500_000_000;
```

Inside `createApp`:

```ts
  /** Room for one more account? Usage comes from the daily stats, not from a scan per request. */
  async function admissionOpen(): Promise<boolean> {
    const row = await sql.first<{
      accounts: number;
      records_bytes: number | null;
      files_bytes: number | null;
    }>(
      `SELECT (SELECT COUNT(*) FROM users) AS accounts, s.records_bytes, s.files_bytes
       FROM (SELECT 1) LEFT JOIN stats AS s ON s.id = 1`,
    );
    const share = (config.admissionPercent ?? ADMISSION_PERCENT) / 100;
    return (
      (row?.accounts ?? 0) < (config.maxAccounts ?? MAX_ACCOUNTS) &&
      (row?.records_bytes ?? 0) < share * (config.recordsTotalBytes ?? RECORDS_TOTAL_BYTES) &&
      (row?.files_bytes ?? 0) < share * (config.filesTotalBytes ?? FILES_TOTAL_BYTES)
    );
  }
```

In register, after the 409 check:

```ts
      if (!isAdmin(input.email) && !(await admissionOpen())) {
        throw new HttpError(503, 'capacity');
      }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run server src/sync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/app.test.ts
git commit -m "feat(server): refuse new accounts near the free plan limits"
```

---

### Task 4: Daily maintenance and removed-account check

**Files:**
- Create: `server/src/maintenance.ts`
- Create: `server/src/maintenance.test.ts`
- Modify: `server/src/app.ts` (header comment, `GET /v1/removed/:id` before authentication)
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: `users.last_seen_at`, `removed_accounts`, `stats` (Task 1).
- Produces: `runMaintenance(config: MaintenanceConfig): Promise<MaintenanceResult>` with

```ts
export interface MaintenanceConfig {
  sql: Sql;
  files?: Sql;
  adminEmails?: string[];
  inactiveMonths?: number;
  now?: () => Date;
}
export interface UsageStats {
  accounts: number;
  records_bytes: number;
  files_bytes: number;
  computed_at: string;
}
export interface MaintenanceResult {
  removed: number;
  stats: UsageStats;
}
```

  and `monthsBefore(date: Date, months: number): string` (`YYYY-MM-DD`, UTC), `INACTIVE_MONTHS = 12`, `TOMBSTONE_MONTHS = 24`.
- Produces: `GET /v1/removed/:accountId` (no auth) → `{ removed: boolean }`.

- [ ] **Step 1: Write the failing tests**

`server/src/maintenance.test.ts`:

```ts
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
      body: JSON.stringify({ email, salt: 'c2FsdHNhbHQ=', iterations: 600_000, authKey: AUTH, wrappedKey: WRAPPED }),
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
    clock = new Date('2027-10-13T12:00:00Z'); // exactly 12 months: kept
    let result = await runMaintenance({ sql: main.sql, files: files.sql, adminEmails: ['admin@example.pt'], now: () => clock });
    expect(result.removed).toBe(0);

    clock = new Date('2027-10-14T12:00:00Z'); // one day more: removed
    result = await runMaintenance({ sql: main.sql, files: files.sql, adminEmails: ['admin@example.pt'], now: () => clock });
    expect(result.removed).toBe(1);
    expect(count(main.db, 'users')).toBe(1);
    expect(count(main.db, 'sessions')).toBe(1);
    expect(count(files.db, 'chunks')).toBe(0);
    expect(main.db.prepare('SELECT id, removed_at FROM removed_accounts').all()).toEqual([
      { id: ana.accountId, removed_at: '2027-10-14' },
    ]);
  });

  it('forgets removal marks after 24 months', async () => {
    main.db.prepare("INSERT INTO removed_accounts (id, removed_at) VALUES ('old', '2024-10-12'), ('new', '2024-10-13')").run();
    await runMaintenance({ sql: main.sql, now: () => clock });
    expect(main.db.prepare('SELECT id FROM removed_accounts').all()).toEqual([{ id: 'new' }]);
  });

  it('stores usage totals without personal data', async () => {
    const ana = await register('ana@example.pt');
    await put(ana.token, 'QUJDREVG');
    const { stats } = await runMaintenance({ sql: main.sql, files: files.sql, now: () => clock });
    expect(stats).toEqual({ accounts: 1, records_bytes: 0, files_bytes: 8, computed_at: '2026-10-13T12:00:00.000Z' });
    expect(main.db.prepare('SELECT * FROM stats').all()).toEqual([{ id: 1, ...stats }]);
  });
});
```

Add to `server/src/app.test.ts`, in `describe('accounts', …)`:

```ts
  it('tells a device whether its account was removed, by random id only', async () => {
    db.prepare("INSERT INTO removed_accounts (id, removed_at) VALUES ('0b6c6c3e-8a4e-4c5f-9a2b-1f2e3d4c5b6a', '2026-10-01')").run();
    const removed = await call('GET', '/v1/removed/0b6c6c3e-8a4e-4c5f-9a2b-1f2e3d4c5b6a');
    expect(removed.body).toEqual({ removed: true });
    const other = await call('GET', '/v1/removed/11111111-2222-4333-8444-555555555555');
    expect(other.body).toEqual({ removed: false });
    expect((await call('GET', '/v1/removed/ana@example.pt')).status).toBe(401);
  });
```

(The last line: anything that is not a UUID falls through to the authenticated routes and gets 401.)

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run server`
Expected: FAIL (`./maintenance` not found; `/v1/removed` answers 401).

- [ ] **Step 3: Implement `server/src/maintenance.ts`**

```ts
/**
 * Daily job (Cron Trigger, server/wrangler.toml): removes accounts inactive
 * for too long, forgets old removal marks and stores usage totals for the
 * admission brake and the weekly alert. Only ids, dates and sizes are touched.
 */
import type { Sql } from './db';

export const INACTIVE_MONTHS = 12;
export const TOMBSTONE_MONTHS = 24;

export interface MaintenanceConfig {
  sql: Sql;
  files?: Sql;
  adminEmails?: string[];
  inactiveMonths?: number;
  now?: () => Date;
}

export interface UsageStats {
  accounts: number;
  records_bytes: number;
  files_bytes: number;
  computed_at: string;
}

export interface MaintenanceResult {
  removed: number;
  stats: UsageStats;
}

/** `YYYY-MM-DD`, `months` calendar months before `date` (UTC; overflowing days roll over). */
export function monthsBefore(date: Date, months: number): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

export async function runMaintenance(config: MaintenanceConfig): Promise<MaintenanceResult> {
  const { sql, files } = config;
  const now = (config.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);

  const inactive = await sql.all<{ id: string }>(
    'SELECT id FROM users WHERE last_seen_at < ? AND email NOT IN (SELECT value FROM json_each(?))',
    monthsBefore(now, config.inactiveMonths ?? INACTIVE_MONTHS),
    JSON.stringify(config.adminEmails ?? []),
  );
  if (inactive.length > 0) {
    // Set-based statements: a handful of queries whatever the number of accounts.
    const ids = JSON.stringify(inactive.map((row) => row.id));
    await files?.run('DELETE FROM chunks WHERE user_id IN (SELECT value FROM json_each(?))', ids);
    await sql.run('DELETE FROM records WHERE user_id IN (SELECT value FROM json_each(?))', ids);
    await sql.run('DELETE FROM sessions WHERE user_id IN (SELECT value FROM json_each(?))', ids);
    await sql.run('DELETE FROM users WHERE id IN (SELECT value FROM json_each(?))', ids);
    await sql.run(
      'INSERT OR REPLACE INTO removed_accounts (id, removed_at) SELECT value, ? FROM json_each(?)',
      today,
      ids,
    );
  }
  await sql.run(
    'DELETE FROM removed_accounts WHERE removed_at < ?',
    monthsBefore(now, TOMBSTONE_MONTHS),
  );

  const filesBytes =
    (await files?.first<{ total: number | null }>('SELECT SUM(size) AS total FROM chunks'))
      ?.total ?? 0;
  await sql.run(
    `INSERT OR REPLACE INTO stats (id, accounts, records_bytes, files_bytes, computed_at)
     VALUES (1, (SELECT COUNT(*) FROM users),
       (SELECT COALESCE(SUM(LENGTH(enc)), 0) FROM records), ?, ?)`,
    filesBytes,
    now.toISOString(),
  );
  const stats = await sql.first<UsageStats>(
    'SELECT accounts, records_bytes, files_bytes, computed_at FROM stats WHERE id = 1',
  );
  if (!stats) throw new Error('Stats were not stored');
  return { removed: inactive.length, stats };
}
```

- [ ] **Step 4: Route `GET /v1/removed/:id`**

In `server/src/app.ts`, header comment add:

```
 *   GET    /v1/removed/:accountId                         → {removed}  (no token; random id only)
```

In `route`, before `const user = await userFromToken(request);`:

```ts
    const removedRoute = /^\/v1\/removed\/([0-9a-f-]{36})$/.exec(path);
    if (method === 'GET' && removedRoute) {
      const row = await sql.first(
        'SELECT id FROM removed_accounts WHERE id = ?',
        removedRoute[1] ?? '',
      );
      return json({ removed: row !== null });
    }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/maintenance.ts server/src/maintenance.test.ts server/src/app.ts server/src/app.test.ts
git commit -m "feat(server): daily maintenance and removed-account check"
```

---

### Task 5: Worker configuration and Cron Trigger

**Files:**
- Create: `server/src/env.ts`
- Create: `server/src/env.test.ts`
- Modify: `server/src/worker.ts`
- Modify: `server/wrangler.toml`

**Interfaces:**
- Consumes: `AppConfig` fields (Tasks 2–3), `runMaintenance` (Task 4).
- Produces: `interface Env` (moved from `worker.ts`) and `limitsFromEnv(env: Env): Limits` where

```ts
export interface Limits {
  adminEmails: string[];
  fileQuotaBytes?: number;
  adminFileQuotaBytes?: number;
  keepMonths?: number;
  recordQuotaBytes?: number;
  maxAccounts?: number;
  admissionPercent?: number;
  inactiveMonths?: number;
}
```

- [ ] **Step 1: Check the free plan**

Open <https://developers.cloudflare.com/workers/platform/limits/> and <https://developers.cloudflare.com/workers/configuration/cron-triggers/> (WebFetch). Confirm Cron Triggers exist on the Workers Free plan and note the per-account limit and the CPU time for a scheduled run. If they are not on the free plan, STOP and ask the user (the fallback would be running `runMaintenance` from a scheduled GitHub workflow through an authenticated admin route).

- [ ] **Step 2: Write the failing test**

`server/src/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { limitsFromEnv } from './env';

const base = { DB: {} as never, PRELOGIN_SECRET: 's', ALLOWED_ORIGINS: 'https://a' };

describe('limitsFromEnv', () => {
  it('reads megabytes, months and counts; normalizes admin emails', () => {
    expect(
      limitsFromEnv({
        ...base,
        ADMIN_EMAILS: ' Ana@Example.pt , ,rui@example.pt',
        FILE_QUOTA_MB: '30',
        ADMIN_FILE_QUOTA_MB: '100',
        KEEP_MONTHS: '12',
        RECORD_QUOTA_MB: '5',
        MAX_ACCOUNTS: '200',
        ADMISSION_PERCENT: '80',
        INACTIVE_MONTHS: '12',
      }),
    ).toEqual({
      adminEmails: ['ana@example.pt', 'rui@example.pt'],
      fileQuotaBytes: 30_000_000,
      adminFileQuotaBytes: 100_000_000,
      keepMonths: 12,
      recordQuotaBytes: 5_000_000,
      maxAccounts: 200,
      admissionPercent: 80,
      inactiveMonths: 12,
    });
  });

  it('leaves missing or invalid values to the code defaults', () => {
    expect(limitsFromEnv({ ...base, FILE_QUOTA_MB: 'abc', KEEP_MONTHS: '-1' })).toEqual({
      adminEmails: [],
    });
  });
});
```

Run: `pnpm vitest run server/src/env.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `server/src/env.ts`**

```ts
/** Worker environment (server/wrangler.toml) turned into the app's limits. */
import type { D1Like } from './db';

export interface Env {
  DB: D1Like;
  /** Original files (encrypted chunks), in a database of their own. */
  FILES?: D1Like;
  /** Secret (wrangler secret put PRELOGIN_SECRET). */
  PRELOGIN_SECRET: string;
  /** Comma-separated app origins. */
  ALLOWED_ORIGINS: string;
  /** Secret (wrangler secret put ADMIN_EMAILS): comma-separated administrator emails. */
  ADMIN_EMAILS?: string;
  FILE_QUOTA_MB?: string;
  ADMIN_FILE_QUOTA_MB?: string;
  KEEP_MONTHS?: string;
  RECORD_QUOTA_MB?: string;
  MAX_ACCOUNTS?: string;
  ADMISSION_PERCENT?: string;
  INACTIVE_MONTHS?: string;
}

export interface Limits {
  adminEmails: string[];
  fileQuotaBytes?: number;
  adminFileQuotaBytes?: number;
  keepMonths?: number;
  recordQuotaBytes?: number;
  maxAccounts?: number;
  admissionPercent?: number;
  inactiveMonths?: number;
}

function positive(value: string | undefined): number | undefined {
  const number = Number(value);
  return value !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

function megabytes(value: string | undefined): number | undefined {
  const mb = positive(value);
  return mb === undefined ? undefined : mb * 1_000_000;
}

export function limitsFromEnv(env: Env): Limits {
  const limits: Limits = {
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address !== ''),
  };
  const entries: [keyof Omit<Limits, 'adminEmails'>, number | undefined][] = [
    ['fileQuotaBytes', megabytes(env.FILE_QUOTA_MB)],
    ['adminFileQuotaBytes', megabytes(env.ADMIN_FILE_QUOTA_MB)],
    ['keepMonths', positive(env.KEEP_MONTHS)],
    ['recordQuotaBytes', megabytes(env.RECORD_QUOTA_MB)],
    ['maxAccounts', positive(env.MAX_ACCOUNTS)],
    ['admissionPercent', positive(env.ADMISSION_PERCENT)],
    ['inactiveMonths', positive(env.INACTIVE_MONTHS)],
  ];
  for (const [name, value] of entries) if (value !== undefined) limits[name] = value;
  return limits;
}
```

- [ ] **Step 4: Worker entry with the scheduled handler**

Replace `server/src/worker.ts`:

```ts
/** Cloudflare Worker entry point. Configuration in server/wrangler.toml. */
import { createApp } from './app';
import { d1 } from './db';
import { limitsFromEnv, type Env } from './env';
import { runMaintenance } from './maintenance';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // Spread: createApp ignores `inactiveMonths` (used only by the scheduled job).
    const handle = createApp({
      sql: d1(env.DB),
      ...(env.FILES ? { files: d1(env.FILES) } : {}),
      preloginSecret: env.PRELOGIN_SECRET,
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
      ...limitsFromEnv(env),
    });
    return handle(request);
  },

  /** Daily Cron Trigger: inactive accounts and usage totals. */
  scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const { adminEmails, inactiveMonths } = limitsFromEnv(env);
    ctx.waitUntil(
      runMaintenance({
        sql: d1(env.DB),
        ...(env.FILES ? { files: d1(env.FILES) } : {}),
        adminEmails,
        ...(inactiveMonths !== undefined ? { inactiveMonths } : {}),
      }),
    );
  },
};
```

- [ ] **Step 5: `server/wrangler.toml`**

Add at the setup comment block: `#   pnpm exec wrangler secret put ADMIN_EMAILS -c server/wrangler.toml   # administrator emails, comma-separated`.

Extend `[vars]` and add the trigger:

```toml
# Free plan limits (docs/superpowers/specs/2026-10-14-sync-capacity-design.md).
FILE_QUOTA_MB = "30"
ADMIN_FILE_QUOTA_MB = "100"
KEEP_MONTHS = "12"
RECORD_QUOTA_MB = "5"
MAX_ACCOUNTS = "200"
ADMISSION_PERCENT = "80"
INACTIVE_MONTHS = "12"

[triggers]
# Daily maintenance: inactive accounts and usage totals (src/maintenance.ts).
crons = ["17 3 * * *"]
```

- [ ] **Step 6: Verify**

Run: `pnpm vitest run server && pnpm typecheck && pnpm lint`
Expected: PASS.

Run: `pnpm exec wrangler deploy --dry-run -c server/wrangler.toml`
Expected: builds without errors and lists the cron trigger and vars.

- [ ] **Step 7: Commit**

```bash
git add server/src/env.ts server/src/env.test.ts server/src/worker.ts server/wrangler.toml
git commit -m "feat(server): limits from the environment and a daily Cron Trigger"
```

---

### Task 6: App — account id, capacity, records full, removed account

**Files:**
- Modify: `src/sync/api.ts`
- Modify: `src/db/profiles.ts` (`ProfileSync.accountId`)
- Modify: `src/sync/account.ts`
- Test: `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: server routes from Tasks 1–4.
- Produces: `SyncApi.register` → `{ token, accountId }`; `SyncApi.login` → `{ token, wrappedKey, accountId }`; `SyncApi.account(token)` → `{ id }`; `SyncApi.removed(accountId)` → `{ removed }`; `SyncApi.fileUsage(token)` → `{ used, quota, keepMonths: number | null }`; `SyncApi.deleteFile(token, fileId)` → `void`.
- Produces: `SyncErrorCode` gains `'capacity' | 'records_full' | 'account_removed'`; `ProfileSync.accountId?: string`; `fileUsage()` returns `{ used, quota, keepMonths }`.

- [ ] **Step 1: Write the failing tests**

In `src/sync/sync.test.ts`: import `runMaintenance` from `'../../server/src/maintenance'` and `type ProfileSync` from `'../db/profiles'`, and keep the server's handles. Change the top-level `let` block and `beforeEach`:

```ts
let api: SyncApi;
let serverDb: ReturnType<typeof memorySql>['db'];
let serverSql: ReturnType<typeof memorySql>['sql'];
let fileDb: ReturnType<typeof memorySql>['db'];
/** The server's request handler (lets a test wrap it, e.g. to make downloads fail). */
let serverHandle: (request: Request) => Promise<Response>;

beforeEach(async () => {
  await profilesDb.profiles.clear();
  serverWith({});
});
```

(`serverWith` below replaces the old body of `beforeEach`; the "keeps the file local when the server is full" test can use `serverWith({ fileQuotaBytes: 10 })` instead of building its own server.)

Add a helper below `on(...)`:

```ts
function serverWith(options: Partial<Parameters<typeof createApp>[0]>) {
  const memory = memorySql();
  serverDb = memory.db;
  serverSql = memory.sql;
  const files = memorySql('migrations-files');
  fileDb = files.db;
  serverHandle = createApp({
    sql: memory.sql,
    files: files.sql,
    preloginSecret: 'secret',
    allowedOrigins: [],
    minIterations: ITERATIONS,
    ...options,
  });
  api = new SyncApi(SERVER, (input, init) => serverHandle(new Request(input, init)));
}
```

Add a new `describe`:

```ts
describe('free plan limits', () => {
  it('stores the account id when sync is turned on', async () => {
    const a = await deviceA();
    expect(a.profile.sync?.accountId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fills in the account id of older profiles on the next sync', async () => {
    const a = await deviceA();
    const sync = { ...a.profile.sync } as ProfileSync;
    delete sync.accountId;
    const { profile } = await runSync({ ...a, profile: { ...a.profile, sync }, api });
    expect(profile.sync?.accountId).toBe(a.profile.sync?.accountId);
  });

  it('says when the server is full for new accounts', async () => {
    serverWith({ maxAccounts: 0 });
    await expect(deviceA()).rejects.toMatchObject({ code: 'capacity' });
  });

  it('says when the records quota is reached', async () => {
    serverWith({ recordQuotaBytes: 10 });
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz'));
    await expect(runSync({ ...a, api })).rejects.toMatchObject({ code: 'records_full' });
  });

  it('turns sync off, keeping the local data, when the account was removed', async () => {
    const a = await deviceA();
    await a.repos.contracts.put(contract('c1', 'Luz da casa'));
    await runSync({ ...a, api });
    await runMaintenance({ sql: serverSql, now: () => new Date(Date.now() + 400 * 86_400_000) });

    await expect(runSync({ ...a, api })).rejects.toMatchObject({ code: 'account_removed' });
    expect((await profilesDb.profiles.get(a.profile.id))?.sync).toBeUndefined();
    expect((await a.repos.contracts.get('c1'))?.label).toBe('Luz da casa');
  });

  it('still asks for the password when the session ended for another reason', async () => {
    const a = await deviceA();
    serverDb.prepare('DELETE FROM sessions').run();
    await expect(runSync({ ...a, api })).rejects.toMatchObject({ code: 'session_expired' });
    expect((await profilesDb.profiles.get(a.profile.id))?.sync).toBeDefined();
  });
});
```

Also update the existing `memorySql('migrations-files/0001_files.sql')` calls in this file to `memorySql('migrations-files')`.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run src/sync/sync.test.ts`
Expected: FAIL (`accountId` undefined; codes `unexpected`/`session_expired` instead of the new ones).

- [ ] **Step 3: `src/sync/api.ts`**

```ts
  register(input: { … unchanged … }) {
    return this.call(
      'POST',
      '/v1/register',
      z.object({ token: z.string(), accountId: z.string() }),
      { body: input },
    );
  }

  login(email: string, authKey: string) {
    return this.call(
      'POST',
      '/v1/login',
      z.object({ token: z.string(), wrappedKey: wrappedSchema, accountId: z.string() }),
      { body: { email, authKey } },
    );
  }

  /** The server account's random id (older profiles did not store it). */
  account(token: string) {
    return this.call('GET', '/v1/account', z.object({ id: z.string() }), { token });
  }

  /** Whether the account was removed for inactivity (asked after a 401; no token needed). */
  removed(accountId: string) {
    return this.call(
      'GET',
      `/v1/removed/${encodeURIComponent(accountId)}`,
      z.object({ removed: z.boolean() }),
    );
  }

  fileUsage(token: string) {
    return this.call(
      'GET',
      '/v1/files/usage',
      z.object({ used: z.number(), quota: z.number(), keepMonths: z.number().nullable() }),
      { token },
    );
  }

  deleteFile(token: string, fileId: string) {
    return this.call('DELETE', `/v1/files/${encodeURIComponent(fileId)}`, null, { token });
  }
```

- [ ] **Step 4: `src/db/profiles.ts`**

In `ProfileSync`, after `serverUrl`:

```ts
  /** Server account id: after a 401, tells a removed account from an ended session. */
  accountId?: string;
```

(Not indexed: no Dexie version change.)

- [ ] **Step 5: `src/sync/account.ts`**

`SyncErrorCode` — add `| 'capacity' | 'records_full' | 'account_removed'`. Import `type ProfileSync` from `'../db/profiles'`.

`enableSync`:

```ts
  let token: string;
  let accountId: string;
  try {
    ({ token, accountId } = await api.register({ … unchanged … }));
  } catch (error) {
    fromHttp(error, { 409: 'account_exists', 503: 'capacity' });
  }
  return saveSync(input.profile, {
    serverUrl: input.serverUrl,
    accountId,
    token: await encryptJson(input.masterKey, token),
    lastPulledSeq: 0,
    lastPushedAt: '',
  });
```

`connectFromServer` — in the new profile's `sync`, add `accountId: login.accountId,`.

`reconnectSync` — `sync: { ...sync, accountId: login.accountId, token: await encryptJson(input.masterKey, login.token) },`.

`runSync` — replace the body from `const sync = …` to the `saveSync` call:

```ts
  const current = input.profile.sync;
  if (!current) throw new Error('Sync is not enabled');
  let sync: ProfileSync = current;
  const api = input.api ?? new SyncApi(sync.serverUrl);
  const token = (await decryptJson(input.masterKey, sync.token)) as string;
  let result: SyncResult;
  let files: FileSyncResult | undefined;
  try {
    if (!sync.accountId) sync = { ...sync, accountId: (await api.account(token)).id };
    result = await syncNow(input.repos, api, token, sync);
    if (sync.files) files = await syncFiles(input.repos, api, token, input.masterKey);
  } catch (error) {
    if (await wasRemoved(error, api, sync)) {
      // Removed for inactivity: the data stays on this device; sync can be turned on again.
      await saveSync(input.profile, undefined);
      throw new SyncError('account_removed');
    }
    fromHttp(error, { 401: 'session_expired', 507: 'records_full' });
  }
  const profile = await saveSync(input.profile, {
    ...sync,
    lastPulledSeq: result.lastPulledSeq,
    lastPushedAt: result.lastPushedAt,
    lastSyncAt: new Date().toISOString(),
  });
```

Add above `runSync`:

```ts
/** After a 401: was the server account removed for inactivity? */
async function wasRemoved(error: unknown, api: SyncApi, sync: ProfileSync): Promise<boolean> {
  if (!(error instanceof SyncHttpError) || error.status !== 401 || !sync.accountId) return false;
  try {
    return (await api.removed(sync.accountId)).removed;
  } catch {
    return false;
  }
}
```

`fileUsage` — return type `Promise<{ used: number; quota: number; keepMonths: number | null }>`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/sync server`
Expected: PASS. (The file-sync test expecting `{ uploaded: 1, downloaded: 0, storageFull: false }` still passes — `pruned` arrives in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add src/sync/api.ts src/db/profiles.ts src/sync/account.ts src/sync/sync.test.ts
git commit -m "feat(sync): account id, capacity, records quota and removed accounts in the app"
```

---

### Task 7: Originals window (app)

**Files:**
- Modify: `src/db/schema.ts` (`DocumentSyncState`)
- Modify: `src/db/documents.ts` (`RemoteDocumentMeta.onServer`, `onServerHere`, `prunedRecord`, `markPruned`, `applyRemote`)
- Modify: `src/sync/files.ts` (`FileSyncResult.pruned`, `monthsBefore`, pruning in `syncFiles`)
- Test: `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: `SyncApi.fileUsage` (with `keepMonths`), `SyncApi.deleteFile`, `SyncApi.push` (Task 6).
- Produces: `DocumentSyncState = 'local' | 'uploaded' | 'remote' | 'pruned' | 'gone'`; `FileSyncResult.pruned: number`; `syncFiles(repos, api, token, key, now = new Date())`; `monthsBefore(date: Date, months: number): string` in `src/sync/files.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/sync/sync.test.ts`, import `type Invoice` from `'../domain/types'` and add a helper:

```ts
function invoice(fileHash: string, issueDate: string): Omit<Invoice, 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    contractId: 'c1',
    providerId: 'p1',
    fileHash,
    docType: 'FT',
    issueDate,
    totalCents: 1562,
    qrStatus: 'ok',
    validation: 'not_checked',
    sources: {},
    confidence: {},
    createdAt: '2026-10-13T10:00:00.000Z',
  };
}
```

Update the expectation in "uploads only ciphertext and other devices download it":

```ts
    expect(sent.files).toEqual({ uploaded: 1, downloaded: 0, pruned: 0, storageFull: false });
```

Add to `describe('original files', …)`:

```ts
  it('keeps only the last 12 months of originals on the server', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    await a.repos.documents.put({ fileHash: 'new', mime: 'application/pdf', bytes: pdf });
    await a.repos.documents.put({ fileHash: 'orphan', mime: 'application/pdf', bytes: pdf });
    await a.repos.invoices.put(invoice('old', '2020-01-10'));
    await a.repos.invoices.put(invoice('new', today));
    let stateA = await setFileSync(a.profile, true);

    const first = await runSync({ ...a, profile: stateA, api });
    stateA = first.profile;
    expect(first.files?.pruned).toBe(1);
    expect(await a.repos.documents.stateOf('old')).toBe('pruned');
    expect(await a.repos.documents.stateOf('new')).toBe('uploaded');
    expect(await a.repos.documents.stateOf('orphan')).toBe('uploaded');
    expect((await a.repos.documents.getByFileHash('old'))?.bytes).toBeDefined();
    expect((fileDb.prepare('SELECT COUNT(DISTINCT file_id) AS n FROM chunks').get() as { n: number }).n).toBe(2);

    // A device that never had it: knows it exists, does not try to download it.
    const b = await deviceB();
    const synced = await runSync({ ...b, profile: await setFileSync(b.profile, true), api });
    expect(await b.repos.documents.stateOf('old')).toBe('gone');
    expect(await b.repos.documents.getByFileHash('old')).toBeUndefined();
    expect(synced.files?.downloaded).toBe(2);
    expect(synced.files?.pruned).toBe(0);

    // Nothing is pruned or uploaded twice.
    const again = await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    expect(again.files).toMatchObject({ uploaded: 0, pruned: 0 });
  });

  it('marks as pruned on another device that had downloaded it', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    // No invoice yet on A: nothing is pruned on the first sync.
    let stateA = await setFileSync(a.profile, true);
    stateA = (await runSync({ ...a, profile: stateA, api })).profile;

    const b = await deviceB();
    const stateB = (await runSync({ ...b, profile: await setFileSync(b.profile, true), api })).profile;
    expect(await b.repos.documents.stateOf('old')).toBe('uploaded');

    await a.repos.invoices.put(invoice('old', '2020-01-10'));
    await on(stateA, () => runSync({ ...a, profile: stateA, api }));
    await on(stateB, () => runSync({ ...b, profile: stateB, api }));
    expect(await b.repos.documents.stateOf('old')).toBe('pruned');
    expect((await b.repos.documents.getByFileHash('old'))?.bytes).toBeDefined();
  });

  it('never deletes from the server an original this device could not download', async () => {
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    await runSync({ ...a, profile: await setFileSync(a.profile, true), api });

    const b = await deviceB();
    await runSync({ ...b, api }); // files off: B only knows the metadata ('remote')
    await b.repos.invoices.put(invoice('old', '2020-01-10'));
    const failing = new SyncApi(SERVER, async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/files/') && !url.endsWith('/usage') && (init?.method ?? 'GET') === 'GET') {
        return new Response('down', { status: 503 });
      }
      return serverHandle(new Request(input, init));
    });
    await expect(
      runSync({ ...b, profile: await setFileSync(b.profile, true), api: failing }),
    ).rejects.toBeDefined();
    expect(await b.repos.documents.stateOf('old')).toBe('remote');
    expect((fileDb.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n).toBe(1);
  });

  it('administrators keep every original on the server', async () => {
    serverWith({ adminEmails: ['ana@example.pt'] });
    const a = await deviceA();
    await a.repos.documents.put({ fileHash: 'old', mime: 'application/pdf', bytes: pdf });
    await a.repos.invoices.put(invoice('old', '2020-01-10'));
    const synced = await runSync({ ...a, profile: await setFileSync(a.profile, true), api });
    expect(synced.files?.pruned).toBe(0);
    expect(await a.repos.documents.stateOf('old')).toBe('uploaded');
  });
```

Add to the existing `describe('original files')` a unit test of the date helper (import `monthsBefore` from `'./files'`):

```ts
  it('counts the window in calendar months', () => {
    expect(monthsBefore(new Date('2026-10-14T09:00:00Z'), 12)).toBe('2025-10-14');
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run src/sync/sync.test.ts`
Expected: FAIL (`pruned` missing; states unchanged).

- [ ] **Step 3: `src/db/schema.ts`**

```ts
/**
 * File sync state of a document (in clear, indexed):
 * - `local`: only on this device;
 * - `uploaded`: also on the sync server;
 * - `remote`: known from another device, contents still on the server;
 * - `pruned`: here, and removed from the server by the originals window;
 * - `gone`: known from another device, contents no longer on the server nor here.
 */
export type DocumentSyncState = 'local' | 'uploaded' | 'remote' | 'pruned' | 'gone';
```

- [ ] **Step 4: `src/db/documents.ts`**

`RemoteDocumentMeta` — add:

```ts
  /** `false` once the contents left the server (originals window): only on devices. */
  onServer?: false;
```

New methods in `DocumentStore` (after `markUploaded`):

```ts
  /**
   * Documents whose contents are both here and on the server. Key-only reads
   * (two cursors over the same index): rows hold whole files.
   */
  async onServerHere(): Promise<{ id: string; fileHash: string }[]> {
    const here = new Set(await this.table.where('syncState').equals('uploaded').primaryKeys());
    const hashes = await this.table.orderBy('fileHash').keys();
    const ids = await this.table.orderBy('fileHash').primaryKeys();
    return ids.flatMap((id, i) =>
      here.has(id) ? [{ id, fileHash: String(hashes[i]) }] : [],
    );
  }

  /** The record telling the other devices that the contents left the server. */
  async prunedRecord(id: string): Promise<{ id: string; updatedAt: string; enc: EncryptedBlob }> {
    const row = await this.table.get(id);
    if (!row?.encBytes) throw new Error('Document contents are not on this device');
    const meta = (await decryptJson(this.key, row.enc)) as DocumentMeta;
    const remote: RemoteDocumentMeta = {
      id: meta.id,
      fileHash: meta.fileHash,
      mime: meta.mime,
      addedAt: meta.addedAt,
      bytesIv: row.encBytes.iv,
      chunks: 0,
      onServer: false,
    };
    // Strictly newer than the upload record, or the server (last write wins) would keep that one.
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
    return { id, updatedAt, enc: await encryptJson(this.key, remote) };
  }

  async markPruned(id: string): Promise<void> {
    await this.table.update(id, { syncState: 'pruned' });
  }
```

`applyRemote` — first lines become:

```ts
  async applyRemote(enc: EncryptedBlob, updatedAt: string): Promise<boolean> {
    const meta = (await decryptJson(this.key, enc)) as RemoteDocumentMeta;
    if (meta.onServer === false) return this.applyPruned(meta, updatedAt);
    if (await this.table.where('fileHash').equals(meta.fileHash).count()) return false;
    … unchanged …
  }

  /** The contents left the server: keep what is here, never try to download them again. */
  private async applyPruned(meta: RemoteDocumentMeta, updatedAt: string): Promise<boolean> {
    const row =
      (await this.table.get(meta.id)) ??
      (await this.table.where('fileHash').equals(meta.fileHash).first());
    if (!row) {
      await this.table.put({
        id: meta.id,
        updatedAt,
        fileHash: meta.fileHash,
        syncState: 'gone',
        enc: await encryptJson(this.key, meta),
      });
      return true;
    }
    const next =
      row.syncState === 'remote' ? 'gone' : row.syncState === 'uploaded' ? 'pruned' : undefined;
    if (!next) return false;
    await this.table.update(row.id, { syncState: next });
    return true;
  }
```

Note: `getByFileHash` and `remoteOnly` already behave correctly for the new states (`gone` has no `encBytes`; `remoteOnly` filters on `remote`).

- [ ] **Step 5: `src/sync/files.ts`**

`FileSyncResult` — add `/** Removed from the server by the originals window (still here). */ pruned: number;` and initialize `pruned: 0`.

Add:

```ts
/** `YYYY-MM-DD`, `months` calendar months before `date` (UTC). */
export function monthsBefore(date: Date, months: number): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * Originals window: removes from the server the originals whose newest
 * invoice is older than the cutoff. Only documents whose contents are here
 * are candidates, so nothing is lost; originals without invoices stay.
 */
async function pruneOld(
  repos: Repositories,
  api: SyncApi,
  token: string,
  cutoff: string,
): Promise<number> {
  let pruned = 0;
  for (const { id, fileHash } of await repos.documents.onServerHere()) {
    const invoices = await repos.invoices.findBy('fileHash', fileHash);
    if (invoices.length === 0) continue;
    const newest = invoices.reduce(
      (latest, invoice) => (invoice.issueDate > latest ? invoice.issueDate : latest),
      '',
    );
    if (newest >= cutoff) continue;
    const record = await repos.documents.prunedRecord(id);
    await api.deleteFile(token, id);
    await api.push(token, [{ table: 'documents', ...record }]);
    await repos.documents.markPruned(id);
    pruned++;
  }
  return pruned;
}
```

`syncFiles` — new signature `(repos, api, token, key, now: Date = new Date())`; after the download loop, before `return result;`:

```ts
  // Runs after the downloads: an original that could not be downloaded is not a candidate.
  const { keepMonths } = await api.fileUsage(token);
  if (keepMonths !== null) {
    result.pruned = await pruneOld(repos, api, token, monthsBefore(now, keepMonths));
  }
```

Note: a failed download throws out of `syncFiles` before this point (existing behaviour for non-404 errors), which is what the third test relies on.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/sync src/db server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/documents.ts src/sync/files.ts src/sync/sync.test.ts
git commit -m "feat(sync): keep only the last 12 months of originals on the server"
```

---

### Task 8: UI, texts and privacy page

**Files:**
- Modify: `src/i18n/pt-PT.ts`
- Modify: `src/features/sync/sync-store.ts`
- Modify: `src/features/settings/SettingsPage.tsx`
- Modify: `src/features/invoices/OriginalButton.tsx`

**Interfaces:**
- Consumes: `SyncErrorCode` values, `fileUsage().keepMonths`, `FileSyncResult.pruned`, `DocumentSyncState` `gone` (Tasks 6–7).

- [ ] **Step 1: Texts (`src/i18n/pt-PT.ts`)**

In `sync.errors`, add:

```ts
      capacity:
        'A sincronização está lotada de momento. Os teus dados continuam neste dispositivo; tenta mais tarde.',
      records_full:
        'Atingiste o espaço para registos no servidor. Os novos dados ficam só neste dispositivo.',
      account_removed:
        'A tua conta de sincronização foi removida por inatividade (12 meses sem sincronizar). Os teus dados estão neste dispositivo; podes voltar a ligar a sincronização.',
```

In `sync.files`, add:

```ts
      keep: (months: number) =>
        `Os originais com mais de ${months} meses ficam só nos teus dispositivos (saem do servidor).`,
      pruned: (count: number) =>
        count === 1
          ? '1 original antigo saiu do servidor (continua neste dispositivo).'
          : `${count} originais antigos saíram do servidor (continuam neste dispositivo).`,
```

In `sync.serverSees`, replace the first sentence with:
`'O servidor fica a saber: o teu email, o dia em que sincronizaste pela última vez, quando cada registo foi alterado e de que tipo é (fatura, contrato…). Não vê nomes, valores, datas das faturas, NIF nem moradas.'`

In `invoices.original`, add:

```ts
      gone: 'Este original já só está guardado nos dispositivos que o tinham.',
```

In `privacyPage`: `updated: 'Última atualização: 14 de outubro de 2026.'`; in the sync section, in the "O servidor guarda" paragraph replace `o teu email;` with `o teu email e o dia em que sincronizaste pela última vez;`, and replace the last paragraph with:

```ts
          'As sessões expiram ao fim de 30 dias. Os dados ficam no servidor até desligares a sincronização com a opção de apagar ou até apagares tudo (Definições).',
          'Para o serviço continuar gratuito há limites: os PDFs originais com mais de 12 meses saem do servidor e ficam só nos teus dispositivos; uma conta que não sincronize há 12 meses é apagada do servidor (os dados nos teus dispositivos ficam); e, quando o servidor está perto da lotação, não é possível ligar a sincronização em contas novas.',
```

- [ ] **Step 2: `src/features/sync/sync-store.ts`**

Import `profilesDb` from `'../../db/profiles'`. In `syncSession`'s `catch`:

```ts
  } catch (error) {
    if (error instanceof SyncError && error.code === 'account_removed') {
      // runSync already turned sync off for this profile; show it.
      const profile = await profilesDb.profiles.get(session.profile.id);
      if (profile) updateProfile(profile);
    }
    set({ running: false, error: error instanceof SyncError ? error.code : 'unexpected' });
  }
```

- [ ] **Step 3: `src/features/settings/SettingsPage.tsx`**

In `SyncSection`, inside the `!sync` form, right after `<p>{copy.offIntro}</p>`:

```tsx
          {status.error === 'account_removed' && (
            <p className="ingest-problem" role="alert">
              {copy.errors.account_removed}
            </p>
          )}
```

In `FileSyncOption`, after the usage paragraph:

```tsx
      {enabled && usage && usage.keepMonths !== null && (
        <p className="muted">{copy.files.keep(usage.keepMonths)}</p>
      )}
```

and after the `received` status:

```tsx
      {enabled && !!files?.pruned && <p role="status">{copy.files.pruned(files.pruned)}</p>}
```

- [ ] **Step 4: `src/features/invoices/OriginalButton.tsx`**

Replace `setProblem(copy.unavailable);` with:

```tsx
        setProblem(state === 'gone' ? copy.gone : copy.unavailable);
```

- [ ] **Step 5: Verify in the app**

Run: `pnpm typecheck && pnpm lint && pnpm test` — Expected: PASS.

Run `pnpm dev`, create a local account, open Definições: the sync section text shows the new "último dia" wording; `/privacidade` shows the new paragraph and date. (The `capacity`/`removed` messages are covered by Task 6 tests; no live server needed.)

- [ ] **Step 6: Commit**

```bash
git add src/i18n/pt-PT.ts src/features/sync/sync-store.ts src/features/settings/SettingsPage.tsx src/features/invoices/OriginalButton.tsx
git commit -m "feat(ui): free plan limits in settings, originals and privacy page"
```

---

### Task 8b: Administrator badge

The server is the only one that knows who is an administrator, so the app learns it only with sync on (CLAUDE.md rule 1). It comes in the pull answer the app already requests on every sync: no extra requests.

**Files:**
- Modify: `server/src/app.ts` (`GET /v1/changes` answer), `server/src/app.test.ts`
- Modify: `src/sync/api.ts` (pull schema), `src/sync/engine.ts` (`SyncResult.admin`), `src/db/profiles.ts` (`ProfileSync.admin`), `src/sync/account.ts` (`runSync` stores it)
- Modify: `src/app/AppShell.tsx`, `src/index.css`, `src/features/settings/SettingsPage.tsx`, `src/i18n/pt-PT.ts`
- Test: `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: `isAdmin` (Task 2).
- Produces: `GET /v1/changes` → `{ records, latest, more, admin: boolean }`; `SyncResult.admin: boolean`; `ProfileSync.admin?: boolean`.

- [ ] **Step 1: Failing tests**

`server/src/app.test.ts`, in `describe('files', …)` after the administrators test (same server setup):

```ts
  it('tells administrators who they are in the pull answer', async () => {
    handle = createApp({
      sql: memorySql().sql,
      adminEmails: ['admin@example.pt'],
      preloginSecret: 'secret',
      allowedOrigins: [ORIGIN],
      now: () => clock,
    });
    const admin = await register('admin@example.pt');
    const ana = await register('ana@example.pt');
    expect((await call('GET', '/v1/changes', undefined, admin)).body?.admin).toBe(true);
    expect((await call('GET', '/v1/changes', undefined, ana)).body?.admin).toBe(false);
  });
```

`src/sync/sync.test.ts`, in `describe('free plan limits', …)`:

```ts
  it('remembers on the profile whether the account is an administrator', async () => {
    serverWith({ adminEmails: ['ana@example.pt'] });
    const a = await deviceA();
    const { profile } = await runSync({ ...a, api });
    expect(profile.sync?.admin).toBe(true);
  });

  it('ordinary accounts are not administrators', async () => {
    const a = await deviceA();
    const { profile } = await runSync({ ...a, api });
    expect(profile.sync?.admin).toBe(false);
  });
```

Run: `pnpm vitest run server/src/app.test.ts src/sync/sync.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 2: Server**

In `GET /v1/changes`, add to the answer: `admin: isAdmin(user.email),`. In the header comment: `GET /v1/changes?since=N → {records, latest, more, admin}`.

- [ ] **Step 3: App sync**

`src/sync/api.ts` `pull` schema: add `admin: z.boolean()`.

`src/sync/engine.ts`: `SyncResult` gets `/** The server account is an administrator (own limits). */ admin: boolean;`. In `syncNow`, before the pull loop `let admin = false;`, inside the loop after `const page = …` add `admin = page.admin;`, and return `{ …existing, admin }`.

`src/db/profiles.ts` `ProfileSync`: `/** The server says this account is an administrator (shown in the header). */ admin?: boolean;`

`src/sync/account.ts` `runSync`'s `saveSync`: add `admin: result.admin,`.

Fix any other `SyncResult` literals the typecheck reports (tests or mocks) by adding `admin: false`.

- [ ] **Step 4: UI**

`src/i18n/pt-PT.ts`: at the top level next to `signOut`, add `adminBadge: 'Administrador',`; in `settings.account` add `admin: 'Esta conta é de administrador: tem limites próprios no servidor de sincronização.',`.

`src/app/AppShell.tsx`, inside `.topbar-account` before the email:

```tsx
          {session?.profile.sync?.admin && <span className="topbar-badge">{t.adminBadge}</span>}
```

`src/index.css`, after `.topbar-email`:

```css
.topbar-badge {
  padding: 2px 8px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  white-space: nowrap;
}
```

(The badge stays visible on phones, where the email is hidden.)

`src/features/settings/SettingsPage.tsx`, in the account section after the `signedInAs` paragraph:

```tsx
      {session.profile.sync?.admin && <p className="muted">{accountCopy.admin}</p>}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test` — Expected: PASS. In `pnpm dev` (narrow and wide window), with a profile whose `sync.admin` is true (set it in the browser's IndexedDB `faturometro-profiles`), the badge shows in the header and the line in Definições → Conta.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/src/app.test.ts src/sync/api.ts src/sync/engine.ts src/db/profiles.ts src/sync/account.ts src/app/AppShell.tsx src/index.css src/features/settings/SettingsPage.tsx src/i18n/pt-PT.ts src/sync/sync.test.ts
git commit -m "feat: show the administrator badge after login"
```

---

### Task 9: Weekly usage alert

**Files:**
- Create: `scripts/sync-capacity.ts`
- Create: `scripts/sync-capacity.test.ts`
- Create: `.github/workflows/sync-capacity.yml`

**Interfaces:**
- Consumes: `stats` row (Task 4), wrangler `d1 execute --json` output.
- Produces: `parseStats(output: string): UsageStats`, `report(stats: UsageStats, limits?: Limits): { alert: boolean; text: string }`, `LIMITS`, `ALERT_PERCENT = 70`.

- [ ] **Step 1: Check the wrangler output format**

Run (needs the user's `wrangler login` or `CLOUDFLARE_API_TOKEN`; if neither is available, skip and rely on the documented format):

```bash
pnpm exec wrangler d1 execute faturometro --remote -c server/wrangler.toml --json --command "SELECT COUNT(*) AS n FROM users"
```

Expected: a JSON array like `[{"results":[{"n":1}],"success":true,"meta":{…}}]`. If the shape differs, adapt `parseStats` and its test to it.

- [ ] **Step 2: Write the failing test**

`scripts/sync-capacity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseStats, report } from './sync-capacity';

const output = JSON.stringify([
  {
    results: [{ accounts: 150, records_bytes: 100_000_000, files_bytes: 320_000_000, computed_at: '2026-10-14T03:17:00.000Z' }],
    success: true,
    meta: {},
  },
]);

describe('sync capacity report', () => {
  it('reads the stats row from wrangler output', () => {
    expect(parseStats(output)).toEqual({
      accounts: 150,
      records_bytes: 100_000_000,
      files_bytes: 320_000_000,
      computed_at: '2026-10-14T03:17:00.000Z',
    });
  });

  it('fails clearly when the daily job has not run yet', () => {
    expect(() => parseStats(JSON.stringify([{ results: [], success: true }]))).toThrow(/stats/);
  });

  it('alerts at 70% of any limit and reports percentages only', () => {
    const below = report({ accounts: 139, records_bytes: 0, files_bytes: 0, computed_at: 'x' });
    expect(below.alert).toBe(false);
    const above = report(parseStats(output));
    expect(above.alert).toBe(true); // files 320/450 MB = 71%
    expect(above.text).toContain('71%');
    expect(above.text).toContain('75%'); // accounts 150/200
    expect(above.text).not.toMatch(/@/);
  });
});
```

Run: `pnpm vitest run scripts/sync-capacity.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scripts/sync-capacity.ts`**

```ts
/**
 * Weekly check of the sync server's usage (.github/workflows/sync-capacity.yml).
 * Reads `wrangler d1 execute --json` output on stdin, prints a Markdown report
 * and exits with code 2 when a limit passes ALERT_PERCENT. Totals only.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const ALERT_PERCENT = 70;

/** Free plan limits as configured in server/wrangler.toml and server/src/app.ts. */
export const LIMITS = { accounts: 200, records_bytes: 500_000_000, files_bytes: 450_000_000 };
type Limits = typeof LIMITS;

const statsSchema = z.object({
  accounts: z.number(),
  records_bytes: z.number(),
  files_bytes: z.number(),
  computed_at: z.string(),
});
export type UsageStats = z.infer<typeof statsSchema>;

export function parseStats(output: string): UsageStats {
  const parsed = z
    .array(z.object({ results: z.array(z.unknown()) }))
    .parse(JSON.parse(output));
  const row = parsed[0]?.results[0];
  if (!row) throw new Error('No stats row yet: the daily job has not run.');
  return statsSchema.parse(row);
}

export function report(stats: UsageStats, limits: Limits = LIMITS): { alert: boolean; text: string } {
  const rows: [string, number][] = [
    ['Contas', stats.accounts / limits.accounts],
    ['Registos', stats.records_bytes / limits.records_bytes],
    ['Originais', stats.files_bytes / limits.files_bytes],
  ];
  const alert = rows.some(([, share]) => share * 100 >= ALERT_PERCENT);
  const text = [
    `Ocupação do servidor de sincronização (calculada a ${stats.computed_at}):`,
    '',
    '| Recurso | Ocupação |',
    '|---|---|',
    ...rows.map(([name, share]) => `| ${name} | ${Math.floor(share * 100)}% |`),
    '',
    alert
      ? `Pelo menos um recurso passou ${ALERT_PERCENT}%. Opções: apertar as quotas em server/wrangler.toml ou rever o plano (docs/superpowers/specs/2026-10-14-sync-capacity-design.md).`
      : `Tudo abaixo de ${ALERT_PERCENT}%.`,
  ].join('\n');
  return { alert, text };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { alert, text } = report(parseStats(readFileSync(0, 'utf8')));
  console.log(text);
  process.exitCode = alert ? 2 : 0;
}
```

Run: `pnpm vitest run scripts/sync-capacity.test.ts` — Expected: PASS.

- [ ] **Step 4: Workflow `.github/workflows/sync-capacity.yml`**

```yaml
# Weekly usage check of the sync server (only totals, no personal data).
# Above 70% of a free plan limit it opens (or comments on) an issue, so
# GitHub notifies the maintainer by email.
name: Sync capacity

on:
  schedule:
    - cron: '41 7 * * 1' # Mondays, 07:41 UTC
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  check:
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: 228a5886f6ada239609955a875486421
      GH_TOKEN: ${{ github.token }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: corepack enable pnpm && pnpm install --frozen-lockfile
      - name: Read usage
        run: |
          pnpm exec wrangler d1 execute faturometro --remote -c server/wrangler.toml --json \
            --command "SELECT accounts, records_bytes, files_bytes, computed_at FROM stats WHERE id = 1" > stats.json
      - name: Report
        id: report
        run: |
          set +e
          pnpm exec tsx scripts/sync-capacity.ts < stats.json > report.md
          code=$?
          set -e
          cat report.md
          if [ "$code" = "2" ]; then echo "alert=true" >> "$GITHUB_OUTPUT"; elif [ "$code" != "0" ]; then exit "$code"; fi
      - name: Open or update the issue
        if: steps.report.outputs.alert == 'true'
        run: |
          title="Capacidade da sincronização acima de 70%"
          number=$(gh issue list --state open --search "\"$title\" in:title" --json number -q '.[0].number')
          if [ -n "$number" ]; then
            gh issue comment "$number" --body-file report.md
          else
            gh issue create --title "$title" --body-file report.md
          fi
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-capacity.ts scripts/sync-capacity.test.ts .github/workflows/sync-capacity.yml
git commit -m "feat(ops): weekly sync capacity alert"
```

---

### Task 10: Plan, release and production checks

**Files:**
- Modify: `planning/PLAN.md` (§15b and §16)

- [ ] **Step 1: `planning/PLAN.md`**

In §15b, after the "Limites do plano gratuito" bullet, add:

```markdown
- **Capacidade** (`docs/superpowers/specs/2026-10-14-sync-capacity-design.md`): quotas e limites em `server/wrangler.toml` `[vars]` (originais 30 MB por conta, 100 MB para administradores; originais no servidor só dos últimos 12 meses, aplicado pela app; registos 5 MB por conta; 200 contas; novas contas recusadas a 80% de ocupação; contas sem sincronizar há 12 meses apagadas). Administradores no segredo `ADMIN_EMAILS` (`pnpm exec wrangler secret put ADMIN_EMAILS -c server/wrangler.toml`). Tarefa diária (Cron Trigger `17 3 * * *`, `server/src/maintenance.ts`) calcula a ocupação na tabela `stats`; o workflow semanal `sync-capacity.yml` abre uma issue acima de 70%.
```

Add the Cron Trigger free-plan facts confirmed in Task 5 Step 1 to the "Limites do plano gratuito" bullet.

In §16 add rows dated 2026-10-14:

```markdown
| 2026-10-14 | Sincronização sempre dentro do plano gratuito: quando aperta, quem não couber fica sem sincronização, sem custos (pago decide-se mais tarde). Originais no servidor só dos últimos 12 meses (a app apaga só o que tem localmente), quota de registos, travão à entrada a 80%, contas inativas há 12 meses apagadas (marca só com o id aleatório), administrador com quota própria; alerta semanal a 70% |
| 2026-10-14 | Sem pedido de "lotação" antes de ativar a sincronização: a app só contacta o servidor depois de o utilizador a ligar (regra 1) |
```

- [ ] **Step 2: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add planning/PLAN.md
git commit -m "docs(plan): sync capacity limits and decisions"
```

- [ ] **Step 4: Release (ask the user first — outward-facing)**

Ask the user to confirm before each:
1. `pnpm exec wrangler secret put ADMIN_EMAILS -c server/wrangler.toml` with their email (they type it in the prompt; it is never written to a file).
2. `git push` — CI applies migration `0002_capacity.sql` to production D1 and deploys server (with the Cron Trigger) and app.
3. After deploy: run the "Sync capacity" workflow by hand (`gh workflow run sync-capacity.yml`) after the first daily job, or trigger the job once with `pnpm exec wrangler d1 execute faturometro --remote -c server/wrangler.toml --command "SELECT * FROM stats"` to confirm the row exists the next day.
4. Production smoke test on the published app: sync still works for an existing account; Definições shows "Os originais com mais de 12 meses…".
