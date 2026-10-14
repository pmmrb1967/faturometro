import { describe, expect, it } from 'vitest';
import { computeAlerts, type AlertInput } from './alerts';
import type { Contract, Invoice, InvoiceLine, Reading } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    ...META,
    id: 'c1',
    providerId: 'p1',
    sector: 'telecom',
    label: 'Internet',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function invoice(id: string, issueDate: string, totalCents: number, contractId = 'c1'): Invoice {
  return {
    ...META,
    id,
    contractId,
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate,
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: `${issueDate}T10:00:00.000Z`,
  };
}

function line(invoiceId: string, overrides: Partial<InvoiceLine>): InvoiceLine {
  return {
    ...META,
    id: `${invoiceId}-${overrides.kind}-${overrides.unitPrice ?? overrides.amountCents}`,
    invoiceId,
    kind: 'base_fee',
    description: 'x',
    amountCents: 0,
    ...overrides,
  };
}

function reading(invoiceId: string, readingType: Reading['readingType']): Reading {
  return {
    ...META,
    id: `${invoiceId}-r`,
    invoiceId,
    contractId: 'c1',
    quantity: 100,
    unit: 'kWh',
    readingType,
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
  };
}

function input(overrides: Partial<AlertInput>): AlertInput {
  return {
    contracts: [contract()],
    invoices: [],
    lines: [],
    readings: [],
    settings: { priceIncreaseThresholdPct: 5, loyaltyAlertDays: [60, 30, 7] },
    today: '2026-06-01',
    ...overrides,
  };
}

const kinds = (alerts: ReturnType<typeof computeAlerts>) => alerts.map((alert) => alert.kind);

describe('loyalty ending', () => {
  it('alerts at 60, 30 and 7 days, with a new key at each step', () => {
    const at = (today: string) =>
      computeAlerts(input({ contracts: [contract({ loyaltyEndDate: '2026-08-01' })], today }));
    expect(at('2026-05-01')).toEqual([]);
    expect(at('2026-06-10')[0]).toMatchObject({
      kind: 'loyalty_ending',
      severity: 'info',
      data: { threshold: 60 },
    });
    expect(at('2026-07-05')[0]).toMatchObject({
      severity: 'warning',
      data: { threshold: 30, daysLeft: 27 },
    });
    expect(at('2026-07-30')[0]?.data).toMatchObject({ threshold: 7, daysLeft: 2 });
    expect(at('2026-06-10')[0]?.key).not.toBe(at('2026-07-05')[0]?.key);
    expect(at('2026-08-02')).toEqual([]);
  });
});

describe('price increase', () => {
  it('flags a higher monthly base fee', () => {
    const alerts = computeAlerts(
      input({
        invoices: [invoice('a', '2026-04-24', 3000), invoice('b', '2026-05-24', 3200)],
        lines: [
          line('a', { kind: 'base_fee', amountCents: 3000 }),
          line('b', { kind: 'base_fee', amountCents: 3200 }),
        ],
      }),
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        kind: 'price_increase',
        data: expect.objectContaining({ reason: 'base_fee' }),
      }),
    ]);
  });

  it('telecom: total above the 3-invoice average plus the threshold', () => {
    const invoices = [
      invoice('a', '2026-02-24', 3000),
      invoice('b', '2026-03-24', 3000),
      invoice('c', '2026-04-24', 3000),
      invoice('d', '2026-05-24', 3200),
    ];
    expect(kinds(computeAlerts(input({ invoices })))).toEqual(['price_increase']);
    const small = invoices.map((item) => (item.id === 'd' ? { ...item, totalCents: 3140 } : item));
    expect(computeAlerts(input({ invoices: small }))).toEqual([]);
  });

  it('electricity: compares the price per kWh, not the total (which follows consumption)', () => {
    const electricity = contract({ sector: 'electricity' });
    const energy = (invoiceId: string, unitPrice: string) =>
      line(invoiceId, { kind: 'energy', amountCents: 1, quantity: 100, unit: 'kWh', unitPrice });
    const invoices = [invoice('a', '2026-04-24', 5000), invoice('b', '2026-05-24', 9000)];
    expect(
      computeAlerts(
        input({
          contracts: [electricity],
          invoices,
          lines: [energy('a', '0.15'), energy('b', '0.15')],
        }),
      ),
    ).toEqual([]);
    expect(
      kinds(
        computeAlerts(
          input({
            contracts: [electricity],
            invoices,
            lines: [energy('a', '0.15'), energy('b', '0.17')],
          }),
        ),
      ),
    ).toEqual(['price_increase']);
  });
});

describe('estimated readings', () => {
  it('alerts after 3 invoices in a row with only estimated readings', () => {
    const invoices = [
      invoice('a', '2026-02-01', 1000),
      invoice('b', '2026-03-01', 1000),
      invoice('c', '2026-04-01', 1000),
      invoice('d', '2026-05-01', 1000),
    ];
    const gas = contract({ sector: 'gas' });
    const two = [
      reading('a', 'real'),
      reading('b', 'real'),
      reading('c', 'estimated'),
      reading('d', 'estimated'),
    ];
    expect(computeAlerts(input({ contracts: [gas], invoices, readings: two }))).toEqual([]);
    const three = [
      reading('a', 'real'),
      reading('b', 'estimated'),
      reading('c', 'estimated'),
      reading('d', 'estimated'),
    ];
    expect(computeAlerts(input({ contracts: [gas], invoices, readings: three }))[0]).toMatchObject({
      kind: 'estimated_readings',
      data: { count: 3 },
    });
  });
});

describe('missing invoice', () => {
  it('alerts when an active contract has had no invoice for more than 40 days', () => {
    const invoices = [invoice('a', '2026-04-15', 1000)];
    expect(kinds(computeAlerts(input({ invoices, today: '2026-05-25' })))).toEqual([]);
    expect(kinds(computeAlerts(input({ invoices, today: '2026-05-26' })))).toEqual([
      'missing_invoice',
    ]);
    expect(
      computeAlerts(
        input({ contracts: [contract({ active: false })], invoices, today: '2026-07-01' }),
      ),
    ).toEqual([]);
  });
});

describe('invoice audit', () => {
  it('alerts when a discount of the previous invoice is gone', () => {
    const alerts = computeAlerts(
      input({
        invoices: [invoice('a', '2026-04-24', 2500), invoice('b', '2026-05-24', 3000)],
        lines: [
          line('a', { kind: 'base_fee', amountCents: 3000 }),
          line('a', { kind: 'discount', description: 'Desconto', amountCents: -500 }),
          line('b', { kind: 'base_fee', amountCents: 3000 }),
        ],
      }),
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        key: 'c1:invoice_audit:b',
        kind: 'invoice_audit',
        data: { invoiceId: 'b', issueDate: '2026-05-24', kinds: ['discount_ended'] },
      }),
    ]);
  });

  it('alerts when the invoice is above the contracted monthly price', () => {
    const alerts = computeAlerts(
      input({
        contracts: [contract({ monthlyPriceCents: 2999 })],
        invoices: [invoice('a', '2026-05-24', 3499)],
      }),
    );
    expect(kinds(alerts)).toEqual(['invoice_audit']);
  });
});

describe('insurance', () => {
  const policy = contract({ sector: 'insurance', label: 'Seguro Automóvel' });
  // Insurance receipts are issued just before the period; water invoices after it.
  const receipt = (id: string, start: string, end: string, total: number, issued = start) => ({
    ...invoice(id, issued, total),
    periodStart: start,
    periodEnd: end,
  });

  it('alerts before the renewal, the day after the paid period ends', () => {
    const alerts = computeAlerts(
      input({
        contracts: [policy],
        invoices: [receipt('a', '2025-10-10', '2026-10-09', 46138)],
        today: '2026-09-15',
      }),
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        key: 'c1:renewal:2026-10-10:30',
        kind: 'renewal',
        data: { date: '2026-10-10', daysLeft: 25, threshold: 30 },
      }),
    ]);
    // Not for other sectors.
    expect(
      kinds(
        computeAlerts(
          input({ invoices: [receipt('a', '2025-10-10', '2026-10-09', 1)], today: '2026-09-15' }),
        ),
      ),
    ).not.toContain('renewal');
  });

  it('flags a higher premium than the previous receipt', () => {
    const alerts = computeAlerts(
      input({
        contracts: [policy],
        invoices: [
          receipt('a', '2024-11-01', '2025-10-31', 39789),
          receipt('b', '2025-11-01', '2026-10-31', 43251),
        ],
        today: '2025-11-05',
      }),
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        kind: 'price_increase',
        data: expect.objectContaining({ reason: 'premium', before: 39789, after: 43251 }),
      }),
    ]);
  });

  it('does not count a yearly receipt as missing before its period ends', () => {
    const yearly = input({
      contracts: [policy],
      invoices: [receipt('a', '2025-10-10', '2026-10-09', 46138)],
      today: '2026-08-01',
    });
    expect(kinds(computeAlerts(yearly))).not.toContain('missing_invoice');
    // Bimonthly water: 62 days + 10.
    const water = contract({ sector: 'water' });
    const bimonthly = (today: string) =>
      kinds(
        computeAlerts(
          input({
            contracts: [water],
            invoices: [receipt('w', '2026-03-04', '2026-05-04', 3286, '2026-05-07')],
            today,
          }),
        ),
      );
    expect(bimonthly('2026-07-10')).not.toContain('missing_invoice');
    expect(bimonthly('2026-07-25')).toContain('missing_invoice');
  });
});

describe('insurance renewal letter', () => {
  it('warns that the premium goes up at the renewal, instead of the plain renewal alert', () => {
    const policy = contract({
      sector: 'insurance',
      insurance: { renewal: { date: '2026-11-01', currentCents: 39789, nextCents: 43251 } },
    });
    const receipt = {
      ...invoice('a', '2025-10-28', 39789),
      periodStart: '2025-11-01',
      periodEnd: '2026-10-31',
    };
    const alerts = computeAlerts(
      input({ contracts: [policy], invoices: [receipt], today: '2026-10-14' }),
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        kind: 'premium_notice',
        data: expect.objectContaining({ date: '2026-11-01', before: 39789, after: 43251 }),
      }),
    ]);
    // After the renewal date, the notice goes away.
    expect(
      kinds(
        computeAlerts(input({ contracts: [policy], invoices: [receipt], today: '2026-11-02' })),
      ),
    ).not.toContain('premium_notice');
  });
});
