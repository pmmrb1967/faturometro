import { describe, expect, it } from 'vitest';
import { addMonths, earlyExit, monthsUntil } from './early-exit';

describe('dates', () => {
  it('adds months, keeping the day or the last day of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-18', -24)).toBe('2024-10-18');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('counts whole months, a part of a month as one', () => {
    expect(monthsUntil('2026-10-18', '2027-01-18')).toBe(3);
    expect(monthsUntil('2026-10-18', '2027-01-31')).toBe(4);
    expect(monthsUntil('2026-10-18', '2026-10-18')).toBe(0);
    expect(monthsUntil('2026-10-18', '2026-09-01')).toBe(0);
  });
});

describe('earlyExit', () => {
  const base = { today: '2026-10-18', monthlyCents: 4000, kind: 'initial' as const };

  it('first year: up to 50 % of the monthly fees still to pay', () => {
    // 24-month loyalty from 2026-04-18: 18 months left.
    const exit = earlyExit({ ...base, loyaltyEnd: '2028-04-18', newMonthlyCents: 2500 });
    expect(exit).toMatchObject({
      loyaltyStart: '2026-04-18',
      monthsLeft: 18,
      remainingFeesCents: 72000,
      year: 1,
      capPct: 50,
      maxChargeCents: 36000,
      chargeCents: 36000,
      savingCents: 27000,
      balanceCents: -9000,
    });
  });

  it('second year: up to 30 %, and leaving can pay off', () => {
    const exit = earlyExit({ ...base, loyaltyEnd: '2027-04-18', newMonthlyCents: 2500 });
    expect(exit).toMatchObject({ monthsLeft: 6, year: 2, capPct: 30, maxChargeCents: 7200 });
    expect(exit.balanceCents).toBe(9000 - 7200);
  });

  it('a new loyalty on the same installation: 30 %, even in the first year', () => {
    const exit = earlyExit({
      ...base,
      kind: 'renewal_same_installation',
      loyaltyEnd: '2028-04-18',
    });
    expect(exit).toMatchObject({ year: 1, capPct: 30, maxChargeCents: 21600 });
    expect(exit.savingCents).toBeUndefined();
  });

  it('contracts before 14 November 2022: only the stated amount', () => {
    const old = { ...base, loyaltyStart: '2022-06-01', loyaltyEnd: '2027-01-18' };
    expect(earlyExit(old)).toMatchObject({ capPct: null, maxChargeCents: null, chargeCents: null });
    const stated = earlyExit({ ...old, statedChargeCents: 5000, newMonthlyCents: 3000 });
    expect(stated).toMatchObject({ chargeCents: 5000, savingCents: 3000, balanceCents: -2000 });
  });

  it('the amount the operator states wins over the cap', () => {
    const exit = earlyExit({ ...base, loyaltyEnd: '2027-04-18', statedChargeCents: 3000 });
    expect(exit).toMatchObject({ maxChargeCents: 7200, chargeCents: 3000 });
  });
});
