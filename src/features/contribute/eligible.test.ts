import { describe, expect, it } from 'vitest';
import type { FiscalQr } from '../../qr/parse';
import { personalValues, shouldOffer } from './eligible';

const qr = (buyerNif: string) => ({ buyerNif }) as FiscalQr;

describe('shouldOffer', () => {
  it('offers for PDFs with text and no parser or a failed validation', () => {
    expect(shouldOffer({ fileKind: 'pdf', hasText: true })).toBe(true);
    expect(
      shouldOffer({ fileKind: 'pdf', hasText: true, parserId: 'nos', validation: 'failed' }),
    ).toBe(true);
    expect(
      shouldOffer({ fileKind: 'pdf', hasText: true, parserId: 'nos', validation: 'passed' }),
    ).toBe(false);
    expect(shouldOffer({ fileKind: 'pdf', hasText: false })).toBe(false);
    expect(shouldOffer({ fileKind: 'image', hasText: false })).toBe(false);
  });
});

describe('personalValues', () => {
  it('collects the buyer NIF, own NIF and identifiers read by a parser', () => {
    const values = personalValues({
      qrs: [qr('123456789')],
      ownNif: '123456789',
      extraction: {
        customerNumber: { value: 'C-77', confidence: 'high' },
        supplyPointId: { value: 'PT0002000012345678AB', confidence: 'high' },
        lines: [],
        readings: [],
        warnings: [],
      },
    });
    expect(values).toEqual(expect.arrayContaining(['123456789', 'C-77', 'PT0002000012345678AB']));
    expect(new Set(values).size).toBe(values.length);
    expect(personalValues({ qrs: [qr('999999990')] })).toEqual([]);
  });

  it('adds the local part of the account email (I3)', () => {
    expect(personalValues({ qrs: [], email: 'maria.dias@exemplo.pt' })).toEqual(['maria.dias']);
    expect(personalValues({ qrs: [], email: '' })).toEqual([]);
  });
});
