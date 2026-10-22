import { describe, expect, it } from 'vitest';
import { annualUsage, compareOffers, consumptionFor, type AnnualUsage } from './compare';
import type { Offer } from './erse';
import type { Invoice, InvoiceLine, Reading } from './types';

// Synthetic data only.
const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function invoice(id: string, periodStart: string, periodEnd: string): Invoice {
  return {
    ...META,
    id,
    contractId: 'c1',
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate: periodEnd,
    periodStart,
    periodEnd,
    totalCents: 5000,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: META.updatedAt,
  };
}

function reading(invoiceId: string, period: Reading['period'], quantity: number): Reading {
  return {
    ...META,
    id: `${invoiceId}-${period}`,
    invoiceId,
    contractId: 'c1',
    quantity,
    unit: 'kWh',
    readingType: 'real',
    dateFrom: '2026-05-01',
    dateTo: '2026-05-30',
    ...(period ? { period } : {}),
  };
}

function offer(id: string, prices: Offer['prices'], overrides: Partial<Offer> = {}): Offer {
  return {
    id,
    supplier: 'ACME',
    name: id,
    segment: 'Dom',
    supply: 'ELE',
    durationMonths: 12,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    loyalty: false,
    indexedPrices: false,
    renewable: false,
    restrictions: false,
    requiredServices: false,
    servicesPerYearWithVat: 0,
    discounts: { fixedPerYear: 0, fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    newClientDiscounts: { fixedPerYearWithVat: 0, fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    payment: { directDebit: true, multibanco: true, cash: false },
    billing: { electronic: true, paper: true },
    links: {},
    texts: {},
    prices,
    gasPrices: {},
    gasDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    gasNewClientDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    ...overrides,
  };
}

const INVOICES = [
  invoice('a', '2026-04-01', '2026-04-30'),
  invoice('b', '2026-05-01', '2026-05-30'),
];
const READINGS = [
  reading('a', 'full', 100),
  reading('a', 'peak', 40),
  reading('a', 'empty', 60),
  reading('b', 'full', 100),
  reading('b', 'peak', 40),
  reading('b', 'empty', 60),
];

describe('annualUsage', () => {
  it('has no estimate when the invoices bring only m³ (gas without kWh)', () => {
    const gasInvoice = invoice('g1', '2026-08-01', '2026-08-31');
    const m3: Reading = { ...reading('g1', undefined, 30), unit: 'm3' };
    expect(annualUsage([gasInvoice], [m3], '2026-10-14')).toBeNull();
  });

  it('scales the last 12 months of readings to a year, by period', () => {
    const usage = annualUsage(INVOICES, READINGS, '2026-06-15');
    expect(usage?.daysCovered).toBe(60);
    expect(usage?.total).toBeCloseTo((400 * 365) / 60);
    expect(usage?.byPeriod.empty).toBeCloseTo((120 * 365) / 60);
  });

  it('ignores invoices older than a year', () => {
    expect(annualUsage(INVOICES, READINGS, '2027-06-15')).toBeNull();
  });
});

describe('consumptionFor', () => {
  const usage = { byPeriod: { empty: 30, full: 50, peak: 20 }, total: 100, daysCovered: 365 };
  it('splits for each ERSE cycle when the meter allows it', () => {
    expect(consumptionFor('1', usage)).toEqual({ simple: 100 });
    expect(consumptionFor('2', usage)).toEqual({ empty: 30, offEmpty: 70 });
    expect(consumptionFor('3', usage)).toEqual({ empty: 30, full: 50, peak: 20 });
  });

  it('cannot split without period readings', () => {
    const simple = { byPeriod: {}, total: 100, daysCovered: 365 };
    expect(consumptionFor('2', simple)).toBeNull();
    expect(consumptionFor('3', simple)).toBeNull();
  });
});

describe('compareOffers', () => {
  const latest = {
    periodStart: '2026-05-01',
    periodEnd: '2026-05-30',
    lines: [
      {
        ...META,
        id: 'e',
        invoiceId: 'b',
        kind: 'energy',
        description: 'Energia',
        amountCents: 4000,
        quantity: 200,
        unit: 'kWh',
        unitPrice: '0.2',
      },
      {
        ...META,
        id: 'p',
        invoiceId: 'b',
        kind: 'power',
        description: 'Potência',
        amountCents: 1500,
        quantity: 30,
        unit: 'day',
        unitPrice: '0.5',
      },
    ] satisfies InvoiceLine[],
  };
  const usage = annualUsage(INVOICES, READINGS, '2026-06-15')!;

  it('ranks valid offers for the same power by estimated annual cost', () => {
    const cheap = offer('cheap', { '6.9': { '1': { fixedPerDay: 0.4, simple: 0.15 } } });
    const dear = offer('dear', { '6.9': { '1': { fixedPerDay: 0.6, simple: 0.25 } } });
    const otherPower = offer('other', { '3.45': { '1': { fixedPerDay: 0.1, simple: 0.1 } } });
    const expired = offer(
      'expired',
      { '6.9': { '1': { fixedPerDay: 0.1, simple: 0.1 } } },
      { validTo: '2026-05-31' },
    );
    const result = compareOffers({
      offers: [dear, cheap, otherPower, expired],
      latest,
      usage,
      household: { powerKva: 6.9 },
      today: '2026-06-15',
    });
    expect(result?.results.map((item) => item.offer.id)).toEqual(['cheap', 'dear']);
    expect(result?.results[0]?.savingCents).toBeGreaterThan(0);
    expect(result?.results[1]?.savingCents).toBeLessThan(0);
  });

  it('includes bi- and tri-hourly prices when the readings allow the split', () => {
    const multi = offer('multi', {
      '6.9': {
        '1': { fixedPerDay: 0.5, simple: 0.2 },
        '2': { fixedPerDay: 0.5, offEmpty: 0.22, empty: 0.1 },
        '3': { fixedPerDay: 0.5, peak: 0.3, full: 0.2, empty: 0.1 },
      },
    });
    const result = compareOffers({
      offers: [multi],
      latest,
      usage,
      household: { powerKva: 6.9 },
      today: '2026-06-15',
    });
    expect(result?.results.map((item) => item.cycle).sort()).toEqual(['1', '2', '3']);
    // Same prices as the current contract: no saving on the simple version.
    expect(result?.results.find((item) => item.cycle === '1')?.savingCents).toBe(0);
  });
});

describe('compareOffers with an E-Redes profile', () => {
  // Simple contract; the profile splits every cycle: weekly has more empty hours.
  const energy = {
    ...META,
    id: 'e',
    invoiceId: 'b',
    kind: 'energy',
    description: 'Energia',
    amountCents: 4000,
    quantity: 200,
    unit: 'kWh',
    unitPrice: '0.2',
  } satisfies InvoiceLine;
  const latest = { periodStart: '2026-05-01', periodEnd: '2026-05-30', lines: [energy] };
  const usage: AnnualUsage = {
    byPeriod: { empty: 1000, full: 1500, peak: 500 },
    byCycle: {
      daily: { empty: 1000, full: 1500, peak: 500 },
      weekly: { empty: 1200, full: 1500, peak: 300 },
    },
    total: 3000,
    daysCovered: 365,
    source: { kind: 'eredes', from: '2025-10-23', to: '2026-10-21', map: 'pre-2027' },
  };
  const multi = offer('multi', {
    '6.9': {
      '1': { fixedPerDay: 0, simple: 0.2 },
      '2': { fixedPerDay: 0, offEmpty: 0.25, empty: 0.1 },
      '3': { fixedPerDay: 0, peak: 0.4, full: 0.2, empty: 0.1 },
    },
  });

  it('splits every cycle and keeps the cheaper of daily and weekly', () => {
    expect(consumptionFor('2', usage, 'weekly')).toEqual({ empty: 1200, offEmpty: 1800 });
    expect(consumptionFor('3', usage, 'daily')).toEqual({ empty: 1000, full: 1500, peak: 500 });
    const result = compareOffers({
      offers: [multi],
      latest,
      usage,
      household: { powerKva: 6.9 },
      today: '2026-06-15',
    });
    const byCycle = Object.fromEntries(
      (result?.results ?? []).map((item) => [item.cycle, item.meterCycle]),
    );
    expect(byCycle).toEqual({ '1': undefined, '2': 'weekly', '3': 'weekly' });
  });

  it('prices the current bi-hourly contract with its own cycle', () => {
    const bi = {
      ...latest,
      lines: [
        {
          ...energy,
          id: 'v',
          period: 'empty',
          quantity: 100,
          amountCents: 1000,
          unitPrice: '0.1',
        },
        {
          ...energy,
          id: 'f',
          period: 'off_empty',
          quantity: 100,
          amountCents: 2500,
          unitPrice: '0.25',
        },
      ] satisfies InvoiceLine[],
    };
    const input = {
      offers: [],
      latest: bi,
      usage,
      household: { powerKva: 6.9 },
      today: '2026-06-15',
    };
    const daily = compareOffers(input)!.currentAnnualCents;
    const weekly = compareOffers({ ...input, currentMeterCycle: 'weekly' })!.currentAnnualCents;
    expect(weekly).toBeLessThan(daily);
  });
});
