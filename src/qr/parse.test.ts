import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikeFiscalQr, parseFiscalQr, vatCents, type FiscalQr } from './parse';

/** Examples 5.1–5.7 of the AT specification, as transcribed in docs/qr-fiscal.md. */
const SPEC_EXAMPLES = readFileSync(join(__dirname, '../../docs/qr-fiscal.md'), 'utf8')
  .split('\n')
  .filter((line) => looksLikeFiscalQr(line));

function parsed(raw: string): FiscalQr {
  const result = parseFiscalQr(raw);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.qr;
}

describe('parseFiscalQr — AT specification examples', () => {
  it('finds the seven examples in the docs', () => {
    expect(SPEC_EXAMPLES).toHaveLength(7);
  });

  it('parses every example without warnings', () => {
    for (const raw of SPEC_EXAMPLES) {
      const result = parseFiscalQr(raw);
      expect(result.ok, raw).toBe(true);
      expect(result.warnings, raw).toEqual([]);
    }
  });

  it('5.1 invoice: three tax regions, all amounts in cents', () => {
    const qr = parsed(SPEC_EXAMPLES[0] ?? '');
    expect(qr).toMatchObject({
      issuerNif: '123456789',
      buyerNif: '999999990',
      buyerCountry: 'PT',
      docType: 'FT',
      docStatus: 'N',
      date: '2019-12-31',
      docId: 'FT AB2019/0035',
      atcud: 'CSDF7T5H-0035',
      notSubjectCents: 10_000,
      stampDutyCents: 2_500,
      totalTaxesCents: 6_400_002,
      totalCents: 51_360_058,
      withholdingCents: 10_000,
      hash4: 'kLp0',
      certificate: '9999',
      other: 'TB;PT00000000000000000000000;513500.58',
    });
    expect(qr.taxRegions).toEqual([
      {
        region: 'PT',
        exemptBase: 1_200_000,
        reducedBase: 1_500_000,
        reducedVat: 90_000,
        intermediateBase: 5_000_000,
        intermediateVat: 650_000,
        normalBase: 8_000_000,
        normalVat: 1_840_000,
      },
      {
        region: 'PT-AC',
        exemptBase: 1_000_000,
        reducedBase: 2_500_056,
        reducedVat: 100_002,
        intermediateBase: 7_500_000,
        intermediateVat: 675_000,
        normalBase: 10_000_000,
        normalVat: 1_800_000,
      },
      {
        region: 'PT-MA',
        exemptBase: 500_000,
        reducedBase: 1_250_000,
        reducedVat: 62_500,
        intermediateBase: 2_500_000,
        intermediateVat: 300_000,
        normalBase: 4_000_000,
        normalVat: 880_000,
      },
    ]);
    // N = VAT + stamp duty
    expect(vatCents(qr) + (qr.stampDutyCents ?? 0)).toBe(qr.totalTaxesCents);
  });

  it('5.2 simplified invoice', () => {
    const qr = parsed(SPEC_EXAMPLES[1] ?? '');
    expect(qr).toMatchObject({
      docType: 'FS',
      totalCents: 80,
      totalTaxesCents: 15,
      other: 'NU;0.80',
    });
    expect(qr.taxRegions).toEqual([{ region: 'PT', normalBase: 65, normalVat: 15 }]);
    expect(vatCents(qr)).toBe(15);
  });

  it('5.4 transport document without values (I1:0)', () => {
    const qr = parsed(SPEC_EXAMPLES[3] ?? '');
    expect(qr.taxRegions).toEqual([{ region: '0' }]);
    expect(qr.totalCents).toBe(0);
  });

  it('5.5 foreign buyer and tax region', () => {
    const qr = parsed(SPEC_EXAMPLES[4] ?? '');
    expect(qr).toMatchObject({ buyerNif: '4443332215', buyerCountry: 'FR', totalCents: 12_000 });
    expect(qr.taxRegions[0]?.region).toBe('FR');
  });

  it('5.7 margin scheme: L without discriminated VAT', () => {
    const qr = parsed(SPEC_EXAMPLES[6] ?? '');
    expect(qr.notSubjectCents).toBe(100_000);
    expect(vatCents(qr)).toBe(900);
  });
});

describe('parseFiscalQr — tolerance and errors', () => {
  const base =
    'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260115*G:FT 1/2*H:ABCD-2*I1:PT*N:0.00*O:1.00*Q:abcd*R:1';

  it('accepts spaces around codes and values (as in examples 5.6 and 5.7 of the PDF)', () => {
    const qr = parsed(base.replace('G:FT 1/2', 'G: FT 1/2 ').replace('H:', ' H: '));
    expect(qr.docId).toBe('FT 1/2');
    expect(qr.atcud).toBe('ABCD-2');
  });

  it('warns (but parses) when non-critical mandatory fields are missing', () => {
    const result = parseFiscalQr(base.replace('*H:ABCD-2', ''));
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('Missing mandatory field H');
  });

  it('fails without total, date or issuer', () => {
    for (const field of ['O:1.00', 'F:20260115', 'A:500000000']) {
      const result = parseFiscalQr(base.replace(field, ''));
      expect(result.ok, field).toBe(false);
    }
  });

  it('fails on impossible dates and malformed totals', () => {
    expect(parseFiscalQr(base.replace('F:20260115', 'F:20260231')).ok).toBe(false);
    expect(parseFiscalQr(base.replace('O:1.00', 'O:1,00')).ok).toBe(false);
  });

  it('warns on amounts without two decimals', () => {
    const result = parseFiscalQr(base.replace('O:1.00', 'O:1.5'));
    expect(result.ok && result.qr.totalCents).toBe(150);
    expect(result.warnings).toContain('O should have two decimal places');
  });

  it('recognises fiscal QR text', () => {
    expect(looksLikeFiscalQr(base)).toBe(true);
    expect(looksLikeFiscalQr('https://example.com')).toBe(false);
  });
});

// Real invoices, anonymized, kept only on the developer's machine (fixtures/private).
const PRIVATE_DIR = join(__dirname, '../../fixtures/private');
const privateQrs = existsSync(PRIVATE_DIR)
  ? readdirSync(PRIVATE_DIR).flatMap((provider) =>
      readdirSync(join(PRIVATE_DIR, provider)).flatMap((file) => {
        const fixture = JSON.parse(readFileSync(join(PRIVATE_DIR, provider, file), 'utf8')) as {
          qrs?: { text: string }[];
          qr?: string | null;
        };
        const texts = fixture.qrs?.map((qr) => qr.text) ?? (fixture.qr ? [fixture.qr] : []);
        return texts.map((text) => ({ name: `${provider}/${file}`, text }));
      }),
    )
  : [];

describe.skipIf(privateQrs.length === 0)('parseFiscalQr — private fixtures', () => {
  it.each(privateQrs)('$name', ({ text }) => {
    const result = parseFiscalQr(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.qr.totalCents).toBeGreaterThanOrEqual(0);
    expect(vatCents(result.qr)).toBeLessThanOrEqual(result.qr.totalTaxesCents ?? Infinity);
  });
});
