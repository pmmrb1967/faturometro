import { describe, expect, it } from 'vitest';
import {
  addMonthsToDate,
  sortWarranties,
  WARRANTY_MONTHS,
  warrantyEnd,
  warrantyStatus,
} from './warranty';

describe('addMonthsToDate', () => {
  it('keeps the day, or takes the last day of a shorter month', () => {
    expect(addMonthsToDate('2024-01-15', 36)).toBe('2027-01-15');
    expect(addMonthsToDate('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsToDate('2024-02-29', 36)).toBe('2027-02-28');
    expect(addMonthsToDate('2025-08-31', 18)).toBe('2027-02-28');
  });
});

describe('warrantyStatus', () => {
  const washer = { deliveryDate: '2024-03-10', months: WARRANTY_MONTHS.new };

  it('runs for 3 years from delivery', () => {
    expect(warrantyEnd(washer)).toBe('2027-03-10');
    const status = warrantyStatus(washer, '2025-09-10');
    expect(status.state).toBe('active');
    expect(status.progress).toBeCloseTo(0.5, 1);
  });

  it('is ending in the last 60 days, and ended after its last day', () => {
    expect(warrantyStatus(washer, '2027-01-09').state).toBe('ending');
    expect(warrantyStatus(washer, '2027-03-10')).toMatchObject({ state: 'ending', daysLeft: 0 });
    expect(warrantyStatus(washer, '2027-03-11')).toMatchObject({
      state: 'ended',
      daysLeft: -1,
      progress: 1,
    });
  });
});

describe('sortWarranties', () => {
  it('shows the running ones first, the closest end first, then the ended ones', () => {
    const items = [
      { id: 'ended-old', deliveryDate: '2020-01-01', months: 36 },
      { id: 'later', deliveryDate: '2026-01-01', months: 36 },
      { id: 'sooner', deliveryDate: '2025-06-01', months: 18 },
      { id: 'ended-recent', deliveryDate: '2023-01-01', months: 18 },
    ];
    expect(sortWarranties(items, '2026-11-25').map((item) => item.id)).toEqual([
      'sooner',
      'later',
      'ended-recent',
      'ended-old',
    ]);
  });
});
