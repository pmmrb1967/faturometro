import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { fidelidadeParser } from './fidelidade';
import { findParser } from './registry';

const fixtures = layoutFixtures('fidelidade');

describe('fidelidade parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$name', (fixture) => {
    const [qr] = fixture.qrs;
    expect(qr).toBeDefined();
    if (!qr) return;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(fidelidadeParser);
    expect(fidelidadeParser.detect(ctx)).toBe(true);

    const result = fidelidadeParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('insurance');
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    // Cross-check with the QR code: no VAT; the stamp duty is field M.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(qr.totalCents);
    expect(result.lines[0]).toMatchObject({ kind: 'base_fee', description: 'Prémio comercial' });
    expect(result.lines.find((line) => line.description === 'Imposto do selo')?.amountCents).toBe(
      qr.stampDutyCents,
    );
    // Monthly receipt: within one month (health) or from the 28th to the 28th (pets).
    const start = Date.parse(result.periodStart?.value ?? '');
    const end = Date.parse(result.periodEnd?.value ?? '');
    expect((end - start) / 86_400_000).toBeGreaterThanOrEqual(27);
    expect((end - start) / 86_400_000).toBeLessThanOrEqual(31);
    expect(result.customerNumber?.value).toBeTruthy();
    expect(result.insurance?.value.policyNumber).toMatch(/^(?:[A-Z]{2})?\d+$/);
    expect(result.insurance?.value.product).not.toMatch(/�/);
    expect(result.contractLabel?.value).toMatch(/^Seguro \S/);
    if (result.insurance?.value.product === 'FIDELIDADE PETS') {
      expect(result.contractLabel?.value).toBe('Seguro Pets');
    }
  });
});
