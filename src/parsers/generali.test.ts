import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { generaliParser } from './generali';
import { findParser } from './registry';

const fixtures = layoutFixtures('generali');

describe('generali parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$name', (fixture) => {
    const [qr] = fixture.qrs;
    expect(qr).toBeDefined();
    if (!qr) return;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(generaliParser);
    expect(generaliParser.detect(ctx)).toBe(true);

    const result = generaliParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('insurance');
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    // Cross-check with the fiscal QR code: no VAT; the stamp duty is field M.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    expect(result.vatCents?.value).toBe(0);
    const stamp = result.lines.find((line) => line.description === 'Imposto de selo');
    expect(stamp?.amountCents).toBe(qr.stampDutyCents);
    expect(stamp?.kind).toBe('tax');
    expect(result.linesIncludeVat).toBe(true);
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(qr.totalCents);
    expect(result.lines[0]).toMatchObject({ kind: 'base_fee', description: 'Prémio comercial' });

    expect(result.periodStart!.value < result.periodEnd!.value).toBe(true);
    expect(result.customerNumber?.value).toBeTruthy();
    expect(result.contractLabel?.value).toMatch(/^Seguro \S/);
    const insurance = result.insurance?.value;
    expect(insurance?.product).toBeTruthy();
    expect(insurance?.option).toBeTruthy();
    expect(insurance?.policyNumber).toMatch(/^\d+$/);
    expect(insurance?.insuredObject).toBeTruthy();
    expect(insurance?.capitals?.length).toBeGreaterThan(0);
    for (const capital of insurance?.capitals ?? []) {
      expect(capital.name).toMatch(/^\p{Lu}\p{Ll}/u);
      expect(capital.capitalCents).toBeGreaterThan(0);
    }
  });
});
