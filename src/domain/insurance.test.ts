import { describe, expect, it } from 'vitest';
import { insuranceRenewalDate } from './insurance';

describe('insuranceRenewalDate', () => {
  it('is the day after a yearly receipt, or the renewal letter date if later', () => {
    const yearly = [{ periodStart: '2025-11-01', periodEnd: '2026-10-31' }];
    expect(insuranceRenewalDate({}, yearly)).toBe('2026-11-01');
    const letter = {
      insurance: { renewal: { date: '2027-11-01', currentCents: 1, nextCents: 2 } },
    };
    expect(insuranceRenewalDate(letter, yearly)).toBe('2027-11-01');
  });

  it('ignores monthly instalments', () => {
    const monthly = [
      { periodStart: '2026-09-01', periodEnd: '2026-09-30' },
      { periodStart: '2026-10-01', periodEnd: '2026-10-31' },
    ];
    expect(insuranceRenewalDate({}, monthly)).toBeUndefined();
    expect(insuranceRenewalDate({}, [{}])).toBeUndefined();
  });
});
