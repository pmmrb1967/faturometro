/** HTTP client for the sync server (server/src/app.ts). Only encrypted data is sent. */
import { z } from 'zod';
import type { EncryptedBlob, WrappedMasterKey } from '../lib/crypto';

const blobSchema = z.object({ iv: z.string(), data: z.string() });
const wrappedSchema = z.object({
  byPassword: blobSchema,
  byRecoveryKey: blobSchema,
  recoverySalt: z.string(),
});
const remoteRecordSchema = z.object({
  id: z.string(),
  table: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
  enc: blobSchema,
  seq: z.number(),
});

export type ServerWrappedKey = Pick<
  WrappedMasterKey,
  'byPassword' | 'byRecoveryKey' | 'recoverySalt'
>;
export type RemoteRecord = z.infer<typeof remoteRecordSchema>;
export interface OutgoingRecord {
  id: string;
  table: string;
  updatedAt: string;
  deletedAt?: string;
  enc: EncryptedBlob;
}

export class SyncHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Sync server answered ${status}`);
    this.name = 'SyncHttpError';
    this.status = status;
  }
}

export class SyncApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(
    method: string,
    path: string,
    schema: z.ZodType<T> | null,
    options: { body?: unknown; token?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) throw new SyncHttpError(response.status);
    if (!schema) return undefined as T;
    return schema.parse(await response.json());
  }

  prelogin(email: string) {
    return this.call(
      'POST',
      '/v1/prelogin',
      z.object({ salt: z.string(), iterations: z.number() }),
      {
        body: { email },
      },
    );
  }

  register(input: {
    email: string;
    salt: string;
    iterations: number;
    authKey: string;
    wrappedKey: ServerWrappedKey;
  }) {
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

  push(token: string, records: OutgoingRecord[]) {
    return this.call('POST', '/v1/changes', z.object({ latest: z.number() }), {
      body: { records },
      token,
    });
  }

  pull(token: string, since: number) {
    return this.call(
      'GET',
      `/v1/changes?since=${since}`,
      z.object({
        records: z.array(remoteRecordSchema),
        latest: z.number(),
        more: z.boolean(),
        admin: z.boolean(),
        /** Layout contributions waiting (administrators only). */
        contributions: z.number().int().nonnegative().optional(),
      }),
      { token },
    );
  }

  /** Password change: new KDF salt, authentication key and server wrap; signs out other devices. */
  updateKeys(
    token: string,
    input: { authKey: string; salt: string; iterations: number; wrappedKey: ServerWrappedKey },
  ) {
    return this.call('PUT', '/v1/keys', z.object({ token: z.string() }), { body: input, token });
  }

  /** Administrators: usage totals of the server (no per-account data). */
  adminStats(token: string) {
    const count = z.number().int().nonnegative();
    return this.call(
      'GET',
      '/v1/admin/stats',
      z.object({
        accounts: count,
        maxAccounts: count,
        newAccounts: z.object({ days7: count, days30: count }),
        active: z.object({ today: count, days7: count, days30: count }),
        devices: count,
        removedForInactivity30: count,
        recordsBytes: count,
        filesBytes: count,
        contributions: count,
      }),
      { token },
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

  /** Uploads one chunk of base64 ciphertext (text body, no JSON: cheaper for the server). */
  async putChunk(token: string, fileId: string, n: number, total: number, data: string) {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/files/${encodeURIComponent(fileId)}/${n}?total=${total}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: data,
      },
    );
    if (!response.ok) throw new SyncHttpError(response.status);
  }

  async getChunk(token: string, fileId: string, n: number): Promise<string> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/files/${encodeURIComponent(fileId)}/${n}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new SyncHttpError(response.status);
    return response.text();
  }

  deleteAccount(token: string) {
    return this.call('DELETE', '/v1/account', null, { token });
  }
}
