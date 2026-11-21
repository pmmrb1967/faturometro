import { describe, expect, it } from 'vitest';
import { CloudError } from './drive';
import { GRAPH_APP_FOLDER, OneDrive, UPLOAD_CHUNK_BYTES } from './onedrive';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | string;
}

type Reply = (call: Call) => Response;

/** A fetch that records each request and answers from a list, in order. */
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body =
      init.body instanceof Uint8Array || typeof init.body === 'string' ? init.body : undefined;
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      ...(body !== undefined ? { body } : {}),
    };
    calls.push(call);
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${call.method} ${call.url}`);
    return reply(call);
  };
  return { calls, impl };
}

const json =
  (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(code === 204 ? null : JSON.stringify({ error: { code: 'x' } }), {
      status: code,
      headers,
    });

function drive(replies: Reply[]) {
  const fetch = fakeFetch(replies);
  const slept: number[] = [];
  const onedrive = new OneDrive(async () => 'token-1', {
    fetch: fetch.impl,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { onedrive, calls: fetch.calls, slept };
}

describe('OneDrive', () => {
  it('reads a file: its version from the item, its contents from the download link', async () => {
    const { onedrive, calls } = drive([
      json({ eTag: '"e1"', '@microsoft.graph.downloadUrl': 'https://download.test/x' }),
      () => new Response(new Uint8Array([1, 2, 3])),
    ]);
    const file = await onedrive.read('conta.json');
    expect(file).toEqual({ bytes: new Uint8Array([1, 2, 3]), etag: '"e1"' });
    expect(calls[0]?.url).toBe(`${GRAPH_APP_FOLDER}:/conta.json:`);
    expect(calls[0]?.headers.authorization).toBe('Bearer token-1');
    expect(calls[1]?.url).toBe('https://download.test/x');
    expect(calls[1]?.headers.authorization).toBeUndefined();
  });

  it('reads a missing file as null', async () => {
    const { onedrive } = drive([status(404)]);
    expect(await onedrive.read('nada.json')).toBeNull();
  });

  it('encodes each part of a path', async () => {
    const { onedrive, calls } = drive([status(404)]);
    await onedrive.read('cópias/a b.zip');
    expect(calls[0]?.url).toBe(`${GRAPH_APP_FOLDER}:/c%C3%B3pias/a%20b.zip:`);
  });

  it('writes a small file in one request, with its conditions', async () => {
    const { onedrive, calls } = drive([json({ eTag: '"e2"' }), json({ eTag: '"e3"' })]);
    const bytes = new Uint8Array([9, 9]);
    expect(await onedrive.write('conta.json', bytes, { ifMatch: '"e1"' })).toEqual({
      etag: '"e2"',
    });
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: `${GRAPH_APP_FOLDER}:/conta.json:/content`,
      body: bytes,
    });
    expect(calls[0]?.headers['if-match']).toBe('"e1"');
    await onedrive.write('conta.json', bytes, { ifNoneMatch: '*' });
    expect(calls[1]?.url).toBe(
      `${GRAPH_APP_FOLDER}:/conta.json:/content?@microsoft.graph.conflictBehavior=fail`,
    );
  });

  it('sends a large file through an upload session, in pieces', async () => {
    const total = 5_000_000;
    const { onedrive, calls } = drive([
      json({ uploadUrl: 'https://upload.test/session' }),
      json({ nextExpectedRanges: [`${UPLOAD_CHUNK_BYTES}-`] }, 202),
      json({ eTag: '"big"' }, 201),
    ]);
    const result = await onedrive.write('copias/grande.zip', new Uint8Array(total));
    expect(result.etag).toBe('"big"');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${GRAPH_APP_FOLDER}:/copias/grande.zip:/createUploadSession`,
    });
    expect(calls[1]?.headers['content-range']).toBe(`bytes 0-${UPLOAD_CHUNK_BYTES - 1}/${total}`);
    expect(calls[1]?.headers.authorization).toBeUndefined();
    expect(calls[2]?.headers['content-range']).toBe(
      `bytes ${UPLOAD_CHUNK_BYTES}-${total - 1}/${total}`,
    );
    expect(calls).toHaveLength(3);
  });

  it('lists only the files of a folder, across pages', async () => {
    const { onedrive, calls } = drive([
      json({
        value: [
          { name: 'a.json', size: 3, eTag: '"1"', file: {} },
          { name: 'pasta', size: 0, eTag: '"2"', folder: {} },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page',
      }),
      json({ value: [{ name: 'b.json', size: 4, eTag: '"3"', file: {} }] }),
    ]);
    expect(await onedrive.list('alteracoes')).toEqual([
      { name: 'a.json', size: 3, etag: '"1"' },
      { name: 'b.json', size: 4, etag: '"3"' },
    ]);
    expect(calls[0]?.url).toContain(`${GRAPH_APP_FOLDER}:/alteracoes:/children`);
    expect(calls[1]?.url).toBe('https://graph.microsoft.com/v1.0/next-page');
  });

  it('lists a missing folder as empty, and removes quietly', async () => {
    const { onedrive, calls } = drive([status(404), status(204), status(404)]);
    expect(await onedrive.list('alteracoes')).toEqual([]);
    await onedrive.remove('a.json');
    await onedrive.remove('a.json');
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: `${GRAPH_APP_FOLDER}:/a.json:` });
  });

  it('waits and tries again once when asked to slow down', async () => {
    const { onedrive, slept } = drive([status(429, { 'retry-after': '1' }), status(204)]);
    await onedrive.remove('a.json');
    expect(slept).toEqual([1000]);
  });

  it('gives up on a long wait, saying how long', async () => {
    const { onedrive } = drive([status(503, { 'retry-after': '120' })]);
    await expect(onedrive.remove('a.json')).rejects.toMatchObject({
      code: 'throttled',
      retryAfterSeconds: 120,
    });
  });

  it('turns answers into the drive’s errors', async () => {
    const cases: [Reply, string][] = [
      [status(401), 'needs_reconnect'],
      [status(412), 'conflict'],
      [status(409), 'conflict'],
      [status(507), 'quota_full'],
      [json({ error: { code: 'quotaLimitReached' } }, 403), 'quota_full'],
      [status(500), 'unexpected'],
      [
        () => {
          throw new TypeError('Failed to fetch');
        },
        'offline',
      ],
    ];
    for (const [reply, code] of cases) {
      const { onedrive } = drive([reply]);
      const error = await onedrive.write('a.json', new Uint8Array([1])).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CloudError);
      expect((error as CloudError).code).toBe(code);
    }
  });

  it('names the account by the signed-in Microsoft account first', async () => {
    const fetch = fakeFetch([json({ owner: {} })]);
    const onedrive = new OneDrive(async () => 'token-1', {
      fetch: fetch.impl,
      label: async () => 'ana@outlook.pt',
    });
    expect(await onedrive.account()).toEqual({ label: 'ana@outlook.pt' });
    expect(fetch.calls).toHaveLength(0);
  });

  it('has no name for a personal drive without its owner’s name (never "OneDrive")', async () => {
    const { onedrive } = drive([json({ owner: {} })]);
    await expect(onedrive.account()).rejects.toBeInstanceOf(CloudError);
  });

  it('names the account', async () => {
    const { onedrive, calls } = drive([json({ owner: { user: { displayName: 'Maria' } } })]);
    expect(await onedrive.account()).toEqual({ label: 'Maria' });
    expect(calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/me/drive?$select=owner');
  });
});
