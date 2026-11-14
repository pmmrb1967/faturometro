import { describe, expect, it } from 'vitest';
import { FreeProvider } from './free';
import { GeminiProvider } from './gemini';
import { costMicroUsd, findModel, FREE_AI_MODEL } from './models';
import type { ExtractResponse } from './prompts/extract';
import { aiModelOf, aiModeOf, providerFromSettings } from './session';

/** A made-up telecom invoice, as the model answers it. */
function answer(): ExtractResponse {
  return {
    sector: 'telecom',
    policyNumber: '',
    providerName: 'Operadora Exemplo',
    docId: 'FT 2026/77',
    issueDate: '2026-09-05',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    dueDate: '2026-09-25',
    total: '36.90',
    net: '30.00',
    vat: '6.90',
    customerNumber: '',
    supplyPointId: '',
    tariffName: '',
    powerKva: '',
    loyaltyEndDate: '',
    readingType: '',
    linesIncludeVat: false,
    lines: [],
    readings: [],
  };
}

/** A fake API: answers in order and records the requests. */
function fakeApi(responses: { status: number; body: unknown }[]) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    requests.push({
      url: request.url,
      body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      headers: request.headers,
    });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const source = { kind: 'text' as const, text: 'Fatura | Total | 36,90 €' };

describe('AI mode and model', () => {
  it('keeps Claude for older settings with a key, else the free AI', () => {
    expect(aiModeOf({ aiApiKey: 'sk-ant-x' })).toBe('anthropic');
    expect(aiModeOf({})).toBe('free');
    expect(aiModeOf({ aiMode: 'gemini', aiApiKey: 'sk-ant-x' })).toBe('gemini');
  });

  it("uses each provider's own model, falling back to its default", () => {
    expect(aiModelOf({ aiApiKey: 'k', aiModel: 'claude-opus-5-5' })).toBe('claude-opus-5-5');
    expect(aiModelOf({ aiMode: 'gemini', aiModel: 'claude-opus-5-5' })).toBe(
      'gemini-3.5-flash-lite',
    );
    expect(aiModelOf({ aiMode: 'gemini', aiGeminiModel: 'gemini-3.8-flash' })).toBe(
      'gemini-3.8-flash',
    );
    expect(aiModelOf({})).toBe(FREE_AI_MODEL);
    expect(findModel('nope', 'gemini').id).toBe('gemini-3.5-flash-lite');
  });

  it('builds the chosen provider', () => {
    expect(providerFromSettings({ aiMode: 'gemini', aiGeminiKey: 'AIza-x' })).toBeInstanceOf(
      GeminiProvider,
    );
    expect(providerFromSettings({})).toBeInstanceOf(FreeProvider);
    expect(providerFromSettings({ aiMode: 'none' })).toBeUndefined();
    expect(providerFromSettings({ aiMode: 'gemini' })).toBeUndefined();
  });
});

function geminiAnswer(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 150, thoughtsTokenCount: 50 },
  };
}

describe('GeminiProvider', () => {
  it('sends the key in a header and the JSON schema, and reports the cost', async () => {
    const api = fakeApi([{ status: 200, body: geminiAnswer(JSON.stringify(answer())) }]);
    const provider = new GeminiProvider({
      apiKey: 'AIza-test',
      model: 'gemini-3.5-flash-lite',
      fetch: api.fetch,
    });
    const result = await provider.extract(source);
    expect(result.extraction.totalCents?.value).toBe(3690);
    const [request] = api.requests;
    expect(request?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(request?.headers.get('x-goog-api-key')).toBe('AIza-test');
    expect(request?.body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: expect.objectContaining({ type: 'object' }),
    });
    expect(result.usage[0]).toMatchObject({
      inputTokens: 1000,
      outputTokens: 200,
      costMicroUsd: costMicroUsd('gemini-3.5-flash-lite', 1000, 200),
    });
  });

  it('sends a scanned PDF as inline data', async () => {
    const api = fakeApi([{ status: 200, body: geminiAnswer(JSON.stringify(answer())) }]);
    const provider = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-3.8-flash',
      fetch: api.fetch,
    });
    await provider.extract({ kind: 'pdf', base64: 'JVBERg==' });
    const contents = api.requests[0]?.body.contents as { parts: unknown[] }[];
    expect(contents[0]?.parts[0]).toEqual({
      inline_data: { mime_type: 'application/pdf', data: 'JVBERg==' },
    });
  });

  it('retries once on an unusable answer, then gives up', async () => {
    const api = fakeApi([
      { status: 200, body: geminiAnswer('not json') },
      { status: 200, body: geminiAnswer('{}') },
    ]);
    const provider = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-3.5-flash-lite',
      fetch: api.fetch,
    });
    await expect(provider.extract(source)).rejects.toMatchObject({ code: 'invalid_output' });
    expect(api.requests).toHaveLength(2);
  });

  it('reports a bad key', async () => {
    const api = fakeApi([
      {
        status: 400,
        body: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid' } },
      },
    ]);
    const provider = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-3.5-flash-lite',
      fetch: api.fetch,
    });
    await expect(provider.testConnection()).rejects.toMatchObject({ code: 'invalid_key' });
  });
});

describe('FreeProvider', () => {
  const server = 'https://sync.example';
  const options = (fetch: typeof globalThis.fetch) => ({
    serverUrl: server,
    deviceId: 'device-aaaaaaaaaaaaaaaa',
    known: ['123456789'],
    fetch,
  });
  const invoice = {
    kind: 'text' as const,
    text: 'Fatura FT 2026/77 | Titular: Joaquim Antunes | NIF 123456789 | Total 36,90 €',
  };
  const ok = (output: string) => ({
    status: 200,
    body: { output, inputTokens: 900, outputTokens: 300, left: 9 },
  });

  it('sends the anonymized text with the device id and checks the answer here', async () => {
    const api = fakeApi([ok(JSON.stringify(answer()))]);
    const result = await new FreeProvider(options(api.fetch)).extract(invoice);
    expect(result.extraction.totalCents?.value).toBe(3690);
    const [request] = api.requests;
    expect(request?.url).toBe(`${server}/v1/ai/free`);
    expect(request?.headers.get('X-Device')).toBe('device-aaaaaaaaaaaaaaaa');
    expect(request?.body.task).toBe('extract');
    expect(request?.body.text).toContain('FT 2026/77');
    expect(request?.body.text).not.toMatch(/Joaquim|Antunes|123456789/);
    expect(result.usage).toEqual([
      expect.objectContaining({ model: FREE_AI_MODEL, costMicroUsd: 0, inputTokens: 900 }),
    ]);
  });

  it('sends photos as images and refuses a scan it cannot turn into images', async () => {
    const api = fakeApi([ok(JSON.stringify(answer()))]);
    const provider = new FreeProvider(options(api.fetch));
    await provider.extract({ kind: 'image', mime: 'image/jpeg', base64: 'AQ==' });
    expect(api.requests[0]?.body.images).toEqual([{ mime: 'image/jpeg', base64: 'AQ==' }]);
    await expect(provider.extract({ kind: 'pdf', base64: 'JVBERg==' })).rejects.toMatchObject({
      code: 'too_large',
    });
  });

  it('does not accept an answer that fails validation', async () => {
    const api = fakeApi([ok('{"sector":"nope"}')]);
    await expect(new FreeProvider(options(api.fetch)).extract(invoice)).rejects.toMatchObject({
      code: 'invalid_output',
    });
  });

  it('reports the daily limits', async () => {
    const api = fakeApi([
      { status: 429, body: { error: 'free_limit' } },
      { status: 503, body: { error: 'free_quota' } },
    ]);
    const provider = new FreeProvider(options(api.fetch));
    await expect(provider.extract(invoice)).rejects.toMatchObject({ code: 'free_limit' });
    await expect(provider.extract(invoice)).rejects.toMatchObject({ code: 'free_quota' });
  });

  it('tests the connection with the status, without spending a reading', async () => {
    const api = fakeApi([{ status: 200, body: { available: true, left: 3, limit: 10 } }]);
    const used = await new FreeProvider(options(api.fetch)).testConnection();
    expect(used.costMicroUsd).toBe(0);
    expect(api.requests[0]?.url).toBe(`${server}/v1/ai/free/status`);
  });
});
