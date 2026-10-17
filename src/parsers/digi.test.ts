import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { digiParser } from './digi';
import { findParser } from './registry';

const fixtures = layoutFixtures('digi');

describe('digi parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$name', (fixture) => {
    const [qr] = fixture.qrs;
    expect(qr).toBeDefined();
    if (!qr) return;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(digiParser);
    expect(digiParser.detect(ctx)).toBe(true);

    const result = digiParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('telecom');
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    // Cross-check with the fiscal QR code.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    expect(result.netCents!.value + result.vatCents!.value).toBe(qr.totalCents);
    // Lines include VAT and add up to the total.
    expect(result.linesIncludeVat).toBe(true);
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(qr.totalCents);
    expect(result.lines.every((line) => line.vatRate === 23)).toBe(true);

    expect(result.customerNumber?.value).toMatch(/^\d+$/);
    expect(result.tariffName?.value).toMatch(/^Fibra /);
    expect(result.telecomServices?.value).toEqual(['internet']);
    expect(result.loyaltyEndDate).toBeUndefined();
    expect(result.periodStart!.value < result.periodEnd!.value).toBe(true);
    expect(result.periodEnd!.value < qr.date).toBe(true);
    expect(result.dueDate!.value > qr.date).toBe(true);
  });

  it('reads the synthetic invoice in full', () => {
    const fixture = fixtures.find((candidate) => candidate.name.includes('synthetic-1'));
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const result = digiParser.parse({ pages: fixture.pages, qrs: fixture.qrs }, fixture.qrs[0]);
    expect(result).toMatchObject({
      docId: { value: 'FT FT.FC26/1000001' },
      issueDate: { value: '2026-06-15' },
      dueDate: { value: '2026-07-01' },
      periodStart: { value: '2026-05-05' },
      periodEnd: { value: '2026-06-04' },
      customerNumber: { value: '000001' },
      tariffName: { value: 'Fibra 500 Mb' },
      netCents: { value: 1626 },
      vatCents: { value: 374 },
      totalCents: { value: 2000 },
    });
    expect(result.lines).toEqual([
      { kind: 'base_fee', description: 'Fibra 500 Mb', amountCents: 2000, vatRate: 23 },
    ]);
  });
});
