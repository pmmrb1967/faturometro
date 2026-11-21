/**
 * The app's folder in the user's Dropbox (Apps/Faturometro), through the
 * Dropbox API. With "App folder" access the app sees only this folder; its
 * root is "" in every call.
 */
import { z } from 'zod';
import {
  CloudError,
  type CloudDrive,
  type CloudEntry,
  type CloudFile,
  type CloudWriteOptions,
} from './drive';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
/** Waits up to this long when Dropbox asks to slow down; longer ones fail as `throttled`. */
const MAX_WAIT_SECONDS = 30;

/** An access token; `renew` after Dropbox refused the last one. */
export type TokenGetter = (renew?: boolean) => Promise<string>;

export interface DropboxOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const toPath = (path: string) => `/${path.replace(/^\/+/, '')}`;

/** Dropbox-API-Arg must be ASCII: anything else goes as \uXXXX. */
const headerJson = (value: unknown) =>
  JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

const failureSchema = z.object({ error_summary: z.string() }).passthrough();
const revSchema = z.object({ rev: z.string() }).passthrough();
const listSchema = z.object({
  entries: z.array(
    z.object({
      '.tag': z.string(),
      name: z.string(),
      size: z.number().optional(),
      rev: z.string().optional(),
    }),
  ),
  cursor: z.string(),
  has_more: z.boolean(),
});
const accountSchema = z.object({ email: z.string() }).passthrough();

/** A 409 that means "nothing at that path". */
class NotFound extends Error {}

async function failureFor(response: Response): Promise<Error> {
  let summary = '';
  try {
    summary = failureSchema.parse(await response.json()).error_summary;
  } catch {
    // No body to read: the status decides.
  }
  if (response.status === 401) return new CloudError('needs_reconnect');
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    return new CloudError('throttled', Number.isFinite(seconds) ? seconds : undefined);
  }
  if (response.status === 409) {
    if (/(^|\/)not_found(\/|$)/.test(summary)) return new NotFound();
    if (summary.includes('insufficient_space')) return new CloudError('quota_full');
    if (summary.includes('conflict')) return new CloudError('conflict');
  }
  return new CloudError('unexpected');
}

export class Dropbox implements CloudDrive {
  private readonly getToken: TokenGetter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(getToken: TokenGetter, options: DropboxOptions = {}) {
    this.getToken = getToken;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One call: renews the token once when Dropbox refuses it, and waits once when asked to
   * slow down briefly. Throws NotFound for "nothing at that path", else a CloudError.
   */
  private async call(url: string, init: RequestInit): Promise<Response> {
    let renew = false;
    let waited = false;
    for (;;) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${await this.getToken(renew)}`);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, method: 'POST', headers });
      } catch (error) {
        if (error instanceof CloudError) throw error;
        throw new CloudError('offline');
      }
      if (response.ok) return response;
      const error = await failureFor(response);
      if (error instanceof CloudError && error.code === 'needs_reconnect' && !renew) {
        renew = true;
        continue;
      }
      const wait = error instanceof CloudError ? error.retryAfterSeconds : undefined;
      if (!waited && wait !== undefined && wait <= MAX_WAIT_SECONDS) {
        waited = true;
        await this.sleep(wait * 1000);
        continue;
      }
      throw error;
    }
  }

  private rpc(endpoint: string, body?: unknown): Promise<Response> {
    return this.call(
      `${API}/${endpoint}`,
      body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  }

  private static async json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch {
      throw new CloudError('unexpected');
    }
  }

  async read(path: string): Promise<CloudFile | null> {
    let response: Response;
    try {
      response = await this.call(`${CONTENT}/files/download`, {
        headers: { 'Dropbox-API-Arg': headerJson({ path: toPath(path) }) },
      });
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
    let rev: string;
    try {
      rev = revSchema.parse(JSON.parse(response.headers.get('Dropbox-API-Result') ?? '')).rev;
    } catch {
      throw new CloudError('unexpected');
    }
    return { bytes: new Uint8Array(await response.arrayBuffer()), etag: rev };
  }

  async write(
    path: string,
    bytes: Uint8Array,
    options: CloudWriteOptions = {},
  ): Promise<{ etag: string }> {
    const mode =
      options.ifMatch !== undefined
        ? { '.tag': 'update', update: options.ifMatch }
        : options.ifNoneMatch === '*'
          ? 'add'
          : 'overwrite';
    const arg = {
      path: toPath(path),
      mode,
      autorename: false,
      mute: true,
      // A conflict even when the file was deleted or has the same contents.
      ...(options.ifMatch !== undefined ? { strict_conflict: true } : {}),
    };
    try {
      const response = await this.call(`${CONTENT}/files/upload`, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': headerJson(arg),
        },
        body: new Uint8Array(bytes),
      });
      return { etag: (await Dropbox.json(response, revSchema)).rev };
    } catch (error) {
      // "Update" of a file that is no longer there: not the version expected.
      if (error instanceof NotFound) throw new CloudError('conflict');
      throw error;
    }
  }

  async list(folder: string): Promise<CloudEntry[]> {
    const entries: CloudEntry[] = [];
    let page: z.infer<typeof listSchema>;
    try {
      page = await Dropbox.json(
        await this.rpc('files/list_folder', { path: toPath(folder), recursive: false }),
        listSchema,
      );
    } catch (error) {
      if (error instanceof NotFound) return [];
      throw error;
    }
    for (;;) {
      for (const entry of page.entries) {
        if (entry['.tag'] !== 'file') continue;
        entries.push({ name: entry.name, size: entry.size ?? 0, etag: entry.rev ?? '' });
      }
      if (!page.has_more) return entries;
      page = await Dropbox.json(
        await this.rpc('files/list_folder/continue', { cursor: page.cursor }),
        listSchema,
      );
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await this.rpc('files/delete_v2', { path: toPath(path) });
    } catch (error) {
      if (!(error instanceof NotFound)) throw error;
    }
  }

  async account(): Promise<{ label: string }> {
    return {
      label: (await Dropbox.json(await this.rpc('users/get_current_account'), accountSchema)).email,
    };
  }
}
