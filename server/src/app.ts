/**
 * Sync API (PLAN.md §11, "Sincronização opcional"). Receives only email, a
 * client-derived authentication key, wrapped keys and encrypted records.
 *
 *   POST   /v1/prelogin   {email}                         → {salt, iterations}
 *   POST   /v1/register   {email, salt, iterations, authKey, wrappedKey} → {token, accountId}
 *   POST   /v1/login      {email, authKey}                → {token, wrappedKey, accountId}
 *   GET    /v1/account                                    → {id}
 *   GET    /v1/admin/stats                                → totals only (administrators)
 *   GET    /v1/removed/:accountId                         → {removed}  (no token; random id only)
 *   POST   /v1/logout                                     → 204
 *   GET    /v1/changes?since=N                            → {records, latest, more, admin, contributions?}
 *          (contributions: layout contributions waiting, for administrators only)
 *   POST   /v1/changes    {records}                       → {latest}
 *   PUT    /v1/keys       {authKey, salt, iterations, wrappedKey} → 204  (password change)
 *   DELETE /v1/account                                    → 204  (deletes everything)
 *
 * Original files (optional, separate database), as base64 ciphertext chunks:
 *   GET    /v1/files/usage                                → {used, quota}
 *   PUT    /v1/files/:id/:n?total=T   (text body)         → 204, or 507 when storage is full
 *   GET    /v1/files/:id/:n                               → text body, header X-Chunks: T
 *   DELETE /v1/files/:id                                  → 204
 *
 * Layout contributions (anonymized, encrypted in the app for the maintainer only):
 *   POST   /v1/contributions  {v, epk, iv, data}          → 201 {id}; 413, or 503 when full
 *   GET    /v1/contributions  (Bearer CONTRIB_ADMIN_TOKEN) → {contributions: [{id, createdAt, envelope}]}
 *   DELETE /v1/contributions/:id (same token)             → 204
 */
import { z } from 'zod';
import type { Sql } from './db';

export interface AppConfig {
  sql: Sql;
  /** Secret for fake KDF salts of unknown emails (no account enumeration). */
  preloginSecret: string;
  /** Origins allowed to call the API (the app), e.g. https://faturometro.pages.dev */
  allowedOrigins: string[];
  now?: () => Date;
  /** Database for original files; without it the file routes answer 404. */
  files?: Sql;
  /** Per-account file storage, in base64 characters. */
  fileQuotaBytes?: number;
  /** Cap for all accounts together (the free D1 database holds 500 MB). */
  filesTotalBytes?: number;
  /** Emails (normalized) of administrator accounts: own quota, no originals window, never removed. */
  adminEmails?: string[];
  /** Per-account file storage of administrators, in base64 characters. */
  adminFileQuotaBytes?: number;
  /** Months of originals kept on the server, applied by the app (administrators: no limit). */
  keepMonths?: number;
  /** Per-account size of the encrypted records, in characters. */
  recordQuotaBytes?: number;
  /** New accounts are refused at this many accounts. */
  maxAccounts?: number;
  /** New accounts are refused when stored usage reaches this share (%) of a database. */
  admissionPercent?: number;
  /** Space for records (the free D1 database holds 500 MB). */
  recordsTotalBytes?: number;
  /** Minimum client KDF iterations accepted (tests use fewer). */
  minIterations?: number;
  /** Secret that lets the maintainer list and delete layout contributions. */
  contribAdminToken?: string;
  /** Layout contributions accepted per day (UTC). */
  contribDailyMax?: number;
  /** Space for stored contributions, in characters. */
  contribTotalBytes?: number;
}

export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;
export const MAX_RECORDS_PER_REQUEST = 500;
const MAX_ENC_LENGTH = 1_000_000;
/** One push becomes one SQL parameter; D1 strings are limited to 2 MB. */
export const MAX_BATCH_LENGTH = 1_900_000;
export const DEFAULT_ITERATIONS = 600_000;
export const FILE_QUOTA_BYTES = 30_000_000;
export const ADMIN_FILE_QUOTA_BYTES = 100_000_000;
export const KEEP_MONTHS = 12;
export const RECORD_QUOTA_BYTES = 5_000_000;
export const MAX_ACCOUNTS = 200;
export const ADMISSION_PERCENT = 80;
export const RECORDS_TOTAL_BYTES = 500_000_000;
export const FILES_TOTAL_BYTES = 450_000_000;
export const CONTRIB_DAILY_MAX = 30;
export const CONTRIB_TOTAL_BYTES = 20_000_000;
/** Raw request body of one contribution, in characters. */
export const MAX_CONTRIBUTION_LENGTH = 400_000;
const CONTRIBUTIONS_PER_PAGE = 20;
/** Chunk of base64 ciphertext (D1 values are limited to 2 MB). */
export const MAX_CHUNK_LENGTH = 1_000_000;
const MAX_CHUNKS = 30;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const base64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .max(MAX_ENC_LENGTH);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const blob = z.object({ iv: base64, data: base64 });
const wrappedKey = z.object({
  byPassword: blob,
  byRecoveryKey: blob,
  recoverySalt: base64,
});
const record = z.object({
  id: z.string().min(1).max(200),
  table: z.string().regex(/^[a-zA-Z]{1,40}$/),
  updatedAt: z.string().max(40),
  deletedAt: z.string().max(40).optional(),
  enc: blob,
});
export type SyncRecord = z.infer<typeof record>;

export const MIN_ITERATIONS = 100_000;

/** Same shape as src/features/contribute/envelope.ts (the server does not import from src/). */
const envelope = z.object({
  v: z.literal(1),
  epk: z
    .object({
      kty: z.literal('EC'),
      crv: z.literal('P-256'),
      x: z.string().max(100),
      y: z.string().max(100),
    })
    .passthrough(),
  iv: z.string().max(40),
  data: z.string().max(MAX_CONTRIBUTION_LENGTH),
});

const schemas = {
  prelogin: z.object({ email }),
  register: z.object({
    email,
    salt: base64,
    iterations: z.number().int().max(10_000_000),
    authKey: hex64,
    wrappedKey,
  }),
  login: z.object({ email, authKey: hex64 }),
  push: z.object({ records: z.array(record).max(MAX_RECORDS_PER_REQUEST) }),
  keys: z.object({
    authKey: hex64,
    salt: base64,
    iterations: z.number().int().max(10_000_000),
    wrappedKey,
  }),
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time comparison of equal-length hex strings (also used for the admin token). */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function fakeSalt(secret: string, address: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(address)));
  return toBase64(mac.slice(0, 16));
}

interface UserRow {
  id: string;
  email: string;
  kdf_salt: string;
  kdf_iterations: number;
  auth_hash: string;
  wrapped_key: string;
  seq: number;
  failed_logins: number;
  locked_until: string | null;
  /** Day of the last authenticated request (YYYY-MM-DD). */
  last_seen_at: string;
  /** Size of the encrypted records, refreshed daily and grown by each push. */
  records_bytes: number;
}

export function createApp(config: AppConfig) {
  const { sql } = config;
  const now = () => (config.now ?? (() => new Date()))();
  const today = () => now().toISOString().slice(0, 10);
  const isAdmin = (address: string) => (config.adminEmails ?? []).includes(address);
  const fileQuota = (user: UserRow) =>
    isAdmin(user.email)
      ? (config.adminFileQuotaBytes ?? ADMIN_FILE_QUOTA_BYTES)
      : (config.fileQuotaBytes ?? FILE_QUOTA_BYTES);

  /** Totals for the administrator: no emails, no per-account rows. */
  async function adminStats() {
    const daysAgo = (days: number) =>
      new Date(now().getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const row = await sql.first<{
      accounts: number;
      new7: number;
      new30: number;
      active1: number;
      active7: number;
      active30: number;
      devices: number;
      removed30: number;
      records_bytes: number | null;
      files_bytes: number | null;
      contributions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS accounts,
         (SELECT COUNT(*) FROM users WHERE created_at >= ?1) AS new7,
         (SELECT COUNT(*) FROM users WHERE created_at >= ?2) AS new30,
         (SELECT COUNT(*) FROM users WHERE last_seen_at >= ?3) AS active1,
         (SELECT COUNT(*) FROM users WHERE last_seen_at >= ?1) AS active7,
         (SELECT COUNT(*) FROM users WHERE last_seen_at >= ?2) AS active30,
         (SELECT COUNT(*) FROM sessions WHERE expires_at > ?4) AS devices,
         (SELECT COUNT(*) FROM removed_accounts WHERE removed_at >= ?2) AS removed30,
         (SELECT SUM(records_bytes) FROM users) AS records_bytes,
         (SELECT files_bytes FROM stats WHERE id = 1) AS files_bytes,
         (SELECT COUNT(*) FROM contributions) AS contributions`,
      daysAgo(7),
      daysAgo(30),
      today(),
      now().toISOString(),
    );
    // Originals: counted now when the files database is here (the daily stats can be a day old).
    const files = await config.files?.first<{ used: number | null }>(
      'SELECT SUM(size) AS used FROM chunks',
    );
    return {
      accounts: row?.accounts ?? 0,
      maxAccounts: config.maxAccounts ?? MAX_ACCOUNTS,
      newAccounts: { days7: row?.new7 ?? 0, days30: row?.new30 ?? 0 },
      active: { today: row?.active1 ?? 0, days7: row?.active7 ?? 0, days30: row?.active30 ?? 0 },
      devices: row?.devices ?? 0,
      removedForInactivity30: row?.removed30 ?? 0,
      recordsBytes: row?.records_bytes ?? 0,
      recordsTotalBytes: config.recordsTotalBytes ?? RECORDS_TOTAL_BYTES,
      filesBytes: files ? (files.used ?? 0) : (row?.files_bytes ?? 0),
      filesTotalBytes: config.filesTotalBytes ?? FILES_TOTAL_BYTES,
      contributions: row?.contributions ?? 0,
    };
  }

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

  async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new HttpError(400, 'Invalid request');
    return parsed.data;
  }

  async function newSession(userId: string): Promise<string> {
    const token = toBase64(crypto.getRandomValues(new Uint8Array(32)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const expires = new Date(now().getTime() + SESSION_DAYS * 86_400_000).toISOString();
    await sql.run(
      'DELETE FROM sessions WHERE user_id = ? AND expires_at < ?',
      userId,
      now().toISOString(),
    );
    await sql.run(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      await sha256Hex(token),
      userId,
      expires,
    );
    return token;
  }

  async function userFromToken(request: Request): Promise<UserRow> {
    const token = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) throw new HttpError(401, 'Missing token');
    const user = await sql.first<UserRow>(
      'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?',
      await sha256Hex(token),
      now().toISOString(),
    );
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
  }

  /** The body as text, refusing (413) as soon as it grows past `max` bytes. */
  async function readCapped(request: Request, max: number): Promise<string> {
    const reader = request.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, 'Too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  function isMaintainer(request: Request): boolean {
    const expected = config.contribAdminToken;
    const token = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    return Boolean(expected && token && sameHex(token, expected));
  }

  async function contributions(request: Request, method: string, path: string) {
    if (method === 'POST' && path === '/v1/contributions') {
      // Checked before reading, so a huge body is never loaded in memory.
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_CONTRIBUTION_LENGTH) {
        throw new HttpError(413, 'Too large');
      }
      const text = await readCapped(request, MAX_CONTRIBUTION_LENGTH);
      if (text.length > MAX_CONTRIBUTION_LENGTH) throw new HttpError(413, 'Too large');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new HttpError(400, 'Invalid JSON');
      }
      if (!envelope.safeParse(parsed).success) throw new HttpError(400, 'Invalid request');
      const stored = await sql.first<{ bytes: number }>(
        'SELECT COALESCE(SUM(size), 0) AS bytes FROM contributions',
      );
      const todays = await sql.first<{ n: number }>(
        'SELECT COUNT(*) AS n FROM contributions WHERE created_at >= ?',
        today(),
      );
      if (
        (todays?.n ?? 0) >= (config.contribDailyMax ?? CONTRIB_DAILY_MAX) ||
        (stored?.bytes ?? 0) + text.length > (config.contribTotalBytes ?? CONTRIB_TOTAL_BYTES)
      ) {
        throw new HttpError(503, 'contributions_full');
      }
      const id = crypto.randomUUID();
      await sql.run(
        'INSERT INTO contributions (id, created_at, size, envelope) VALUES (?, ?, ?, ?)',
        id,
        now().toISOString(),
        text.length,
        text,
      );
      return json({ id }, 201);
    }
    if (!isMaintainer(request)) throw new HttpError(401, 'Unauthorized');
    if (method === 'GET' && path === '/v1/contributions') {
      const rows = await sql.all<{ id: string; created_at: string; envelope: string }>(
        'SELECT id, created_at, envelope FROM contributions ORDER BY created_at LIMIT ?',
        CONTRIBUTIONS_PER_PAGE,
      );
      return json({
        contributions: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          envelope: JSON.parse(row.envelope) as unknown,
        })),
      });
    }
    const one = /^\/v1\/contributions\/([0-9a-f-]{36})$/.exec(path);
    if (method === 'DELETE' && one) {
      await sql.run('DELETE FROM contributions WHERE id = ?', one[1] ?? '');
      return new Response(null, { status: 204 });
    }
    throw new HttpError(404, 'Not found');
  }

  async function route(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const method = request.method;

    if (method === 'POST' && path === '/v1/prelogin') {
      const { email: address } = await body(request, schemas.prelogin);
      const user = await sql.first<UserRow>('SELECT * FROM users WHERE email = ?', address);
      return json({
        salt: user?.kdf_salt ?? (await fakeSalt(config.preloginSecret, address)),
        iterations: user?.kdf_iterations ?? DEFAULT_ITERATIONS,
      });
    }

    if (method === 'POST' && path === '/v1/register') {
      const input = await body(request, schemas.register);
      if (input.iterations < (config.minIterations ?? MIN_ITERATIONS)) {
        throw new HttpError(400, 'Too few KDF iterations');
      }
      if (await sql.first('SELECT id FROM users WHERE email = ?', input.email)) {
        throw new HttpError(409, 'Email already registered');
      }
      if (!isAdmin(input.email) && !(await admissionOpen())) {
        throw new HttpError(503, 'capacity');
      }
      const id = crypto.randomUUID();
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
    }

    if (method === 'POST' && path === '/v1/login') {
      const input = await body(request, schemas.login);
      const user = await sql.first<UserRow>('SELECT * FROM users WHERE email = ?', input.email);
      if (user?.locked_until && user.locked_until > now().toISOString()) {
        throw new HttpError(429, 'Too many attempts, try later');
      }
      if (!user || !sameHex(await sha256Hex(input.authKey), user.auth_hash)) {
        if (user) {
          const failed = user.failed_logins + 1;
          const locked =
            failed >= MAX_FAILED_LOGINS
              ? new Date(now().getTime() + LOCK_MINUTES * 60_000).toISOString()
              : null;
          await sql.run(
            'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?',
            locked ? 0 : failed,
            locked,
            user.id,
          );
        }
        throw new HttpError(401, 'Wrong email or password');
      }
      await sql.run(
        'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?',
        user.id,
      );
      return json({
        token: await newSession(user.id),
        wrappedKey: JSON.parse(user.wrapped_key) as unknown,
        accountId: user.id,
      });
    }

    const removedRoute = /^\/v1\/removed\/([0-9a-f-]{36})$/.exec(path);
    if (method === 'GET' && removedRoute) {
      const row = await sql.first(
        'SELECT id FROM removed_accounts WHERE id = ?',
        removedRoute[1] ?? '',
      );
      return json({ removed: row !== null });
    }

    if (path === '/v1/contributions' || path.startsWith('/v1/contributions/')) {
      return contributions(request, method, path);
    }

    const user = await userFromToken(request);

    if (method === 'GET' && path === '/v1/account') return json({ id: user.id });
    if (method === 'GET' && path === '/v1/admin/stats') {
      if (!isAdmin(user.email)) throw new HttpError(403, 'Forbidden');
      return json(await adminStats());
    }

    if (method === 'POST' && path === '/v1/logout') {
      const token = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
      await sql.run('DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token));
      return new Response(null, { status: 204 });
    }

    if (method === 'GET' && path === '/v1/changes') {
      const since = Number(url.searchParams.get('since') ?? '0');
      if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'Invalid since');
      const rows = await sql.all<{
        id: string;
        tbl: string;
        updated_at: string;
        deleted_at: string | null;
        enc: string;
        seq: number;
      }>(
        'SELECT id, tbl, updated_at, deleted_at, enc, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?',
        user.id,
        since,
        MAX_RECORDS_PER_REQUEST,
      );
      return json({
        records: rows.map((row) => ({
          id: row.id,
          table: row.tbl,
          updatedAt: row.updated_at,
          ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
          enc: JSON.parse(row.enc) as unknown,
          seq: row.seq,
        })),
        latest: rows.at(-1)?.seq ?? since,
        more: rows.length === MAX_RECORDS_PER_REQUEST,
        admin: isAdmin(user.email),
        // The maintainer learns in the app that contributions are waiting to be pulled.
        ...(isAdmin(user.email)
          ? {
              contributions:
                (await sql.first<{ n: number }>('SELECT COUNT(*) AS n FROM contributions'))?.n ?? 0,
            }
          : {}),
      });
    }

    if (method === 'POST' && path === '/v1/changes') {
      const { records } = await body(request, schemas.push);
      // One last-write-wins upsert for the whole batch (D1 on the free plan
      // allows only 50 queries per request); an equal timestamp is the same
      // change coming back, so it is skipped. The last entry per id counts.
      const batch = JSON.stringify(
        [...new Map(records.map((item) => [item.id, item])).values()].map((item) => ({
          id: item.id,
          tbl: item.table,
          updated_at: item.updatedAt,
          deleted_at: item.deletedAt ?? null,
          enc: JSON.stringify(item.enc),
        })),
      );
      if (batch.length > MAX_BATCH_LENGTH) throw new HttpError(413, 'Batch too large');
      // Only the rows the upsert below will write count: repeats of stored
      // records (another device sending them back) and shrinking changes
      // (deletions) never hit the quota.
      const incoming = `
         FROM (
           SELECT key AS pos, value ->> 'id' AS id, value ->> 'tbl' AS tbl,
             value ->> 'updated_at' AS updated_at, value ->> 'deleted_at' AS deleted_at,
             value ->> 'enc' AS enc
           FROM json_each(?3)
         ) AS j
         LEFT JOIN records AS r ON r.user_id = ?1 AND r.id = j.id
         WHERE r.id IS NULL OR r.updated_at < j.updated_at`;
      const delta =
        (
          await sql.first<{ delta: number | null }>(
            `SELECT SUM(LENGTH(j.enc) - COALESCE(LENGTH(r.enc), 0)) AS delta ${incoming}`,
            user.id,
            user.seq,
            batch,
          )
        )?.delta ?? 0;
      if (
        delta > 0 &&
        user.records_bytes + delta > (config.recordQuotaBytes ?? RECORD_QUOTA_BYTES)
      ) {
        throw new HttpError(507, 'Record storage full');
      }
      await sql.run(
        `INSERT INTO records (user_id, id, tbl, updated_at, deleted_at, enc, seq)
         SELECT ?1, j.id, j.tbl, j.updated_at, j.deleted_at, j.enc, ?2 + ROW_NUMBER() OVER (ORDER BY j.pos)
         ${incoming}
         ON CONFLICT (user_id, id) DO UPDATE SET tbl = excluded.tbl, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, enc = excluded.enc, seq = excluded.seq`,
        user.id,
        user.seq,
        batch,
      );
      const latest =
        (
          await sql.first<{ seq: number | null }>(
            'SELECT MAX(seq) AS seq FROM records WHERE user_id = ?',
            user.id,
          )
        )?.seq ?? user.seq;
      await sql.run(
        'UPDATE users SET seq = ?, records_bytes = MAX(0, records_bytes + ?) WHERE id = ?',
        Math.max(latest, user.seq),
        delta,
        user.id,
      );
      return json({ latest: Math.max(latest, user.seq) });
    }

    if (method === 'PUT' && path === '/v1/keys') {
      const input = await body(request, schemas.keys);
      if (input.iterations < (config.minIterations ?? MIN_ITERATIONS)) {
        throw new HttpError(400, 'Too few KDF iterations');
      }
      await sql.run(
        'UPDATE users SET kdf_salt = ?, kdf_iterations = ?, auth_hash = ?, wrapped_key = ? WHERE id = ?',
        input.salt,
        input.iterations,
        await sha256Hex(input.authKey),
        JSON.stringify(input.wrappedKey),
        user.id,
      );
      // Other devices must sign in again with the new password.
      await sql.run('DELETE FROM sessions WHERE user_id = ?', user.id);
      return json({ token: await newSession(user.id) });
    }

    const fileRoute = /^\/v1\/files\/([A-Za-z0-9-]{1,64})(?:\/(\d{1,3}))?$/.exec(path);
    if (path === '/v1/files/usage' || fileRoute) {
      const files = config.files;
      if (!files) throw new HttpError(404, 'File sync is not available');

      if (method === 'GET' && path === '/v1/files/usage') {
        const row = await files.first<{ used: number | null }>(
          'SELECT SUM(size) AS used FROM chunks WHERE user_id = ?',
          user.id,
        );
        return json({
          used: row?.used ?? 0,
          quota: fileQuota(user),
          keepMonths: isAdmin(user.email) ? null : (config.keepMonths ?? KEEP_MONTHS),
        });
      }
      const [, fileId, chunk] = fileRoute ?? [];

      if (method === 'PUT' && fileId && chunk !== undefined) {
        const n = Number(chunk);
        const total = Number(url.searchParams.get('total'));
        if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS || n >= total) {
          throw new HttpError(400, 'Invalid chunk');
        }
        const data = await request.text();
        if (data.length === 0 || data.length > MAX_CHUNK_LENGTH || !BASE64.test(data)) {
          throw new HttpError(400, 'Invalid chunk');
        }
        const usage = await files.first<{ mine: number | null; everyone: number | null }>(
          `SELECT SUM(CASE WHEN user_id = ?1 THEN size END) AS mine, SUM(size) AS everyone
           FROM chunks WHERE NOT (user_id = ?1 AND file_id = ?2 AND n = ?3)`,
          user.id,
          fileId,
          n,
        );
        if (
          (usage?.mine ?? 0) + data.length > fileQuota(user) ||
          (usage?.everyone ?? 0) + data.length > (config.filesTotalBytes ?? FILES_TOTAL_BYTES)
        ) {
          throw new HttpError(507, 'File storage full');
        }
        await files.run(
          `INSERT INTO chunks (user_id, file_id, n, total, size, data) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, file_id, n) DO UPDATE SET total = excluded.total,
             size = excluded.size, data = excluded.data`,
          user.id,
          fileId,
          n,
          total,
          data.length,
          data,
        );
        return new Response(null, { status: 204 });
      }

      if (method === 'GET' && fileId && chunk !== undefined) {
        const row = await files.first<{ total: number; data: string }>(
          'SELECT total, data FROM chunks WHERE user_id = ? AND file_id = ? AND n = ?',
          user.id,
          fileId,
          Number(chunk),
        );
        if (!row) throw new HttpError(404, 'Not found');
        return new Response(row.data, {
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            'X-Chunks': String(row.total),
          },
        });
      }

      if (method === 'DELETE' && fileId && chunk === undefined) {
        await files.run('DELETE FROM chunks WHERE user_id = ? AND file_id = ?', user.id, fileId);
        return new Response(null, { status: 204 });
      }
      throw new HttpError(404, 'Not found');
    }

    if (method === 'DELETE' && path === '/v1/account') {
      await config.files?.run('DELETE FROM chunks WHERE user_id = ?', user.id);
      await sql.run('DELETE FROM records WHERE user_id = ?', user.id);
      await sql.run('DELETE FROM sessions WHERE user_id = ?', user.id);
      await sql.run('DELETE FROM users WHERE id = ?', user.id);
      return new Response(null, { status: 204 });
    }

    throw new HttpError(404, 'Not found');
  }

  function cors(request: Request, response: Response): Response {
    const origin = request.headers.get('Origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
      response.headers.set('Access-Control-Expose-Headers', 'X-Chunks');
    }
    return response;
  }

  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (origin && !config.allowedOrigins.includes(origin)) {
      return json({ error: 'Origin not allowed' }, 403);
    }
    if (request.method === 'OPTIONS') {
      return cors(
        request,
        new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        }),
      );
    }
    try {
      return cors(request, await route(request, new URL(request.url)));
    } catch (error) {
      // Never echo request contents in errors or logs.
      if (error instanceof HttpError)
        return cors(request, json({ error: error.message }, error.status));
      return cors(request, json({ error: 'Server error' }, 500));
    }
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
