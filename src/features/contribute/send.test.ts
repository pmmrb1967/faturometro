import { describe, expect, it } from 'vitest';
import { decryptContribution, envelopeSchema, generateMaintainerKeys } from './envelope';
import { ContributionError, sendContribution } from './send';
import type { Contribution } from './skeleton';

const CONTRIBUTION: Contribution = {
  version: 1,
  createdAt: '2026-10-14T00:00:00.000Z',
  issuerNif: '500000000',
  context: { pages: 1 },
  pages: [{ page: 1, width: 595, height: 842, items: [] }],
  qrs: [],
};

function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; body: string }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('sendContribution', () => {
  it('posts an envelope only the maintainer can read', async () => {
    const keys = await generateMaintainerKeys();
    const { fn, calls } = fakeFetch(201, { id: 'x' });
    await sendContribution(CONTRIBUTION, {
      serverUrl: 'https://sync.example',
      fetch: fn,
      publicKey: keys.publicJwk,
    });
    expect(calls[0]!.url).toBe('https://sync.example/v1/contributions');
    const envelope = envelopeSchema.parse(JSON.parse(calls[0]!.body));
    expect(await decryptContribution(envelope, keys.privateJwk)).toEqual(CONTRIBUTION);
  });

  it('maps server and network errors', async () => {
    const keys = await generateMaintainerKeys();
    const send = (fn: typeof fetch) =>
      sendContribution(CONTRIBUTION, {
        serverUrl: 'https://s',
        fetch: fn,
        publicKey: keys.publicJwk,
      });
    await expect(send(fakeFetch(503, { error: 'contributions_full' }).fn)).rejects.toMatchObject({
      code: 'full',
    });
    await expect(send(fakeFetch(413).fn)).rejects.toMatchObject({ code: 'too_large' });
    await expect(send(fakeFetch(500).fn)).rejects.toMatchObject({ code: 'failed' });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(send(offline)).rejects.toBeInstanceOf(ContributionError);
    await expect(send(offline)).rejects.toMatchObject({ code: 'offline' });
  });
});
