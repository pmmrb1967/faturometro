import { describe, expect, it } from 'vitest';
import {
  estimateGasCost,
  gasBreakdownFromLines,
  hasEarlierAdjustments,
  NO_GAS_COMMON_CHARGES,
} from './gas-cost';
import type { InvoiceLine } from './types';

// Synthetic numbers only.
type Line = Pick<
  InvoiceLine,
  'kind' | 'description' | 'amountCents' | 'quantity' | 'unit' | 'unitPrice'
>;

const LINES: Line[] = [
  {
    kind: 'power',
    description: 'Termo Fixo (Escalão 2)',
    amountCents: 450,
    quantity: 30,
    unit: 'day',
    unitPrice: '0.15',
  },
  {
    kind: 'power',
    description: 'Redes Termo Fixo',
    amountCents: 60,
    quantity: 30,
    unit: 'day',
    unitPrice: '0.02',
  },
  {
    kind: 'energy',
    description: 'Energia',
    amountCents: 1800,
    quantity: 200,
    unit: 'kWh',
    unitPrice: '0.09',
  },
  { kind: 'discount', description: 'Desc. DD Energia', amountCents: -90 },
  { kind: 'tax', description: 'Taxa Ocupação Subsolo Fixa', amountCents: 30 },
  { kind: 'tax', description: 'Taxa Ocupação Subsolo Variável', amountCents: 40 },
  { kind: 'tax', description: 'Imposto Especial Consumo GN', amountCents: 60 },
];

const COMMON = { networkPerDay: 0.02, reducedPerDay: 0, normalPerDay: 0.01, perKwh: 0.005 };

describe('estimateGasCost', () => {
  it('taxes the network fixed term at 6 % and the rest at 23 %', () => {
    const estimate = estimateGasCost({ fixedPerDay: 0.12, perKwh: 0.1 }, 100, 30, COMMON);
    expect(estimate).toMatchObject({ netCents: 1500, vatCents: 335, totalCents: 1835 });
  });

  it('gives the same total when the fixed term already includes the network part', () => {
    const estimate = estimateGasCost(
      { fixedPerDay: 0.14, perKwh: 0.1, fixedIncludesNetwork: true },
      100,
      30,
      COMMON,
    );
    expect(estimate).toMatchObject({ netCents: 1500, vatCents: 335, totalCents: 1835 });
  });

  it('applies the offer discounts and adds mandatory services', () => {
    const estimate = estimateGasCost(
      {
        fixedPerDay: 0.12,
        perKwh: 0.1,
        energyDiscountPct: 10,
        energyDiscountPerKwh: 0.01,
        fixedTermDiscountPct: 50,
        discountPerYear: 36.5,
        servicesPerYearWithVat: 3.65,
      },
      100,
      30,
      NO_GAS_COMMON_CHARGES,
    );
    expect(estimate).toMatchObject({ netCents: 680, vatCents: 156, totalCents: 866 });
  });
});

describe('gasBreakdownFromLines', () => {
  it('splits the invoice into offer prices and charges common to every offer', () => {
    const breakdown = gasBreakdownFromLines(LINES, 30);
    expect(breakdown?.kwh).toBe(200);
    expect(breakdown?.prices.fixedPerDay).toBeCloseTo(0.15, 10);
    expect(breakdown?.prices.perKwh).toBeCloseTo(0.09, 10);
    expect(breakdown?.prices.energyDiscountPct).toBeCloseTo(5, 10);
    expect(breakdown?.common.networkPerDay).toBeCloseTo(0.02, 10);
    expect(breakdown?.common.normalPerDay).toBeCloseTo(0.01, 10);
    expect(breakdown?.common.perKwh).toBeCloseTo(0.005, 10);
    expect(breakdown?.common.reducedPerDay).toBe(0);
  });

  it('reproduces the invoice when estimated for its own period', () => {
    const breakdown = gasBreakdownFromLines(LINES, 30)!;
    expect(estimateGasCost(breakdown.prices, breakdown.kwh, 30, breakdown.common)).toMatchObject({
      netCents: 2350,
      vatCents: 530,
    });
  });

  it('taxes social discounts on the network fixed term at 6 % (Review Focus 3)', () => {
    const social: Line[] = [
      ...LINES,
      { kind: 'discount', description: 'Desc. Social Redes Termo Fixo', amountCents: -60 },
      { kind: 'discount', description: 'Desc. Social Redes Energia', amountCents: -200 },
    ];
    const breakdown = gasBreakdownFromLines(social, 30)!;
    expect(breakdown.common.reducedPerDay).toBeCloseTo(-0.02, 10);
    expect(breakdown.common.perKwh).toBeCloseTo(-0.005, 10);
    expect(estimateGasCost(breakdown.prices, breakdown.kwh, 30, breakdown.common)).toMatchObject({
      netCents: 2090,
      vatCents: 481,
    });
  });

  it('tells invoices that settle earlier estimates apart (their amounts span other periods)', () => {
    expect(hasEarlierAdjustments(LINES)).toBe(false);
    expect(
      hasEarlierAdjustments([
        ...LINES,
        { kind: 'energy', description: 'Energia', amountCents: -1500 },
      ]),
    ).toBe(true);
  });

  it('needs priced energy in kWh', () => {
    expect(
      gasBreakdownFromLines(
        LINES.filter((line) => line.kind !== 'energy'),
        30,
      ),
    ).toBeNull();
    expect(gasBreakdownFromLines(LINES, 0)).toBeNull();
  });
});
