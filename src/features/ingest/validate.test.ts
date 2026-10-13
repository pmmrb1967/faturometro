import { describe, expect, it } from 'vitest';
import { emptyExtraction, type ExtractedInvoice } from '../../parsers/types';
import { parseFiscalQr, type FiscalQr } from '../../qr/parse';
import { validateExtraction } from './validate';

// Synthetic QR: total 42,79 €, VAT 4,04 €, issued 2026-06-23.
const RAW =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260623*G:FT 1/1*H:A-1*I1:PT*I3:28.65*I4:1.72*I7:10.10*I8:2.32*N:4.04*O:42.79*Q:abcd*R:1';
const QR = (() => {
  const result = parseFiscalQr(RAW);
  if (!result.ok) throw new Error('bad QR');
  return result.qr;
})() satisfies FiscalQr;

function electricity(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    ...emptyExtraction(),
    sector: 'electricity',
    totalCents: { value: 4279, confidence: 'high' },
    netCents: { value: 3875, confidence: 'high' },
    vatCents: { value: 404, confidence: 'high' },
    periodStart: { value: '2026-05-22', confidence: 'high' },
    periodEnd: { value: '2026-06-21', confidence: 'high' },
    lines: [
      { kind: 'energy', description: 'Energia', amountCents: 3000, quantity: 226, unit: 'kWh' },
      { kind: 'power', description: 'Potência', amountCents: 875 },
    ],
    readings: [
      { quantity: 100, unit: 'kWh', readingType: 'real', dateTo: '2026-06-21', period: 'full' },
      { quantity: 126, unit: 'kWh', readingType: 'real', dateTo: '2026-06-21', period: 'empty' },
    ],
    ...overrides,
  };
}

describe('validateExtraction', () => {
  it('passes a consistent extraction', () => {
    expect(validateExtraction(electricity(), QR)).toEqual({
      validation: 'passed',
      failures: [],
      confidence: {
        totalCents: 'high',
        netCents: 'high',
        vatCents: 'high',
        periodStart: 'high',
        periodEnd: 'high',
      },
    });
  });

  it('accepts a 1 cent difference', () => {
    const result = validateExtraction(
      electricity({ totalCents: { value: 4280, confidence: 'high' } }),
      QR,
    );
    expect(result.failures).not.toContain('total');
  });

  it('fails when total or VAT differ from the QR code, lowering confidence', () => {
    const result = validateExtraction(
      electricity({
        totalCents: { value: 4300, confidence: 'high' },
        vatCents: { value: 500, confidence: 'high' },
      }),
      QR,
    );
    expect(result.validation).toBe('failed');
    expect(result.failures).toEqual(['total', 'vat']);
    expect(result.confidence).toMatchObject({ totalCents: 'low', vatCents: 'low' });
  });

  it('checks the period: start ≤ end ≤ issue date + 5 days', () => {
    expect(
      validateExtraction(
        electricity({ periodEnd: { value: '2026-06-28', confidence: 'high' } }),
        QR,
      ).failures,
    ).toEqual([]);
    expect(
      validateExtraction(
        electricity({ periodEnd: { value: '2026-06-29', confidence: 'high' } }),
        QR,
      ).failures,
    ).toEqual(['period']);
    expect(
      validateExtraction(
        electricity({ periodStart: { value: '2026-06-30', confidence: 'high' } }),
        QR,
      ).failures,
    ).toContain('period');
  });

  it('lets telecom bill the coming month in advance', () => {
    const telecom = electricity({
      sector: 'telecom',
      periodStart: { value: '2026-06-23', confidence: 'high' },
      periodEnd: { value: '2026-07-22', confidence: 'high' },
      readings: [],
      lines: [{ kind: 'base_fee', description: 'Pacote', amountCents: 4279 }],
      linesIncludeVat: true,
    });
    expect(validateExtraction(telecom, QR).failures).toEqual([]);
  });

  it('checks that lines add up (net, or total when lines include VAT)', () => {
    const broken = electricity({
      lines: [
        { kind: 'energy', description: 'Energia', amountCents: 100, quantity: 226, unit: 'kWh' },
      ],
    });
    expect(validateExtraction(broken, QR).failures).toEqual(['lines']);
  });

  it('checks that readings match the kWh billed', () => {
    const broken = electricity({
      readings: [{ quantity: 200, unit: 'kWh', readingType: 'real', dateTo: '2026-06-21' }],
    });
    expect(validateExtraction(broken, QR).failures).toEqual(['readings']);
  });

  it('cannot validate without a QR code', () => {
    expect(validateExtraction(electricity()).validation).toBe('not_checked');
  });
});
