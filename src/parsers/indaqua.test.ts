import { describe, expect, it } from 'vitest';
import { lineKey } from '../domain/audit';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { indaquaParser } from './indaqua';
import { findParser } from './registry';
import { date } from './utils';

const fixtures = layoutFixtures('indaqua');
const documents = fixtures.flatMap((fixture) =>
  fixture.qrs.map((qr, index) => ({ name: `${fixture.name} #${index + 1}`, fixture, qr })),
);

describe('indaqua parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(documents)('$name', ({ fixture, qr }) => {
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(indaquaParser);
    expect(indaquaParser.detect(ctx)).toBe(true);

    const result = indaquaParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('water');
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    // Cross-check with the fiscal QR code.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    // Lines add up to the net total, net + VAT = total.
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(result.netCents?.value);
    expect((result.netCents?.value ?? 0) + (result.vatCents?.value ?? 0)).toBe(qr.totalCents);

    expect(result.periodStart?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.periodStart!.value < result.periodEnd!.value).toBe(true);
    expect(result.dueDate?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.customerNumber?.value).toBeTruthy();
    for (const line of result.lines) {
      expect(line.unitPrice).toMatch(/^\d+\.\d+$/);
      expect(line.quantity).toBeGreaterThan(0);
      expect(['day', 'm3']).toContain(line.unit);
      expect(line.basis).toBe('real');
    }

    const water = result.lines.filter((line) =>
      line.description.startsWith('Tarifa de Venda de Água'),
    );
    if (water.length > 0) {
      // Indaqua: water, sanitation and water resources tax, 6 % VAT.
      expect(result.tariffName?.value).toBe('Doméstico');
      expect(result.contractLabel).toBeUndefined();
      expect(result.issuerName).toBeUndefined();
      expect(water.every((line) => /\(\dº escalão\)$/.test(line.description))).toBe(true);
      expect(result.lines.find((line) => line.kind === 'base_fee')?.unit).toBe('day');
      // The meter reading matches the m³ billed across the tiers.
      expect(result.readings).toHaveLength(1);
      const billed = water.reduce((sum, line) => sum + (line.quantity ?? 0), 0);
      expect(result.readings[0]).toMatchObject({
        unit: 'm3',
        readingType: 'real',
        quantity: billed,
      });
      expect(result.readings[0]?.dateTo).toBe(result.periodEnd?.value);
      expect(result.readings[0]?.meterReading).toBeGreaterThan(0);
    } else {
      // Município: urban waste, not subject to VAT, in its own contract.
      expect(result.vatCents?.value).toBe(0);
      expect(result.contractLabel?.value).toBe('Resíduos');
      expect(result.issuerName?.value).toBe('Município de Matosinhos');
      expect(result.readings).toEqual([]);
    }
  });

  it('reads nothing from another invoice number', () => {
    const fixture = fixtures[0]!;
    const qr = { ...fixture.qrs[0]!, docId: 'FA X/1' };
    const result = indaquaParser.parse({ pages: fixture.pages, qrs: fixture.qrs }, qr);
    expect(result.warnings).toEqual(['Invoice detail not found']);
  });
});

describe('helpers', () => {
  it('reads dates with dots', () => {
    expect(date('04.05.2026')).toBe('2026-05-04');
  });

  it('keeps water tiers apart when comparing invoices', () => {
    const tier = (n: string) =>
      lineKey({ kind: 'usage', description: `Tarifa de Venda de Água (${n} escalão)` });
    expect(tier('1º')).not.toBe(tier('2º'));
  });
});
