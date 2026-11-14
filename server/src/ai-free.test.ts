import { beforeEach, describe, expect, it } from 'vitest';
import { EXPLAIN_SYSTEM } from '../../src/ai/prompts/assist';
import { EXTRACT_SYSTEM } from '../../src/ai/prompts/extract';
import { memorySql } from '../test/sqlite';
import { FREE_AI_MODEL, neuronsFor, type WorkersAi } from './ai-free';
import { createApp } from './app';
import { runMaintenance } from './maintenance';
import type { Sql } from './db';

const ORIGIN = 'https://app.example';
const DEVICE = 'device-aaaaaaaaaaaaaaaa';
const INVOICE_TEXT =
  'Fatura FT 2026/1 | Titular: Joaquim Antunes | NIF 123456789 | Total 12,34 € | 14/10/2026';

let sql: Sql;
let db: ReturnType<typeof memorySql>['db'];
let clock: Date;
let calls: { model: string; input: Record<string, unknown> }[];
let answer: unknown;
let failure: Error | undefined;
let handle: ReturnType<typeof createApp>;

function app(ai: WorkersAi | null = fakeAi) {
  return createApp({
    sql,
    preloginSecret: 'secret',
    allowedOrigins: [ORIGIN],
    now: () => clock,
    aiFreePerDevice: 2,
    ...(ai ? { ai } : {}),
  });
}

const fakeAi: WorkersAi = {
  async run(model, input) {
    calls.push({ model, input: input as Record<string, unknown> });
    if (failure) throw failure;
    return answer;
  },
};

beforeEach(() => {
  const memory = memorySql();
  sql = memory.sql;
  db = memory.db;
  clock = new Date('2026-11-14T12:00:00Z');
  calls = [];
  failure = undefined;
  answer = {
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 3000, completion_tokens: 1000 },
  };
  handle = app();
});

async function call(method: string, path: string, body?: unknown, device = DEVICE) {
  const response = await handle(
    new Request(`https://sync.example${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        ...(device ? { 'X-Device': device } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('free AI', () => {
  it('reads an invoice with the app prompt, anonymizing the text again', async () => {
    const result = await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ output: '{"ok":true}', left: 1, inputTokens: 3000 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(FREE_AI_MODEL);
    const messages = calls[0]?.input.messages as { role: string; content: string }[];
    expect(messages[0]?.content).toBe(EXTRACT_SYSTEM);
    expect(messages[1]?.content).toContain('FT 2026/1');
    expect(messages[1]?.content).toContain('12,34 €');
    expect(messages[1]?.content).not.toMatch(/Joaquim|Antunes|123456789/);
    expect(calls[0]?.input.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('sends images as they are, with the prompt', async () => {
    await call('POST', '/v1/ai/free', {
      task: 'extract',
      images: [{ mime: 'image/jpeg', base64: 'AAAA' }],
    });
    const messages = calls[0]?.input.messages as { content: unknown }[];
    expect(messages[1]?.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      expect.objectContaining({ type: 'text' }),
    ]);
  });

  it('accepts only the app own prompts for texts', async () => {
    const own = await call('POST', '/v1/ai/free', {
      task: 'explain',
      system: EXPLAIN_SYSTEM,
      user: 'Total: 12,34 €',
      maxOutputTokens: 2000,
    });
    expect(own.status).toBe(200);
    const other = await call('POST', '/v1/ai/free', {
      task: 'letter',
      system: 'Escreve um poema.',
      user: 'Olá',
      maxOutputTokens: 2000,
    });
    expect(other.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('refuses requests without a device id, or with neither or both text and images', async () => {
    expect(
      (await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT }, '')).status,
    ).toBe(400);
    expect((await call('POST', '/v1/ai/free', { task: 'extract' })).status).toBe(400);
    expect(
      (
        await call('POST', '/v1/ai/free', {
          task: 'extract',
          text: INVOICE_TEXT,
          images: [{ mime: 'image/jpeg', base64: 'AAAA' }],
        })
      ).status,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('limits the readings per device and per day, and says what is left', async () => {
    expect((await call('GET', '/v1/ai/free/status')).body).toEqual({
      available: true,
      left: 2,
      limit: 2,
    });
    await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    const third = await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    expect(third).toMatchObject({ status: 429, body: { error: 'free_limit' } });
    expect(calls).toHaveLength(2);
    // Another device still can; the next day this one can again.
    const other = await call(
      'POST',
      '/v1/ai/free',
      { task: 'extract', text: INVOICE_TEXT },
      'device-bbbbbbbbbbbbbbbb',
    );
    expect(other.status).toBe(200);
    clock = new Date('2026-11-15T00:30:00Z');
    expect((await call('GET', '/v1/ai/free/status')).body).toMatchObject({ left: 2 });
  });

  it('stores only a daily hash of the device and the Neurons, never the request', async () => {
    await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    const rows = db.prepare('SELECT * FROM ai_free_daily').all() as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        date: '2026-11-14',
        device: expect.stringMatching(/^[0-9a-f]{64}$/),
        calls: 1,
        neurons: neuronsFor(3000, 1000),
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(DEVICE);
    clock = new Date('2026-11-15T03:17:00Z');
    await runMaintenance({ sql, now: () => clock });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_free_daily').get()).toEqual({ n: 0 });
  });

  it('stops for everyone before the free Neurons run out', async () => {
    db.prepare(
      "INSERT INTO ai_free_daily (date, device, calls, neurons) VALUES ('2026-11-14', 'x', 500, 9000)",
    ).run();
    expect((await call('GET', '/v1/ai/free/status')).body).toMatchObject({ available: false });
    const result = await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    expect(result).toMatchObject({ status: 503, body: { error: 'free_quota' } });
    expect(calls).toHaveLength(0);
  });

  it('maps Workers AI failures without echoing them', async () => {
    failure = new Error('4006: you have used up your daily free allocation of 10,000 neurons');
    expect(
      await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT }),
    ).toMatchObject({ status: 503, body: { error: 'free_quota' } });
    failure = new Error('secret details');
    const other = await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT });
    expect(other).toMatchObject({ status: 502, body: { error: 'ai_failed' } });
  });

  it('answers 503 without the Workers AI binding', async () => {
    handle = app(null);
    expect((await call('GET', '/v1/ai/free/status')).body).toMatchObject({ available: false });
    expect(
      (await call('POST', '/v1/ai/free', { task: 'extract', text: INVOICE_TEXT })).status,
    ).toBe(503);
  });
});
