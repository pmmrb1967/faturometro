import { describe, expect, it } from 'vitest';
import { addMonthsTo, expenseDueDate, monthSummary, paymentId } from './month';
import type { Invoice, Payment, RecurringExpense } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function invoice(id: string, issueDate: string, totalCents: number, dueDate?: string): Invoice {
  return {
    ...META,
    id,
    contractId: 'c1',
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate,
    ...(dueDate ? { dueDate } : {}),
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: `${issueDate}T10:00:00.000Z`,
  };
}

function expense(overrides: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    ...META,
    id: 'e1',
    name: 'Renda',
    amountCents: 65000,
    everyMonths: 1,
    dueDay: 8,
    startMonth: '2026-01',
    createdAt: META.updatedAt,
    ...overrides,
  };
}

const paid = (id: string, paidOn = '2026-10-05'): Payment => ({ ...META, id, paidOn });

describe('addMonthsTo', () => {
  it('moves across years', () => {
    expect(addMonthsTo('2026-12', 1)).toBe('2027-01');
    expect(addMonthsTo('2026-01', -1)).toBe('2025-12');
    expect(addMonthsTo('2026-10', 14)).toBe('2027-12');
  });
});

describe('expenseDueDate', () => {
  it('in the months it is due, from the start and up to the end', () => {
    const quarterly = expense({ everyMonths: 3, startMonth: '2026-02', endMonth: '2026-11' });
    expect(expenseDueDate(quarterly, '2026-01')).toBeNull();
    expect(expenseDueDate(quarterly, '2026-02')).toBe('2026-02-08');
    expect(expenseDueDate(quarterly, '2026-03')).toBeNull();
    expect(expenseDueDate(quarterly, '2026-11')).toBe('2026-11-08');
    expect(expenseDueDate(quarterly, '2027-02')).toBeNull();
  });

  it('uses the last day of shorter months', () => {
    expect(expenseDueDate(expense({ dueDay: 31 }), '2026-02')).toBe('2026-02-28');
  });
});

describe('monthSummary', () => {
  it('invoices by due date (else issue date), expenses, and what is paid', () => {
    const invoices = [
      invoice('a', '2026-09-23', 4999, '2026-10-08'),
      invoice('b', '2026-10-02', 3000),
      invoice('c', '2026-10-25', 2000, '2026-11-09'),
      invoice('nc', '2026-10-12', -500),
    ];
    const summary = monthSummary(
      '2026-10',
      invoices,
      [expense()],
      [paid(paymentId({ invoiceId: 'a' })), paid(paymentId({ expenseId: 'e1', month: '2026-09' }))],
    );
    expect(summary.items.map((item) => [item.paymentId, item.date, item.paidOn])).toEqual([
      ['invoice-b', '2026-10-02', undefined],
      ['expense-e1-2026-10', '2026-10-08', undefined],
      ['invoice-a', '2026-10-08', '2026-10-05'],
      ['invoice-nc', '2026-10-12', undefined],
    ]);
    expect(summary.items.find((item) => item.invoiceId === 'b')?.hasDueDate).toBe(false);
    expect(summary).toMatchObject({ totalCents: 72499, paidCents: 4999, toPayCents: 67500 });
  });
});
