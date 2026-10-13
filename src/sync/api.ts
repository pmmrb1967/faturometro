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
    return this.call('POST', '/v1/register', z.object({ token: z.string() }), { body: input });
  }

  login(email: string, authKey: string) {
    return this.call(
      'POST',
      '/v1/login',
      z.object({ token: z.string(), wrappedKey: wrappedSchema }),
      { body: { email, authKey } },
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
      z.object({ records: z.array(remoteRecordSchema), latest: z.number(), more: z.boolean() }),
      { token },
    );
  }

  deleteAccount(token: string) {
    return this.call('DELETE', '/v1/account', null, { token });
  }
}
