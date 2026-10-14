import { describe, expect, it } from 'vitest';
import type { AnnualUsage, Comparison, OfferResult } from './compare';
import { combineElectricityGas, compareGas, type GasComparison } from './compare-gas';
import type { Offer } from './erse';
import type { InvoiceLine } from './types';

// Synthetic data only.
const META = { updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };

function offer(id: string, overrides: Partial<Offer> = {}): Offer {
  return {
    id,
    supplier: 'ACME',
    name: id,
    segment: 'Dom',
    supply: 'GN',
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
    prices: {},
    gasPrices: {},
    gasDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    gasNewClientDiscounts: { fixedTermPct: 0, energyPct: 0, energyPerKwh: 0 },
    ...overrides,
  };
}

function line(
  fields: Partial<InvoiceLine> & Pick<InvoiceLine, 'kind' | 'description' | 'amountCents'>,
): InvoiceLine {
  return { ...META, id: fields.description, invoiceId: 'i1', ...fields };
}

const LATEST = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  lines: [
    line({
      kind: 'power',
      description: 'Termo Fixo (Escalão 2)',
      amountCents: 450,
      quantity: 30,
      unit: 'day',
      unitPrice: '0.15',
    }),
    line({
      kind: 'power',
      description: 'Redes Termo Fixo',
      amountCents: 60,
      quantity: 30,
      unit: 'day',
      unitPrice: '0.02',
    }),
    line({
      kind: 'energy',
      description: 'Energia',
      amountCents: 1800,
      quantity: 200,
      unit: 'kWh',
      unitPrice: '0.09',
    }),
  ],
};
const USAGE: AnnualUsage = { byPeriod: {}, total: 2400, daysCovered: 365 };

const cheap = offer('CHEAP', { gasPrices: { '2': { fixedPerDay: 0.1, perKwh: 0.07 } } });
const dear = offer('DEAR', { gasPrices: { '2': { fixedPerDay: 0.2, perKwh: 0.12 } } });
const otherTier = offer('TIER1', { gasPrices: { '1': { fixedPerDay: 0.01, perKwh: 0.01 } } });
const expired = offer('OLD', {
  validTo: '2026-06-30',
  gasPrices: { '2': { fixedPerDay: 0.01, perKwh: 0.01 } },
});
const future = offer('NEXT', {
  validFrom: '2027-01-01',
  gasPrices: { '2': { fixedPerDay: 0.01, perKwh: 0.01 } },
});
const electricityOnly = offer('ELE', { supply: 'ELE', gasPrices: {} });
const dual = offer('DUAL', {
  supply: 'DUAL',
  gasPrices: { '2': { fixedPerDay: 0.09, perKwh: 0.065 } },
});

const base = {
  regulated: {
    LIS: {
      offerId: 'CURLIS',
      name: 'Regulada Lisboa',
      prices: { '2': { fixedPerDay: 0.08, perKwh: 0.075 } },
    },
  },
  latest: LATEST,
  usage: USAGE,
  escalao: '2' as const,
  today: '2026-10-14',
};

describe('compareGas', () => {
  const result = compareGas({
    ...base,
    offers: [dear, cheap, otherTier, expired, future, electricityOnly, dual],
    distributor: 'LIS',
  })!;

  it('ranks valid gas and dual offers for the escalão, cheapest first', () => {
    expect(result.results.map((item) => item.offer.id)).toEqual(['DUAL', 'CHEAP', 'DEAR']);
  });

  it('skips expired and future offers (Review Focus 2) and other tiers', () => {
    const ids = result.results.map((item) => item.offer.id);
    expect(ids).not.toContain('OLD');
    expect(ids).not.toContain('NEXT');
    expect(ids).not.toContain('TIER1');
  });

  it('gives the saving against the current contract', () => {
    for (const item of result.results) {
      expect(item.savingCents).toBe(result.currentAnnualCents - item.annualCents);
    }
    expect(result.results.at(-1)!.savingCents).toBeLessThan(0);
  });

  it('adds the regulated tariff of the chosen distributor', () => {
    expect(result.regulated).toMatchObject({ code: 'LIS', name: 'Regulada Lisboa' });
    expect(result.regulated!.annualCents).toBeGreaterThan(0);
    const unknown = compareGas({ ...base, offers: [cheap], distributor: 'unknown' })!;
    expect(unknown.regulated).toBeUndefined();
  });

  it('needs priced energy in the latest invoice', () => {
    expect(compareGas({ ...base, offers: [cheap], latest: { ...LATEST, lines: [] } })).toBeNull();
  });
});

describe('combineElectricityGas', () => {
  const eleOffer = offer('E1', { supply: 'ELE' });
  const dualOffer = offer('D1', { supply: 'DUAL' });
  const dualNoGas = offer('D2', { supply: 'DUAL' });
  const gasOffer = offer('G1');
  const ele = (o: Offer, annualCents: number, cycle: '1' | '2' = '1'): OfferResult => ({
    offer: o,
    cycle,
    annualCents,
    savingCents: 60_000 - annualCents,
  });
  const electricity: Comparison = {
    usage: USAGE,
    currentAnnualCents: 60_000,
    // Sorted like compareOffers returns them.
    results: [
      ele(dualNoGas, 40_000),
      ele(dualOffer, 50_000),
      ele(eleOffer, 52_000),
      ele(dualOffer, 53_000, '2'),
    ],
  };
  const gas: GasComparison = {
    usage: USAGE,
    currentAnnualCents: 30_000,
    results: [
      { offer: dualOffer, annualCents: 24_000, savingCents: 6_000 },
      { offer: gasOffer, annualCents: 25_000, savingCents: 5_000 },
    ],
  };
  const both = combineElectricityGas(electricity, gas);

  it('adds the current contracts', () => {
    expect(both.currentAnnualCents).toBe(90_000);
  });

  it('pairs the best electricity-only and gas-only offers', () => {
    expect(both.bestSeparate).toMatchObject({ annualCents: 77_000, savingCents: 13_000 });
    expect(both.bestSeparate?.electricity.offer.id).toBe('E1');
    expect(both.bestSeparate?.gas.offer.id).toBe('G1');
  });

  it('prices dual offers with both parts, cheapest cycle, never without gas (Review Focus 1)', () => {
    expect(both.duals).toEqual([
      { offer: dualOffer, cycle: '1', annualCents: 74_000, savingCents: 16_000 },
    ]);
  });
});
