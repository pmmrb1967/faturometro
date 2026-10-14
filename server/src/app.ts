/**
 * Sync API (PLAN.md §11, "Sincronização opcional"). Receives only email, a
 * client-derived authentication key, wrapped keys and encrypted records.
 *
 *   POST   /v1/prelogin   {email}                         → {salt, iterations}
 *   POST   /v1/register   {email, salt, iterations, authKey, wrappedKey} → {token, accountId}
 *   POST   /v1/login      {email, authKey}                → {token, wrappedKey, accountId}
 *   GET    /v1/account                                    → {id}
 *   POST   /v1/logout                                     → 204
 *   GET    /v1/changes?since=N                            → {records, latest}
 *   POST   /v1/changes    {records}                       → {latest}
 *   PUT    /v1/keys       {authKey, salt, iterations, wrappedKey} → 204  (password change)
 *   DELETE /v1/account                                    → 204  (deletes everything)
 *
 * Original files (optional, separate database), as base64 ciphertext chunks:
 *   GET    /v1/files/usage                                → {used, quota}
 *   PUT    /v1/files/:id/:n?total=T   (text body)         → 204, or 507 when storage is full
 *   GET    /v1/files/:id/:n                               → text body, header X-Chunks: T
 *   DELETE /v1/files/:id                                  → 204
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
  /** Minimum client KDF iterations accepted (tests use fewer). */
  minIterations?: number;
}

export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;
export const MAX_RECORDS_PER_REQUEST = 500;
const MAX_ENC_LENGTH = 1_000_000;
/** One push becomes one SQL parameter; D1 strings are limited to 2 MB. */
export const MAX_BATCH_LENGTH = 1_900_000;
export const DEFAULT_ITERATIONS = 600_000;
export const FILE_QUOTA_BYTES = 50_000_000;
export const FILES_TOTAL_BYTES = 450_000_000;
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

/** Constant-time comparison of equal-length hex strings. */
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

    const user = await userFromToken(request);

    if (method === 'GET' && path === '/v1/account') return json({ id: user.id });

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
      await sql.run(
        `INSERT INTO records (user_id, id, tbl, updated_at, deleted_at, enc, seq)
         SELECT ?1, j.id, j.tbl, j.updated_at, j.deleted_at, j.enc, ?2 + ROW_NUMBER() OVER (ORDER BY j.pos)
         FROM (
           SELECT key AS pos, value ->> 'id' AS id, value ->> 'tbl' AS tbl,
             value ->> 'updated_at' AS updated_at, value ->> 'deleted_at' AS deleted_at,
             value ->> 'enc' AS enc
           FROM json_each(?3)
         ) AS j
         LEFT JOIN records AS r ON r.user_id = ?1 AND r.id = j.id
         WHERE r.id IS NULL OR r.updated_at < j.updated_at
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
      await sql.run('UPDATE users SET seq = ? WHERE id = ?', Math.max(latest, user.seq), user.id);
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
        return json({ used: row?.used ?? 0, quota: config.fileQuotaBytes ?? FILE_QUOTA_BYTES });
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
          (usage?.mine ?? 0) + data.length > (config.fileQuotaBytes ?? FILE_QUOTA_BYTES) ||
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
