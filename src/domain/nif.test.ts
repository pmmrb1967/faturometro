import { describe, expect, it } from 'vitest';
import { isValidNif, nifCheckDigit } from './nif';

describe('NIF', () => {
  it('validates the check digit', () => {
    expect(isValidNif('123456789')).toBe(true);
    expect(isValidNif('500000000')).toBe(true);
    expect(isValidNif('123456788')).toBe(false);
  });

  it('rejects anything that is not 9 digits', () => {
    for (const value of ['12345678', '1234567890', '12345678a', ' 123456789']) {
      expect(isValidNif(value)).toBe(false);
    }
  });

  it('uses 0 when the remainder is 0 or 1', () => {
    expect(nifCheckDigit('50123456')).toBe(0);
  });
});
