/**
 * The app's folder in the user's Google Drive ("Faturometro" in My Drive),
 * through the Drive API v3. With the `drive.file` permission the app sees only
 * the files it created, never the rest of the user's Drive.
 *
 * Drive has folders of ids, not paths, and names are not unique: a path is
 * resolved folder by folder, and when two files share a name (two devices
 * created it at once) the oldest is the one. Drive has no conditional writes:
 * "only if absent" and "only if unchanged" are checked just before writing
 * (the sync does not rely on them: each device writes only its own files).
 */
import { z } from 'zod';
import {
  CloudError,
  type CloudDrive,
  type CloudEntry,
  type CloudFile,
  type CloudWriteOptions,
} from './drive';
import type { TokenGetter } from './dropbox';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export const GOOGLE_ROOT_FOLDER = 'Faturometro';
/** Above this, a resumable upload. */
const SIMPLE_UPLOAD_MAX = 5 * 1024 * 1024;
/** Waits up to this long when Drive asks to slow down; longer ones fail as `throttled`. */
const MAX_WAIT_SECONDS = 30;
const FIELDS = 'id,name,size,version,createdTime';

export interface GoogleDriveOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const fileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.string().optional(),
  version: z.string().optional(),
  createdTime: z.string().optional(),
});
type DriveFile = z.infer<typeof fileSchema>;
const listSchema = z.object({
  files: z.array(fileSchema),
  nextPageToken: z.string().optional(),
});
const errorSchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }).passthrough(),
});
const aboutSchema = z.object({ user: z.object({ emailAddress: z.string() }).passthrough() });

/** A value inside a Drive query string. */
const quoted = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function errorFor(response: Response): Promise<CloudError> {
  let reasons: string[] = [];
  try {
    reasons = (errorSchema.parse(await response.json()).error.errors ?? []).map((e) => e.reason);
  } catch {
    // No body to read: the status decides.
  }
  if (response.status === 401) return new CloudError('needs_reconnect');
  if (reasons.includes('storageQuotaExceeded')) return new CloudError('quota_full');
  const limited =
    response.status === 429 ||
    reasons.includes('userRateLimitExceeded') ||
    reasons.includes('rateLimitExceeded');
  if (limited) {
    const seconds = Number(response.headers.get('Retry-After') ?? 1);
    return new CloudError('throttled', Number.isFinite(seconds) ? seconds : 1);
  }
  return new CloudError('unexpected');
}

const encoder = new TextEncoder();

/** A multipart/related body: the JSON metadata, then the contents. */
function multipartBody(
  metadata: unknown,
  bytes: Uint8Array,
): { body: Uint8Array<ArrayBuffer>; type: string } {
  const boundary = `faturometro-${crypto.randomUUID()}`;
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, type: `multipart/related; boundary=${boundary}` };
}

export class GoogleDrive implements CloudDrive {
  private readonly getToken: TokenGetter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Folder path ("" is the app's folder) → id. */
  private readonly folders = new Map<string, string>();

  constructor(getToken: TokenGetter, options: GoogleDriveOptions = {}) {
    this.getToken = getToken;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One request: renews the token once when refused, and waits once when asked to slow
   * down briefly. 404 comes back as null; any other failure as a CloudError.
   */
  private async request(url: string, init: RequestInit = {}): Promise<Response | null> {
    let renew = false;
    let waited = false;
    for (;;) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${await this.getToken(renew)}`);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, headers });
      } catch (error) {
        if (error instanceof CloudError) throw error;
        throw new CloudError('offline');
      }
      if (response.ok) return response;
      if (response.status === 404) return null;
      const error = await errorFor(response);
      if (error.code === 'needs_reconnect' && !renew) {
        renew = true;
        continue;
      }
      const wait = error.retryAfterSeconds;
      if (error.code === 'throttled' && !waited && wait !== undefined && wait <= MAX_WAIT_SECONDS) {
        waited = true;
        await this.sleep(wait * 1000);
        continue;
      }
      throw error;
    }
  }

  private async json<T>(response: Response | null, schema: z.ZodType<T>): Promise<T> {
    if (!response) throw new CloudError('unexpected');
    try {
      return schema.parse(await response.json());
    } catch {
      throw new CloudError('unexpected');
    }
  }

  /** Every file matching `query`, oldest first. */
  private async find(query: string): Promise<DriveFile[]> {
    const found: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `${query} and trashed = false`,
        fields: `nextPageToken,files(${FIELDS})`,
        orderBy: 'createdTime',
        spaces: 'drive',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await this.json(
        await this.request(`${API}/files?${params.toString()}`),
        listSchema,
      );
      found.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return found;
  }

  private async createFolder(name: string, parent: string): Promise<string> {
    const response = await this.request(`${API}/files?fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    });
    return (await this.json(response, fileSchema)).id;
  }

  /** The id of a folder path ("" is the app's folder); null when missing and not `create`. */
  private async folder(path: string, create: boolean): Promise<string | null> {
    const known = this.folders.get(path);
    if (known) return known;
    const parts = path === '' ? [] : path.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const name = parts.at(-1) ?? GOOGLE_ROOT_FOLDER;
    const parent = path === '' ? 'root' : await this.folder(parentPath, create);
    if (!parent) return null;
    const query = `name = ${quoted(name)} and ${quoted(parent)} in parents and mimeType = '${FOLDER}'`;
    let id = (await this.find(query))[0]?.id ?? null;
    if (!id && create) {
      const created = await this.createFolder(name, parent);
      // Another device may have created it at the same time: the oldest is everyone's.
      id = (await this.find(query))[0]?.id ?? created;
    }
    if (id) this.folders.set(path, id);
    return id;
  }

  private static split(path: string): { folder: string; name: string } {
    const parts = path.split('/').filter((part) => part !== '');
    return { folder: parts.slice(0, -1).join('/'), name: parts.at(-1) ?? '' };
  }

  /** The files with this path's name, oldest first ([] when its folder is missing). */
  private async filesAt(
    path: string,
    create = false,
  ): Promise<{ parent: string | null; files: DriveFile[] }> {
    const { folder, name } = GoogleDrive.split(path);
    const parent = await this.folder(folder, create);
    if (!parent) return { parent: null, files: [] };
    return {
      parent,
      files: await this.find(`name = ${quoted(name)} and ${quoted(parent)} in parents`),
    };
  }

  async read(path: string): Promise<CloudFile | null> {
    const [file] = (await this.filesAt(path)).files;
    if (!file) return null;
    const contents = await this.request(`${API}/files/${encodeURIComponent(file.id)}?alt=media`);
    if (!contents) return null;
    return { bytes: new Uint8Array(await contents.arrayBuffer()), etag: file.version ?? '' };
  }

  async write(
    path: string,
    bytes: Uint8Array,
    options: CloudWriteOptions = {},
  ): Promise<{ etag: string }> {
    const { parent, files } = await this.filesAt(path, true);
    if (!parent) throw new CloudError('unexpected');
    const [existing] = files;
    if (options.ifNoneMatch === '*' && existing) throw new CloudError('conflict');
    if (options.ifMatch !== undefined && existing?.version !== options.ifMatch) {
      throw new CloudError('conflict');
    }
    const { name } = GoogleDrive.split(path);
    const big = bytes.length > SIMPLE_UPLOAD_MAX;
    let response: Response | null;
    if (existing) {
      const target = `${UPLOAD}/files/${encodeURIComponent(existing.id)}`;
      response = big
        ? await this.resumable(`${target}?uploadType=resumable`, 'PATCH', {}, bytes)
        : await this.request(`${target}?uploadType=media&fields=${FIELDS}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: new Uint8Array(bytes),
          });
    } else if (big) {
      response = await this.resumable(
        `${UPLOAD}/files?uploadType=resumable`,
        'POST',
        { name, parents: [parent] },
        bytes,
      );
    } else {
      const { body, type } = multipartBody({ name, parents: [parent] }, bytes);
      response = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body,
      });
    }
    return { etag: (await this.json(response, fileSchema)).version ?? '' };
  }

  /** A resumable upload in one request: start the session, then send the whole file. */
  private async resumable(
    url: string,
    method: 'POST' | 'PATCH',
    metadata: Record<string, unknown>,
    bytes: Uint8Array,
  ): Promise<Response | null> {
    const started = await this.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(bytes.length),
      },
      body: JSON.stringify(metadata),
    });
    const session = started?.headers.get('Location');
    if (!session) throw new CloudError('unexpected');
    const separator = session.includes('?') ? '&' : '?';
    return this.request(`${session}${separator}fields=${FIELDS}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    });
  }

  async list(folder: string): Promise<CloudEntry[]> {
    const parent = await this.folder(folder, false);
    if (!parent) return [];
    const entries = new Map<string, CloudEntry>();
    for (const file of await this.find(
      `${quoted(parent)} in parents and mimeType != '${FOLDER}'`,
    )) {
      // Oldest first: the first of a name is the one.
      if (!entries.has(file.name)) {
        entries.set(file.name, {
          name: file.name,
          size: Number(file.size ?? 0),
          etag: file.version ?? '',
        });
      }
    }
    return [...entries.values()];
  }

  async remove(path: string): Promise<void> {
    for (const file of (await this.filesAt(path)).files) {
      await this.request(`${API}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
    }
  }

  async account(): Promise<{ label: string }> {
    const about = await this.json(
      await this.request(`${API}/about?fields=user(emailAddress)`),
      aboutSchema,
    );
    return { label: about.user.emailAddress };
  }
}
