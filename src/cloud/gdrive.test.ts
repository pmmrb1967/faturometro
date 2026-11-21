import { describe, expect, it } from 'vitest';
import type { CloudError } from './drive';
import { GoogleDrive } from './gdrive';

const FOLDER = 'application/vnd.google-apps.folder';

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  version: number;
  createdTime: string;
  bytes: Uint8Array;
}

/** A small Google Drive in memory, answering the calls the app makes. */
function fakeGoogleDrive() {
  const files = new Map<string, FakeFile>();
  const failures: Response[] = [];
  const tokens: string[] = [];
  let next = 0;
  let clock = Date.parse('2026-11-21T10:00:00Z');

  const add = (
    name: string,
    parent: string,
    mimeType = 'application/octet-stream',
    bytes: Uint8Array = new Uint8Array(),
  ) => {
    const file: FakeFile = {
      id: `f${++next}`,
      name,
      mimeType,
      parents: [parent],
      version: 1,
      createdTime: new Date((clock += 1000)).toISOString(),
      bytes,
    };
    files.set(file.id, file);
    return file;
  };
  const meta = (file: FakeFile) => ({
    id: file.id,
    name: file.name,
    size: String(file.bytes.length),
    version: String(file.version),
    createdTime: file.createdTime,
  });
  const reply = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  const notFound = () => reply({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404);

  function query(q: string): FakeFile[] {
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const folder = q.includes(`mimeType = '${FOLDER}'`);
    return [...files.values()]
      .filter((file) => name === undefined || file.name === name)
      .filter((file) => parent === undefined || file.parents.includes(parent))
      .filter((file) => !folder || file.mimeType === FOLDER)
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
  }

  async function body(init: RequestInit): Promise<Uint8Array> {
    const value = init.body;
    if (value instanceof Uint8Array) return value;
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    return new Uint8Array();
  }

  /** The metadata and the contents of a multipart/related body. */
  function multipart(bytes: Uint8Array, type: string) {
    const boundary = /boundary=(\S+)/.exec(type)?.[1] ?? '';
    const text = new TextDecoder('latin1').decode(bytes);
    const parts = text.split(`--${boundary}`).slice(1, -1);
    const [first = '', second = ''] = parts.map((part) =>
      part.slice(part.indexOf('\r\n\r\n') + 4, -2),
    );
    const contents = Uint8Array.from(second, (char) => char.charCodeAt(0));
    return {
      metadata: JSON.parse(first) as { name: string; parents: string[]; mimeType?: string },
      contents,
    };
  }

  const uploads = new Map<string, { name: string; parents: string[]; id?: string }>();

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const token = headers.get('Authorization');
    if (token) tokens.push(token);
    const failure = failures.shift();
    if (failure) return failure;
    const path = url.pathname;

    if (path.startsWith('/upload/resumable/')) {
      const session = uploads.get(path);
      if (!session) return notFound();
      const bytes = await body(init);
      const existing = session.id ? files.get(session.id) : undefined;
      if (existing) {
        existing.bytes = bytes;
        existing.version++;
        return reply(meta(existing));
      }
      return reply(
        meta(add(session.name, session.parents[0] ?? 'root', 'application/octet-stream', bytes)),
      );
    }
    if (path === '/drive/v3/about') {
      return reply({ user: { emailAddress: 'ana@gmail.com', displayName: 'Ana' } });
    }
    if (path === '/drive/v3/files' && method === 'GET') {
      const all = query(url.searchParams.get('q') ?? '');
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(start, start + 2);
      return reply({
        files: page.map(meta),
        ...(start + 2 < all.length ? { nextPageToken: String(start + 2) } : {}),
      });
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(new TextDecoder().decode(await body(init))) as {
        name: string;
        parents: string[];
        mimeType: string;
      };
      return reply(meta(add(metadata.name, metadata.parents[0] ?? 'root', metadata.mimeType)));
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (one) {
      const file = files.get(one[1] ?? '');
      if (!file) return notFound();
      if (method === 'DELETE') {
        files.delete(file.id);
        return new Response(null, { status: 204 });
      }
      if (url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(file.bytes));
      return reply(meta(file));
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'multipart') {
        const { metadata, contents } = multipart(
          await body(init),
          headers.get('Content-Type') ?? '',
        );
        return reply(
          meta(
            add(metadata.name, metadata.parents[0] ?? 'root', 'application/octet-stream', contents),
          ),
        );
      }
      if (type === 'resumable') {
        const metadata = JSON.parse(new TextDecoder().decode(await body(init))) as {
          name: string;
          parents: string[];
        };
        const location = `/upload/resumable/${++next}`;
        uploads.set(location, metadata);
        return new Response(null, {
          status: 200,
          headers: { Location: `https://www.googleapis.com${location}` },
        });
      }
    }
    const update = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (update && method === 'PATCH') {
      const file = files.get(update[1] ?? '');
      if (!file) return notFound();
      if (url.searchParams.get('uploadType') === 'resumable') {
        const location = `/upload/resumable/${++next}`;
        uploads.set(location, { name: file.name, parents: file.parents, id: file.id });
        return new Response(null, {
          status: 200,
          headers: { Location: `https://www.googleapis.com${location}` },
        });
      }
      file.bytes = await body(init);
      file.version++;
      return reply(meta(file));
    }
    return reply({ error: { code: 400 } }, 400);
  };

  return { fetch, files, failures, tokens, add, reply, query };
}

function setUp() {
  const google = fakeGoogleDrive();
  let token = 0;
  const slept: number[] = [];
  const drive = new GoogleDrive(
    async (renew) => {
      if (renew) token++;
      return `token-${token}`;
    },
    { fetch: google.fetch, sleep: async (ms) => void slept.push(ms) },
  );
  const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
  return { google, drive, slept, text };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('GoogleDrive', () => {
  it('keeps everything in a Faturometro folder of My Drive, with subfolders', async () => {
    const { google, drive, text } = setUp();
    await drive.write('alteracoes/a.json', bytes('{"a":1}'));
    const root = google.query(
      `name = 'Faturometro' and 'root' in parents and mimeType = '${FOLDER}'`,
    );
    expect(root).toHaveLength(1);
    const sub = google.query(`name = 'alteracoes' and '${root[0]?.id}' in parents`);
    expect(sub).toHaveLength(1);
    expect(text((await drive.read('alteracoes/a.json'))?.bytes)).toBe('{"a":1}');
    expect(await drive.read('alteracoes/b.json')).toBeNull();
    expect(await drive.read('copias/x.zip')).toBeNull();
    expect(google.query(`name = 'copias'`)).toHaveLength(0);
  });

  it('finds the folder another device created, and the oldest when two did', async () => {
    const { google, drive, text } = setUp();
    const older = google.add('Faturometro', 'root', FOLDER);
    google.add('conta.json', older.id, 'application/json', bytes('mais antiga'));
    const newer = google.add('Faturometro', 'root', FOLDER);
    google.add('conta.json', newer.id, 'application/json', bytes('mais recente'));
    expect(text((await drive.read('conta.json'))?.bytes)).toBe('mais antiga');
  });

  it('reads and writes the oldest of two files with the same name', async () => {
    const { google, drive, text } = setUp();
    const root = google.add('Faturometro', 'root', FOLDER);
    google.add('conta.json', root.id, 'application/json', bytes('primeira'));
    google.add('conta.json', root.id, 'application/json', bytes('segunda'));
    expect(text((await drive.read('conta.json'))?.bytes)).toBe('primeira');
    await drive.write('conta.json', bytes('nova'));
    const both = google.query(`name = 'conta.json'`).map((file) => text(file.bytes));
    expect(both).toEqual(['nova', 'segunda']);
  });

  it('uses the file version as the etag, and refuses a write from another version', async () => {
    const { drive } = setUp();
    const { etag } = await drive.write('conta.json', bytes('v1'));
    expect((await drive.read('conta.json'))?.etag).toBe(etag);
    const { etag: second } = await drive.write('conta.json', bytes('v2'), { ifMatch: etag });
    expect(second).not.toBe(etag);
    const stale = await drive
      .write('conta.json', bytes('v3'), { ifMatch: etag })
      .catch((e: unknown) => e);
    expect((stale as CloudError).code).toBe('conflict');
    const exists = await drive
      .write('conta.json', bytes('v4'), { ifNoneMatch: '*' })
      .catch((e: unknown) => e);
    expect((exists as CloudError).code).toBe('conflict');
    const gone = await drive
      .write('outra.json', bytes('x'), { ifMatch: etag })
      .catch((e: unknown) => e);
    expect((gone as CloudError).code).toBe('conflict');
  });

  it('sends big files in a resumable upload', async () => {
    const { google, drive } = setUp();
    const big = new Uint8Array(6 * 1024 * 1024).fill(7);
    await drive.write('copias/grande.zip', big);
    expect((await drive.read('copias/grande.zip'))?.bytes.length).toBe(big.length);
    await drive.write('copias/grande.zip', big.subarray(1));
    expect(google.query(`name = 'grande.zip'`)).toHaveLength(1);
    expect((await drive.read('copias/grande.zip'))?.bytes.length).toBe(big.length - 1);
  });

  it('lists a folder across pages, once per name, and nothing for a missing folder', async () => {
    const { drive } = setUp();
    for (const name of ['a.json', 'b.json', 'c.json']) {
      await drive.write(`alteracoes/${name}`, bytes(name));
    }
    const entries = await drive.list('alteracoes');
    expect(entries.map((entry) => entry.name)).toEqual(['a.json', 'b.json', 'c.json']);
    expect(entries[0]?.size).toBe(6);
    expect(await drive.list('copias')).toEqual([]);
  });

  it('removes every file of that name, and does not fail when none is left', async () => {
    const { google, drive } = setUp();
    const root = google.add('Faturometro', 'root', FOLDER);
    google.add('x.json', root.id);
    google.add('x.json', root.id);
    await drive.remove('x.json');
    expect(google.query(`name = 'x.json'`)).toHaveLength(0);
    await drive.remove('x.json');
  });

  it('turns a full Drive, a slow-down and an expired link into the drive errors', async () => {
    const { google, drive } = setUp();
    await drive.write('a.json', bytes('a'));
    google.failures.push(
      google.reply({ error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }] } }, 403),
    );
    const full = await drive.write('a.json', bytes('b')).catch((e: unknown) => e);
    expect((full as CloudError).code).toBe('quota_full');

    const limited = () =>
      google.reply({ error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } }, 403);
    google.failures.push(limited(), limited());
    const slow = await drive.read('a.json').catch((e: unknown) => e);
    expect((slow as CloudError).code).toBe('throttled');

    const refused = () => google.reply({ error: { code: 401 } }, 401);
    google.failures.push(refused(), refused());
    const expired = await drive.read('a.json').catch((e: unknown) => e);
    expect((expired as CloudError).code).toBe('needs_reconnect');
  });

  it('renews the token once and retries, and waits once on a slow-down', async () => {
    const { google, drive, slept, text } = setUp();
    await drive.write('a.json', bytes('a'));
    google.failures.push(google.reply({ error: { code: 401 } }, 401));
    expect(text((await drive.read('a.json'))?.bytes)).toBe('a');
    expect(google.tokens.at(-1)).toBe('Bearer token-1');
    google.failures.push(google.reply({ error: { code: 429 } }, 429, { 'Retry-After': '3' }));
    expect(text((await drive.read('a.json'))?.bytes)).toBe('a');
    expect(slept).toEqual([3000]);
  });

  it('is offline when the request does not get through', async () => {
    const drive = new GoogleDrive(async () => 't', {
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const error = await drive.read('a.json').catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('offline');
  });

  it('names the account by its email', async () => {
    const { drive } = setUp();
    expect(await drive.account()).toEqual({ label: 'ana@gmail.com' });
  });
});
