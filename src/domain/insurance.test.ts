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

describe('contract start date', () => {
  it('renews on the next anniversary, even with monthly receipts', () => {
    const health = { insurance: { startDate: '2026-05-01' } };
    const monthly = [{ periodStart: '2026-10-01', periodEnd: '2026-10-31' }];
    expect(insuranceRenewalDate(health, monthly, '2026-10-15')).toBe('2027-05-01');
    expect(insuranceRenewalDate(health, monthly, '2027-05-01')).toBe('2027-05-01');
    expect(insuranceRenewalDate(health, monthly, '2027-05-02')).toBe('2028-05-01');
    // Not the start itself.
    expect(insuranceRenewalDate(health, [], '2026-04-01')).toBe('2027-05-01');
    // Without today, the anniversary is not used.
    expect(insuranceRenewalDate(health, monthly)).toBeUndefined();
  });
});
