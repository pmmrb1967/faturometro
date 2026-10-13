import { describe, expect, it } from 'vitest';
import { validateExtraction } from '../features/ingest/validate';
import { parseFiscalQr } from '../qr/parse';
import { AnthropicProvider } from './anthropic';
import { documentText, invoiceSource } from './document';
import { costMicroUsd } from './models';
import { toExtraction, type ExtractResponse } from './prompts/extract';
import { AiError } from './provider';

function answer(overrides: Partial<ExtractResponse> = {}): ExtractResponse {
  return {
    sector: 'telecom',
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
    tariffName: 'Pacote Casa',
    powerKva: '',
    loyaltyEndDate: '2027-03-31',
    readingType: '',
    linesIncludeVat: false,
    lines: [
      {
        kind: 'base_fee',
        description: 'Mensalidade',
        amount: '35.00',
        quantity: '',
        unit: '',
        period: '',
        vatRate: '23',
        basis: '',
      },
      {
        kind: 'discount',
        description: 'Desconto',
        amount: '-5.00',
        quantity: '',
        unit: '',
        period: '',
        vatRate: '23',
        basis: '',
      },
    ],
    readings: [],
    ...overrides,
  };
}

// Synthetic QR: total 36,90 €, VAT 6,90 € (23% on 30,00 €), issued 2026-09-05.
const qr = (() => {
  const result = parseFiscalQr(
    'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260905*G:FT 2026/77*H:A-1*I1:PT*I7:30.00*I8:6.90*N:6.90*O:36.90*Q:abcd*R:1',
  );
  if (!result.ok) throw new Error('bad QR');
  return result.qr;
})();

describe('toExtraction', () => {
  it('converts amounts to integer cents and keeps only what is there', () => {
    const { extraction, providerName } = toExtraction(answer());
    expect(providerName).toBe('Operadora Exemplo');
    expect(extraction.totalCents).toEqual({ value: 3690, confidence: 'high' });
    expect(extraction.netCents?.value).toBe(3000);
    expect(extraction.lines.map((line) => line.amountCents)).toEqual([3500, -500]);
    expect(extraction.lines[0]?.vatRate).toBe(23);
    expect(extraction.customerNumber).toBeUndefined();
    expect(extraction.powerKva).toBeUndefined();
    expect(extraction.loyaltyEndDate?.value).toBe('2027-03-31');
  });

  it('drops impossible dates and lines without a readable amount', () => {
    const { extraction } = toExtraction(
      answer({
        issueDate: '2026-02-30',
        periodEnd: '30/09/2026',
        lines: [{ ...answer().lines[0]!, amount: 'trinta' }],
      }),
    );
    expect(extraction.issueDate).toBeUndefined();
    expect(extraction.periodEnd).toBeUndefined();
    expect(extraction.lines).toEqual([]);
    expect(extraction.warnings).toHaveLength(1);
  });

  it('goes through the same QR cross-validation as the parsers', () => {
    expect(validateExtraction(toExtraction(answer()).extraction, qr).validation).toBe('passed');
    const wrong = validateExtraction(toExtraction(answer({ total: '39.90' })).extraction, qr);
    expect(wrong.validation).toBe('failed');
    expect(wrong.failures).toContain('total');
  });
});

describe('documentText and invoiceSource', () => {
  const page = {
    items: [
      { str: 'Total', x: 10, y: 100, width: 20, height: 8 },
      { str: '36,90 €', x: 200, y: 100, width: 30, height: 8 },
      { str: 'Fatura', x: 10, y: 50, width: 20, height: 8 },
    ],
  } as never;

  it('sends the text of PDFs that have one, row by row', () => {
    expect(documentText([page])).toBe('--- Página 1 ---\nFatura\nTotal | 36,90 €');
    const source = invoiceSource({
      pages: [page],
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
      fileKind: 'pdf',
      protectedPdf: true,
    });
    expect(source?.kind).toBe('text');
  });

  it('sends scanned PDFs and photos as files, except password-protected PDFs', () => {
    const empty = { items: [] } as never;
    const base = { pages: [empty], bytes: new Uint8Array([1, 2]), protectedPdf: false };
    expect(invoiceSource({ ...base, mime: 'application/pdf', fileKind: 'pdf' })?.kind).toBe('pdf');
    expect(
      invoiceSource({ ...base, mime: 'application/pdf', fileKind: 'pdf', protectedPdf: true }),
    ).toBeUndefined();
    expect(invoiceSource({ ...base, mime: 'image/jpeg', fileKind: 'image' })?.kind).toBe('image');
    expect(invoiceSource({ ...base, mime: 'image/heic', fileKind: 'image' })).toBeUndefined();
  });
});

/** A fake api.anthropic.com: answers in order and records the requests. */
function fakeApi(responses: { status: number; body: unknown }[]) {
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      body: JSON.parse(await request.text()) as Record<string, unknown>,
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

function message(text: string, usage = { input_tokens: 1000, output_tokens: 200 }) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  };
}

const source = { kind: 'text' as const, text: 'Fatura | Total | 36,90 €' };

describe('AnthropicProvider', () => {
  it('asks for the JSON schema, validates the answer and reports the cost', async () => {
    const api = fakeApi([{ status: 200, body: message(JSON.stringify(answer())) }]);
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      model: 'claude-haiku-5-5',
      fetch: api.fetch,
    });
    const result = await provider.extract(source);

    expect(result.extraction.totalCents?.value).toBe(3690);
    const [request] = api.requests;
    expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.headers.get('x-api-key')).toBe('sk-ant-test');
    expect(request?.body.model).toBe('claude-haiku-5-5');
    expect(request?.body.output_config).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema' },
    });
    expect(result.usage).toEqual([
      {
        task: 'extract',
        model: 'claude-haiku-5-5',
        promptVersion: 'extract-v1',
        inputTokens: 1000,
        outputTokens: 200,
        costMicroUsd: costMicroUsd('claude-haiku-5-5', 1000, 200),
      },
    ]);
  });

  it('retries once when the answer does not match the schema, then gives up', async () => {
    const retried = fakeApi([
      { status: 200, body: message('{"sector":"nope"}') },
      { status: 200, body: message(JSON.stringify(answer())) },
    ]);
    const ok = await new AnthropicProvider({
      apiKey: 'k',
      model: 'claude-haiku-5-5',
      fetch: retried.fetch,
    }).extract(source);
    expect(ok.usage).toHaveLength(2);

    const bad = fakeApi([
      { status: 200, body: message('não é JSON') },
      { status: 200, body: message('{}') },
      { status: 200, body: message(JSON.stringify(answer())) },
    ]);
    await expect(
      new AnthropicProvider({ apiKey: 'k', model: 'claude-haiku-5-5', fetch: bad.fetch }).extract(
        source,
      ),
    ).rejects.toMatchObject({ code: 'invalid_output' });
    expect(bad.requests).toHaveLength(2);
  });

  it('maps API errors to codes the app can explain', async () => {
    const unauthorized = fakeApi([
      {
        status: 401,
        body: {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        },
      },
    ]);
    await expect(
      new AnthropicProvider({
        apiKey: 'k',
        model: 'claude-haiku-5-5',
        fetch: unauthorized.fetch,
      }).testConnection(),
    ).rejects.toMatchObject({ code: 'invalid_key' });

    const noCredit = fakeApi([
      {
        status: 400,
        body: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Your credit balance is too low to access the Anthropic API.',
          },
        },
      },
    ]);
    await expect(
      new AnthropicProvider({
        apiKey: 'k',
        model: 'claude-haiku-5-5',
        fetch: noCredit.fetch,
      }).testConnection(),
    ).rejects.toMatchObject({ code: 'no_credit' });
  });

  it('needs a key', () => {
    expect(() => new AnthropicProvider({ apiKey: ' ', model: 'claude-haiku-5-5' })).toThrow(
      AiError,
    );
  });

  it('estimates the cost with the token counting endpoint before sending', async () => {
    const api = fakeApi([{ status: 200, body: { input_tokens: 2500 } }]);
    const estimate = await new AnthropicProvider({
      apiKey: 'k',
      model: 'claude-sonnet-5-5',
      fetch: api.fetch,
    }).estimateExtraction(source);
    expect(api.requests[0]?.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(estimate.inputTokens).toBe(2500);
    expect(estimate.costMicroUsd).toBeCloseTo(costMicroUsd('claude-sonnet-5-5', 2500, 4000));
  });
});
