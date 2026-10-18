import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { aguasPortoParser } from './aguas-porto';
import { findParser } from './registry';

const fixtures = layoutFixtures('aguas-porto');
const documents = fixtures.flatMap((fixture) =>
  fixture.qrs.map((qr, index) => ({ name: `${fixture.name} #${index + 1}`, fixture, qr })),
);

describe('aguas-porto parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(documents)('$name', ({ fixture, qr }) => {
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(aguasPortoParser);
    expect(aguasPortoParser.detect(ctx)).toBe(true);

    const result = aguasPortoParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('water');
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    // Cross-check with the fiscal QR code.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    // Lines add up to the net total, net + VAT = total.
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(result.netCents?.value);
    expect(result.netCents!.value + result.vatCents!.value).toBe(qr.totalCents);

    expect(result.periodStart!.value < result.periodEnd!.value).toBe(true);
    expect(result.dueDate!.value > qr.date).toBe(true);
    expect(result.customerNumber?.value).toMatch(/^\d+ \/ \d+$/);
    expect(result.lines.some((line) => line.kind === 'base_fee' && line.unit === 'day')).toBe(true);
    for (const line of result.lines.filter((candidate) => candidate.kind !== 'other')) {
      expect(line.unitPrice).toMatch(/^\d+\.\d+$/);
      expect(['day', 'm3']).toContain(line.unit);
    }

    if (qr.issuerNif === '507718666') {
      // Water, sanitation and water resources tax, 6 % VAT.
      expect(result.tariffName?.value).toBe('Doméstico');
      expect(result.contractLabel).toBeUndefined();
      const taxed = result.lines.filter((line) => line.kind !== 'other');
      expect(taxed.every((line) => line.vatRate === 6)).toBe(true);
      // The meter reading matches the m³ of water billed.
      const water = result.lines.find((line) => line.description === '1 Esc. Consumo Água');
      expect(result.readings).toHaveLength(1);
      expect(result.readings[0]).toMatchObject({
        unit: 'm3',
        readingType: 'real',
        quantity: water?.quantity,
        dateTo: result.periodEnd?.value,
      });
      expect(result.readings[0]?.meterReading).toBeGreaterThan(0);
      expect(result.readingType?.value).toBe('real');
      // "Período de Comunicação" for the next reading, after the billed period.
      const window = result.readingWindow?.value;
      expect(window && window.start <= window.end).toBe(true);
      expect(window!.start > result.periodEnd!.value).toBe(true);
    } else {
      // Urban waste, not subject to VAT, in its own contract.
      expect(result.vatCents?.value).toBe(0);
      expect(result.contractLabel?.value).toBe('Resíduos');
      expect(result.readings).toEqual([]);
      expect(result.lines.every((line) => line.vatRate === undefined)).toBe(true);
      expect(result.readingWindow).toBeUndefined();
    }
  });

  it('reads the synthetic invoices in full', () => {
    const fixture = fixtures.find((candidate) => candidate.name.includes('synthetic-1'));
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    const water = aguasPortoParser.parse(ctx, fixture.qrs[0]);
    expect(water).toMatchObject({
      docId: { value: '10000001' },
      issueDate: { value: '2026-06-05' },
      dueDate: { value: '2026-06-25' },
      periodStart: { value: '2026-05-01' },
      periodEnd: { value: '2026-05-30' },
      customerNumber: { value: '1000000 / 2000000' },
      netCents: { value: 815 },
      vatCents: { value: 49 },
      totalCents: { value: 864 },
    });
    expect(
      water.lines.map((line) => [
        line.kind,
        line.amountCents,
        line.quantity,
        line.unit,
        line.vatRate,
      ]),
    ).toEqual([
      ['usage', 200, 4, 'm3', 6],
      ['base_fee', 300, 30, 'day', 6],
      ['usage', 144, 3.6, 'm3', 6],
      ['base_fee', 150, 30, 'day', 6],
      ['tax', 16, 4, 'm3', 6],
      ['tax', 4, 3.6, 'm3', 6],
      // Late interest: exempt (note 4), no quantity.
      ['other', 1, undefined, undefined, undefined],
    ]);
    expect(water.readingWindow?.value).toEqual({ start: '2026-06-26', end: '2026-06-29' });
    expect(water.readings).toEqual([
      { quantity: 4, unit: 'm3', readingType: 'real', dateTo: '2026-05-30', meterReading: 100 },
    ]);

    const waste = aguasPortoParser.parse(ctx, fixture.qrs[1]);
    expect(waste.lines.map((line) => [line.kind, line.amountCents])).toEqual([
      ['usage', 200],
      ['base_fee', 240],
      ['tax', 20],
    ]);
    expect(waste.totalCents?.value).toBe(460);
  });

  it('reads nothing from another invoice number', () => {
    const fixture = fixtures[0]!;
    const qr = { ...fixture.qrs[0]!, docId: '99999999' };
    const result = aguasPortoParser.parse({ pages: fixture.pages, qrs: fixture.qrs }, qr);
    expect(result.warnings).toEqual(['Invoice detail not found']);
  });
});
