import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { findParser } from './registry';
import { repsolParser } from './repsol';

const fixtures = layoutFixtures('repsol');
const documents = fixtures.flatMap((fixture) =>
  fixture.qrs.map((qr, index) => ({ name: `${fixture.name} #${index + 1}`, fixture, qr })),
);

describe('repsol parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(documents)('$name', ({ fixture, qr }) => {
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(repsolParser);
    expect(repsolParser.detect(ctx)).toBe(true);

    const result = repsolParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.docId?.value).toBe(qr.docId);
    // Cross-check with the fiscal QR code.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    // Internal consistency: lines add up to the net total, net + VAT = total.
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(result.netCents?.value);
    expect((result.netCents?.value ?? 0) + (result.vatCents?.value ?? 0)).toBe(qr.totalCents);

    expect(result.periodStart?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.periodEnd?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.periodStart!.value <= result.periodEnd!.value).toBe(true);
    expect(result.dueDate?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.customerNumber?.value).toBeTruthy();
    expect(result.supplyPointId?.value).toMatch(/^PT[0-9A-Z]{16,20}$/);
    expect(result.tariffName?.value).toBeTruthy();
    expect(result.readings.length).toBeGreaterThan(0);

    if (result.sector === 'electricity') {
      expect(result.powerKva?.value).toBeGreaterThan(0);
      // Readings by period add up to the kWh billed.
      const billed = result.lines
        .filter((line) => line.kind === 'energy' && line.unit === 'kWh')
        .reduce((sum, line) => sum + (line.quantity ?? 0), 0);
      const read = result.readings.reduce((sum, reading) => sum + reading.quantity, 0);
      expect(read).toBeCloseTo(billed, 6);
    } else {
      expect(result.sector).toBe('gas');
    }
  });
});
