import { describe, expect, it } from 'vitest';
import { oldCharges, prescriptionApplies } from './prescription';

const invoice = (issueDate: string, periodStart?: string, periodEnd?: string) => ({
  id: 'i1',
  issueDate,
  ...(periodStart ? { periodStart } : {}),
  ...(periodEnd ? { periodEnd } : {}),
});

describe('oldCharges', () => {
  it('finds the part of the billed period from more than six months before the invoice', () => {
    expect(oldCharges(invoice('2026-10-15', '2026-01-01', '2026-09-30'))).toEqual({
      invoiceId: 'i1',
      issueDate: '2026-10-15',
      periodStart: '2026-01-01',
      periodEnd: '2026-09-30',
      oldUntil: '2026-04-14',
    });
  });

  it('the whole period when it ended more than six months before', () => {
    expect(oldCharges(invoice('2026-10-15', '2026-01-01', '2026-01-31'))?.oldUntil).toBe(
      '2026-01-31',
    );
  });

  it('nothing for recent periods, periods billed in advance or invoices without a period', () => {
    expect(oldCharges(invoice('2026-10-15', '2026-04-15', '2026-10-14'))).toBeNull();
    expect(oldCharges(invoice('2026-10-15', '2026-10-15', '2026-11-14'))).toBeNull();
    expect(oldCharges(invoice('2026-10-15'))).toBeNull();
  });
});

describe('prescriptionApplies', () => {
  it('electricity, gas and telecom (regulators confirm it); not yet water', () => {
    expect(prescriptionApplies('electricity')).toBe(true);
    expect(prescriptionApplies('gas')).toBe(true);
    expect(prescriptionApplies('telecom')).toBe(true);
    expect(prescriptionApplies('water')).toBe(false);
    expect(prescriptionApplies('insurance')).toBe(false);
  });
});
